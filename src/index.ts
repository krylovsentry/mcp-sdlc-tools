import { loadConfig } from "./config/schema";
import { ServerManager } from "./mcp/serverManager";
import { McpToolGateway } from "./mcp/toolGateway";
import { runToolCallingLoop } from "./agent/toolCallingLoop";
import { OpenAiCompatProvider } from "./providers/openaiCompatProvider";
import { OllamaProvider } from "./providers/ollamaProvider";

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) {
    return undefined;
  }
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const prompt = parseArg("--prompt");
  if (!prompt) {
    throw new Error('Missing required "--prompt" argument.');
  }

  const configPath = parseArg("--config") ?? "config/servers.json";
  console.error(`[app] loading config from ${configPath}`);
  const config = await loadConfig(configPath);
  console.error(`[app] model provider=${config.model.provider} model=${config.model.modelName} baseUrl=${config.model.baseUrl}`);
  const manager = new ServerManager(config);

  await manager.startAll();
  try {
    const gateway = new McpToolGateway(manager, config.agent.toolTimeoutMs);
    const provider = config.model.provider === "openaiCompat"
      ? new OpenAiCompatProvider(config.model)
      : new OllamaProvider(config.model);
    console.error("[app] starting agent loop");
    const answer = await runToolCallingLoop(provider, gateway, config, prompt);
    console.error("[app] agent loop completed");
    console.log(answer);
  } finally {
    manager.stopAll();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
