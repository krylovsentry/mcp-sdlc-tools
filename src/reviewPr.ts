import { loadConfig } from "./config/schema";
import { OpenAiCompatProvider } from "./providers/openaiCompatProvider";
import { OllamaProvider } from "./providers/ollamaProvider";
import { runPrReview } from "./pr/runReview";
import { StubPullRequestProvider } from "./pr/stubPrProvider";

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) {
    return undefined;
  }
  return process.argv[idx + 1];
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main(): Promise<void> {
  const configPath = parseArg("--config") ?? "config/servers.json";
  const diffPath = parseArg("--diff");
  const cliOutput = parseArg("--output");
  const title = parseArg("--title");

  const config = await loadConfig(configPath);
  const llm = config.model.provider === "openaiCompat"
    ? new OpenAiCompatProvider(config.model)
    : new OllamaProvider(config.model);

  let unifiedDiff: string;
  if (diffPath) {
    unifiedDiff = await Bun.file(diffPath).text();
  } else {
    unifiedDiff = await readStdinText();
  }
  if (!unifiedDiff.trim()) {
    throw new Error("Diff is empty. Pass --diff path/to/patch.diff or pipe a unified diff on stdin.");
  }

  const outputPath = cliOutput ?? config.prReview?.outputPath;
  const pr = new StubPullRequestProvider(
    { unifiedDiff, title: title ?? undefined },
    outputPath
  );

  console.error(
    `[review:pr] provider=${config.model.provider} model=${config.model.modelName} output=${outputPath ?? "stdout"}`
  );

  await runPrReview(llm, pr, { provider: "stub" });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
