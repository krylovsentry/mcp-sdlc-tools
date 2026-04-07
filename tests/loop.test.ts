import { describe, expect, test } from "bun:test";
import { runToolCallingLoop } from "../src/agent/toolCallingLoop";
import type { AppConfig } from "../src/config/schema";
import type { ModelResponse } from "../src/types/protocol";

describe("tool calling loop", () => {
  test("executes tool call and returns final answer", async () => {
    const config: AppConfig = {
      model: {
        provider: "openaiCompat",
        modelName: "model",
        baseUrl: "http://localhost:1234",
        timeoutMs: 1_000
      },
      mcp: {
        playwright: {
          enabled: true,
          transport: "sse",
          sse: { url: "http://localhost:7000" }
        },
        postman: {
          enabled: true,
          transport: "sse",
          sse: { url: "http://localhost:7001" }
        }
      },
      agent: {
        maxIterations: 4,
        toolTimeoutMs: 1_000,
        requestTimeoutMs: 1_000
      }
    };

    let count = 0;
    const provider = {
      async complete(): Promise<ModelResponse> {
        count += 1;
        if (count === 1) {
          return {
            toolCalls: [
              {
                id: "call-1",
                name: "playwright.navigate",
                arguments: { url: "https://example.com" }
              }
            ]
          };
        }
        return { text: "Navigation complete." };
      }
    };

    const toolGateway = {
      async refreshToolIndex() {
        return [{ name: "playwright.navigate", description: "Navigate to URL" }];
      },
      async callTool() {
        return { content: "ok" };
      }
    };

    const answer = await runToolCallingLoop(provider, toolGateway, config, "Go to example.com");
    expect(answer).toBe("Navigation complete.");
  });
});
