import type { McpTool, McpToolCallResult } from "../types/protocol";
import type { ServerManager } from "./serverManager";

type ToolLocator = {
  server: "playwright" | "postman";
  name: string;
};

export class McpToolGateway {
  private readonly index = new Map<string, ToolLocator>();

  constructor(private readonly serverManager: ServerManager, private readonly timeoutMs: number) {}

  async refreshToolIndex(): Promise<McpTool[]> {
    this.index.clear();
    const tools: McpTool[] = [];
    for (const server of ["playwright", "postman"] as const) {
      console.error(`[mcp-tools] listing tools from ${server}`);
      const client = this.serverManager.getClient(server);
      const result = await client.request("tools/list", undefined, this.timeoutMs);
      const serverTools = (result as { tools?: McpTool[] }).tools ?? [];
      console.error(`[mcp-tools] ${server} returned ${serverTools.length} tools`);
      for (const tool of serverTools) {
        const uniqueName = `${server}.${tool.name}`;
        this.index.set(uniqueName, { server, name: tool.name });
        tools.push({ ...tool, name: uniqueName });
      }
    }
    return tools;
  }

  async callTool(fullToolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const locator = this.index.get(fullToolName);
    if (!locator) {
      throw new Error(`Unknown tool: ${fullToolName}`);
    }
    console.error(`[mcp-tools] calling ${fullToolName}`);
    const client = this.serverManager.getClient(locator.server);
    const result = await client.request("tools/call", {
      name: locator.name,
      arguments: args
    }, this.timeoutMs);
    console.error(`[mcp-tools] finished ${fullToolName}`);
    return result as McpToolCallResult;
  }
}
