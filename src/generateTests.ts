import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) {
    return undefined;
  }
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const promptPath = parseArg("--prompt-file") ?? "prompts/generate-tests-autonomous.txt";
  const configPath = parseArg("--config") ?? "config/servers.json";
  const dryRun = process.argv.includes("--dry-run");
  const promptText = await Bun.file(promptPath).text();
  if (!promptText.trim()) {
    throw new Error(`Prompt file is empty: ${promptPath}`);
  }

  const child = spawn(
    process.execPath,
    ["run", "src/index.ts", "--config", configPath, "--prompt", promptText],
    { stdio: ["ignore", "pipe", "inherit"], shell: false }
  );

  let modelOutput = "";
  child.stdout.on("data", (chunk) => {
    modelOutput += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`generate:tests exited with code ${code ?? -1}`));
    });
    child.once("error", (error) => reject(error));
  });

  console.error("[generate:tests] model output received, parsing file blocks");
  const files = extractFiles(modelOutput);
  if (files.length === 0) {
    throw new Error(
      "No file blocks found in model output. Ask model to return fenced blocks with first line: FILE: relative/path"
    );
  }

  for (const file of files) {
    const safePath = toSafePath(file.path);
    if (!dryRun) {
      await mkdir(dirname(safePath), { recursive: true });
      await Bun.write(safePath, file.content);
    }
    console.error(`[generate:tests] ${dryRun ? "would write" : "wrote"} ${safePath} (${file.content.length} bytes)`);
  }

  console.log(modelOutput);
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
    throw new Error(`Generated path not allowed (must start with testing/ or docs/): ${path}`);
  }
  return clean;
}

function extractFiles(raw: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  const fileHeaderPattern = /```[^\n]*\nFILE:\s*([^\n]+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null = null;
  while ((match = fileHeaderPattern.exec(raw)) !== null) {
    files.push({
      path: match[1].trim(),
      content: match[2]
    });
  }

  if (files.length > 0) {
    return dedupeByPath(files);
  }

  // Fallback: ```relative/path.ext\n...```
  const pathFencePattern = /```([^\s`][^\n]*)\n([\s\S]*?)```/g;
  while ((match = pathFencePattern.exec(raw)) !== null) {
    const maybePath = match[1].trim();
    if (maybePath.includes("/") && !maybePath.startsWith("json") && !maybePath.startsWith("ts") && !maybePath.startsWith("md")) {
      files.push({ path: maybePath, content: match[2] });
    }
  }
  return dedupeByPath(files);
}

function dedupeByPath(files: Array<{ path: string; content: string }>): Array<{ path: string; content: string }> {
  const map = new Map<string, string>();
  for (const file of files) {
    map.set(file.path, file.content);
  }
  return Array.from(map.entries()).map(([path, content]) => ({ path, content }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
