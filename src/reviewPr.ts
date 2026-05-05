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
	const branchArg = parseArg(argv, "--branch");
	const commitArg = parseArg(argv, "--commit");
	const qualityPathArg = parseArg(argv, "--quality-path");
	const qualitySeverityArg = parseArg(argv, "--quality-severity");
	const token = parseArg(argv, "--token") ?? process.env.SOURCE_CODE_API_TOKEN;

	const config = await loadConfig(configPath);
	const branch = branchArg ?? config.prReview?.qualityBranch;
	const commit = commitArg ?? config.prReview?.qualityCommit;
	const qualityPath = qualityPathArg ?? config.prReview?.qualityPath;
	const qualitySeverity = qualitySeverityArg ?? config.prReview?.qualitySeverity;

	if ((branch?.trim() && !commit?.trim()) || (!branch?.trim() && commit?.trim())) {
		console.error(
			"[review:pr] quality.post ignored: use both --branch and --commit (or config prReview.qualityBranch and qualityCommit together)",
		);
	}

	const qualityPost =
		branch?.trim() && commit?.trim()
			? {
					branch: branch.trim(),
					commit: commit.trim(),
					...(qualityPath?.trim() ? { path: qualityPath.trim() } : {}),
					...(qualitySeverity?.trim() ? { severity: qualitySeverity.trim() } : {}),
				}
			: undefined;
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
					"Optional: --token (or SOURCE_CODE_API_TOKEN env), --output, --branch, --commit, --quality-path, --quality-severity.",
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
			qualityPost,
		);
		const outLabel =
			outputPath ?? (qualityPost ? "quality-api" : "stdout");
		console.error(
			`[review:pr] sourceCodeApi target=${baseUrl} project=${projectKey} repo=${repoName} prId=${prId} tokenProvided=${token ? "yes" : "no"} output=${outLabel}`,
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

	const outputLabel =
		providerName === "sourceCodeApi"
			? outputPath ?? (qualityPost ? "quality-api" : "stdout")
			: outputPath ?? "stdout";
	console.error(
		`[review:pr] llm=${config.model.provider} model=${config.model.modelName} prProvider=${providerName} output=${outputLabel}`,
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
