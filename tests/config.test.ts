import { describe, expect, test } from "bun:test";
import { parseConfig } from "../src/config/schema";

describe("config schema", () => {
  test("accepts valid stdio config", () => {
    const config = parseConfig({
      model: {
        provider: "openaiCompat",
        modelName: "test-model",
        baseUrl: "http://localhost:11434",
        timeoutMs: 1000
      },
      mcp: {
        playwright: {
          enabled: true,
          transport: "stdio",
          stdio: { command: "node", args: ["server.js"] }
        },
        postman: {
          enabled: true,
          transport: "sse",
          sse: { url: "http://localhost:7000" }
        }
      },
      agent: {
        maxIterations: 3,
        toolTimeoutMs: 1000,
        requestTimeoutMs: 1000
      }
    });
    expect(config.mcp.playwright.transport).toBe("stdio");
    expect(config.mcp.postman.transport).toBe("sse");
  });

  test("rejects missing stdio details", () => {
    expect(() => parseConfig({
      model: {
        provider: "ollama",
        modelName: "llama3.1",
        baseUrl: "http://localhost:11434",
        timeoutMs: 1000
      },
      mcp: {
        playwright: { enabled: true, transport: "stdio" },
        postman: {
          enabled: true,
          transport: "sse",
          sse: { url: "http://localhost:7000" }
        }
      },
      agent: { maxIterations: 2, toolTimeoutMs: 1000, requestTimeoutMs: 1000 }
    })).toThrow();
  });
});
