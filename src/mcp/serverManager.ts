import type { AppConfig } from "../config/schema";
import { SseMcpClient } from "./transport/sseClient";
import { StdioMcpClient } from "./transport/stdioClient";

export type McpClient = {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  stop?: () => void;
};

export class ServerManager {
  private readonly clients = new Map<string, McpClient>();

  constructor(private readonly config: AppConfig) {}

  async startAll(): Promise<void> {
    console.error("[mcp] starting configured MCP servers");
    await this.startServer("playwright", this.config.mcp.playwright);
    await this.startServer("postman", this.config.mcp.postman);
    console.error("[mcp] server startup complete");
  }

  private async startServer(name: string, serverConfig: AppConfig["mcp"]["playwright"]): Promise<void> {
    if (!serverConfig.enabled) {
      console.error(`[mcp:${name}] disabled in config, skipping`);
      return;
    }
    if (serverConfig.transport === "stdio" && serverConfig.stdio) {
      const client = new StdioMcpClient(
        serverConfig.stdio.command,
        serverConfig.stdio.args,
        serverConfig.stdio.env,
        serverConfig.stdio.cwd,
        name
      );
      this.clients.set(name, client);
      console.error(`[mcp:${name}] connected using stdio transport`);
      return;
    }
    if (serverConfig.transport === "sse" && serverConfig.sse) {
      const client = new SseMcpClient(serverConfig.sse.url, serverConfig.sse.headers);
      this.clients.set(name, client);
      console.error(`[mcp:${name}] connected using sse transport (${serverConfig.sse.url})`);
      return;
    }
    throw new Error(`Invalid server config for ${name}`);
  }

  getClient(name: "playwright" | "postman"): McpClient {
    const client = this.clients.get(name);
    if (!client) {
      throw new Error(`MCP client not started: ${name}`);
    }
    return client;
  }

  stopAll(): void {
    console.error("[mcp] stopping all MCP servers");
    for (const client of this.clients.values()) {
      client.stop?.();
    }
    this.clients.clear();
  }
}
