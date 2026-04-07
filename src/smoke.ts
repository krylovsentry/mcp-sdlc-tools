import { loadConfig } from "./config/schema";
import { ServerManager } from "./mcp/serverManager";
import { McpToolGateway } from "./mcp/toolGateway";

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? "config/servers.json";
  const config = await loadConfig(configPath);
  const manager = new ServerManager(config);
  await manager.startAll();
  try {
    const gateway = new McpToolGateway(manager, config.agent.toolTimeoutMs);
    const tools = await gateway.refreshToolIndex();
    console.log(JSON.stringify({
      ok: true,
      totalTools: tools.length,
      toolNames: tools.map((tool) => tool.name)
    }, null, 2));
  } finally {
    manager.stopAll();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
