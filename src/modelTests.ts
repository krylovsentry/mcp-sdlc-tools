import { loadConfig } from "./config/schema";
import { OpenAiCompatProvider } from "./providers/openaiCompatProvider";
import { OllamaProvider } from "./providers/ollamaProvider";
import { systemPrompt } from "./agent/prompting";
import type { ChatMessage } from "./types/protocol";

type TestCase = {
  name: string;
  prompt: string;
};

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) {
    return undefined;
  }
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const configPath = parseArg("--config") ?? "config/servers.json";
  const casesPath = parseArg("--cases") ?? "prompts/model-test-cases.json";
  const config = await loadConfig(configPath);
  const provider = config.model.provider === "openaiCompat"
    ? new OpenAiCompatProvider(config.model)
    : new OllamaProvider(config.model);

  const casesRaw = await Bun.file(casesPath).json() as unknown;
  const cases = validateCases(casesRaw);
  if (cases.length === 0) {
    throw new Error(`No cases found in ${casesPath}`);
  }

  console.error(`[model-tests] provider=${config.model.provider} model=${config.model.modelName} cases=${cases.length}`);
  let passed = 0;
  let failed = 0;

  for (const testCase of cases) {
    const startedAt = Date.now();
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt() },
        { role: "user", content: testCase.prompt }
      ];
      const response = await provider.complete(messages, []);
      const text = (response.text ?? "").trim();
      const elapsedMs = Date.now() - startedAt;
      if (!text) {
        failed += 1;
        console.error(`[model-tests] FAIL name=${testCase.name} elapsedMs=${elapsedMs} reason=empty_text`);
        continue;
      }
      passed += 1;
      console.error(`[model-tests] PASS name=${testCase.name} elapsedMs=${elapsedMs} chars=${text.length}`);
      console.log(`\n=== ${testCase.name} ===\n${text}\n`);
    } catch (error) {
      failed += 1;
      const elapsedMs = Date.now() - startedAt;
      console.error(
        `[model-tests] FAIL name=${testCase.name} elapsedMs=${elapsedMs} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.error(`[model-tests] summary passed=${passed} failed=${failed} total=${cases.length}`);
  if (failed > 0) {
    process.exit(1);
  }
}

function validateCases(raw: unknown): TestCase[] {
  if (!Array.isArray(raw)) {
    throw new Error("Cases file must be an array");
  }
  return raw.map((item, index) => {
    const value = item as Record<string, unknown>;
    const name = String(value.name ?? `case-${index + 1}`);
    const prompt = String(value.prompt ?? "").trim();
    if (!prompt) {
      throw new Error(`Case ${name} has empty prompt`);
    }
    return { name, prompt };
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
