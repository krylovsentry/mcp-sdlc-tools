import type { JsonValue } from "../../types/protocol";

export class SseMcpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly headers?: Record<string, string>
  ) {}

  async request(method: string, params?: JsonValue, timeoutMs = 45_000): Promise<JsonValue> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/rpc`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.headers ?? {})
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`SSE MCP request failed with ${res.status}`);
      }
      const data = await res.json();
      if ("error" in data) {
        throw new Error(data.error?.message ?? "Unknown MCP error");
      }
      return data.result as JsonValue;
    } finally {
      clearTimeout(timeout);
    }
  }
}
