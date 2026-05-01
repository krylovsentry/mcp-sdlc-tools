import { loadConfig } from "./config/schema";
import { runPrReview } from "./pr/runReview";
import { SourceCodeApiPullRequestProvider } from "./pr/sourceCodeApiProvider";
import { StubPullRequestProvider } from "./pr/stubPrProvider";
import type { PrRef } from "./pr/types";
import { OllamaProvider } from "./providers/ollamaProvider";
import { OpenAiCompatProvider } from "./providers/openaiCompatProvider";
import { syntheticArgv } from "./syntheticArgv";

function parseArg(argv: string[], name: string): string | undefined {
	const idx = argv.indexOf(name);
	if (idx === -1) {
		return undefined;
	}
	return argv[idx + 1];
}

async function readStdinText(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf-8");
}

export async function runReviewPr(forwardedArgv: string[]): Promise<void> {
	const argv = syntheticArgv(forwardedArgv);
	const configPath = parseArg(argv, "--config") ?? "config/servers.json";
	const providerName = parseArg(argv, "--provider") ?? "stub";
	const diffPath = parseArg(argv, "--diff");
	const cliOutput = parseArg(argv, "--output");
	const title = parseArg(argv, "--title");
	const baseUrl = parseArg(argv, "--base-url");
	const projectKey = parseArg(argv, "--project-key");
	const repoName = parseArg(argv, "--repo-name");
	const prIdRaw = parseArg(argv, "--pr-id");
	const token = parseArg(argv, "--token") ?? process.env.SOURCE_CODE_API_TOKEN;

	const config = await loadConfig(configPath);
	const llm =
		config.model.provider === "openaiCompat"
			? new OpenAiCompatProvider(config.model)
			: new OllamaProvider(config.model);

	const outputPath = cliOutput ?? config.prReview?.outputPath;
	let prRef: PrRef;
	let prProvider: StubPullRequestProvider | SourceCodeApiPullRequestProvider;

	if (providerName === "sourceCodeApi") {
		if (!baseUrl || !projectKey || !repoName || !prIdRaw) {
			throw new Error(
				"Missing sourceCodeApi args. Required: --base-url --project-key --repo-name --pr-id. " +
					"Optional: --token (or SOURCE_CODE_API_TOKEN env), --output.",
			);
		}
		const prId = Number(prIdRaw);
		if (!Number.isFinite(prId)) {
			throw new Error(`Invalid --pr-id: ${prIdRaw}`);
		}
		prRef = {
			provider: "sourceCodeApi",
			projectKey,
			repoName,
			prId,
		};
		prProvider = new SourceCodeApiPullRequestProvider(
			baseUrl,
			token,
			outputPath,
		);
		console.error(
			`[review:pr] sourceCodeApi target=${baseUrl} project=${projectKey} repo=${repoName} prId=${prId} tokenProvided=${token ? "yes" : "no"}`,
		);
	} else {
		let unifiedDiff: string;
		if (diffPath) {
			unifiedDiff = await Bun.file(diffPath).text();
		} else {
			unifiedDiff = await readStdinText();
		}
		if (!unifiedDiff.trim()) {
			throw new Error(
				"Diff is empty. Pass --diff path/to/patch.diff or pipe a unified diff on stdin.",
			);
		}
		console.error(
			`[review:pr] stub.diff chars=${unifiedDiff.length} source=${diffPath ? "file" : "stdin"}`,
		);
		prRef = { provider: "stub" };
		prProvider = new StubPullRequestProvider(
			{ unifiedDiff, title: title ?? undefined },
			outputPath,
		);
	}

	console.error(
		`[review:pr] llm=${config.model.provider} model=${config.model.modelName} prProvider=${providerName} output=${outputPath ?? "stdout"}`,
	);

	await runPrReview(llm, prProvider, prRef);
}

async function main(): Promise<void> {
	await runReviewPr(process.argv.slice(2));
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
