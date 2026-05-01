import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";
import { sanitizeGeneratedContent } from "./generateTestsSanitize";
import { runAgent } from "./index";
import { syntheticArgv } from "./syntheticArgv";

function parseArg(argv: string[], name: string): string | undefined {
	const idx = argv.indexOf(name);
	if (idx === -1) {
		return undefined;
	}
	return argv[idx + 1];
}

export async function runGenerateTests(forwardedArgv: string[]): Promise<void> {
	const argv = syntheticArgv(forwardedArgv);
	const promptPath =
		parseArg(argv, "--prompt-file") ?? "prompts/generate-tests-autonomous.txt";
	const configPath = parseArg(argv, "--config") ?? "config/servers.json";
	const dryRun = argv.includes("--dry-run");
	const strictTestPaths =
		argv.includes("--strict-test-paths") ||
		process.env.GENERATE_TESTS_STRICT === "1";
	const promptText = await Bun.file(promptPath).text();
	if (!promptText.trim()) {
		throw new Error(`Prompt file is empty: ${promptPath}`);
	}

	const agentArgv = [
		"--config",
		configPath,
		"--disable-tools",
		"--test-generation",
		"--prompt",
		promptText,
	];
	const modelOutput = await runAgent(agentArgv);

	console.error("[generate:tests] model output received, parsing file blocks");
	const files = extractFiles(modelOutput);
	if (files.length === 0) {
		await persistRawOutput(modelOutput);
		const preview = modelOutput.slice(0, 800).replace(/\s+/g, " ").trim();
		console.error(`[generate:tests] output preview: ${preview || "<empty>"}`);
		throw new Error(
			"No file blocks found in model output. Ask model to return fenced blocks with first line: FILE: relative/path. " +
				"Raw output saved to .artifacts/generate-tests-last-output.md",
		);
	}

	for (const file of files) {
		const safePath = toSafePath(file.path);
		assertAllowedGenerationPath(safePath, strictTestPaths);
		const { text: body, stripped } = sanitizeGeneratedContent(
			safePath,
			file.content,
		);
		if (stripped) {
			console.error(
				`[generate:tests] stripped inner markdown fence from ${safePath}`,
			);
		}
		if (!dryRun) {
			await mkdir(dirname(safePath), { recursive: true });
			await Bun.write(safePath, body);
		}
		console.error(
			`[generate:tests] ${dryRun ? "would write" : "wrote"} ${safePath} (${body.length} bytes)`,
		);
	}

	console.log(modelOutput);
}

async function persistRawOutput(raw: string): Promise<void> {
	const outPath = ".artifacts/generate-tests-last-output.md";
	await mkdir(dirname(outPath), { recursive: true });
	await Bun.write(outPath, raw);
}

function toSafePath(path: string): string {
	if (isAbsolute(path)) {
		throw new Error(`Absolute paths are not allowed: ${path}`);
	}
	const normalized = normalize(path.replace(/\\/g, "/").trim());
	const clean = normalized.replace(/\\/g, "/");
	if (clean.startsWith("..") || clean.includes("/../")) {
		throw new Error(`Path escapes workspace: ${path}`);
	}
	if (!clean.startsWith("testing/") && !clean.startsWith("docs/")) {
		throw new Error(
			`Generated path not allowed (must start with testing/ or docs/): ${path}`,
		);
	}
	return clean;
}

/** When strict: only content files under the predefined runner layout (no package.json, configs, lockfiles). */
function assertAllowedGenerationPath(clean: string, strict: boolean): void {
	if (!strict) {
		return;
	}
	if (clean.startsWith("docs/")) {
		throw new Error(
			`Strict mode: path not allowed (use testing/ only): ${clean}`,
		);
	}
	if (isAllowedStrictGenerationPath(clean)) {
		return;
	}
	throw new Error(
		`Strict mode: path not allowed (specs, helpers, collections, environments, or testing/catalog.json): ${clean}`,
	);
}

function isAllowedStrictGenerationPath(clean: string): boolean {
	if (clean === "testing/catalog.json") {
		return true;
	}
	if (
		clean.startsWith("testing/postman/collections/") &&
		clean.endsWith(".json")
	) {
		return true;
	}
	if (
		clean.startsWith("testing/postman/environments/") &&
		clean.endsWith(".json")
	) {
		return true;
	}
	if (
		/^testing\/playwright\/(smoke|critical|regression)\/.+\.spec\.ts$/.test(
			clean,
		)
	) {
		return true;
	}
	if (/^testing\/playwright\/helpers\/.+\.ts$/.test(clean)) {
		return true;
	}
	return false;
}

function extractFiles(raw: string): Array<{ path: string; content: string }> {
	const files: Array<{ path: string; content: string }> = [];

	const fileHeaderPattern = /```[^\n]*\nFILE:\s*([^\n]+)\n([\s\S]*?)```/g;
	for (;;) {
		const match = fileHeaderPattern.exec(raw);
		if (match === null) {
			break;
		}
		files.push({
			path: match[1].trim(),
			content: match[2],
		});
	}

	if (files.length > 0) {
		return dedupeByPath(files);
	}

	// Fallback: ```relative/path.ext\n...```
	const pathFencePattern = /```([^\s`][^\n]*)\n([\s\S]*?)```/g;
	for (;;) {
		const match = pathFencePattern.exec(raw);
		if (match === null) {
			break;
		}
		const maybePath = match[1].trim();
		if (
			maybePath.includes("/") &&
			!maybePath.startsWith("json") &&
			!maybePath.startsWith("ts") &&
			!maybePath.startsWith("md")
		) {
			files.push({ path: maybePath, content: match[2] });
		}
	}
	if (files.length > 0) {
		return dedupeByPath(files);
	}

	// Fallback: non-fenced sections that start with `FILE: path`
	const plainPattern = /^FILE:\s*(.+)$/gm;
	const headers: Array<{ path: string; index: number }> = [];
	for (;;) {
		const match = plainPattern.exec(raw);
		if (match === null) {
			break;
		}
		headers.push({ path: match[1].trim(), index: match.index });
	}
	for (let i = 0; i < headers.length; i += 1) {
		const current = headers[i];
		const next = headers[i + 1];
		const start = raw.indexOf("\n", current.index);
		const from = start === -1 ? current.index : start + 1;
		const to = next ? next.index : raw.length;
		const content = raw.slice(from, to).trim();
		if (content) {
			files.push({ path: current.path, content: `${content}\n` });
		}
	}
	return dedupeByPath(files);
}

function dedupeByPath(
	files: Array<{ path: string; content: string }>,
): Array<{ path: string; content: string }> {
	const map = new Map<string, string>();
	for (const file of files) {
		map.set(file.path, file.content);
	}
	return Array.from(map.entries()).map(([path, content]) => ({
		path,
		content,
	}));
}

async function main(): Promise<void> {
	await runGenerateTests(process.argv.slice(2));
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
