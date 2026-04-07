import type { ChatMessage, ModelResponse, ToolCall } from "../types/protocol";
import type { LlmProvider } from "./openaiCompatProvider";

interface OllamaConfig {
  baseUrl: string;
  modelName: string;
  apiKey?: string;
  timeoutMs: number;
}

export class OllamaProvider implements LlmProvider {
  constructor(private readonly config: OllamaConfig) {}

  async complete(messages: ChatMessage[], tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.config.modelName,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content
          })),
          tools: tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description ?? "",
              parameters: tool.inputSchema ?? { type: "object", properties: {} }
            }
          })),
          stream: false
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`Ollama request failed with ${res.status}`);
      }
      const data = await res.json();
      const toolCalls = (data.message?.tool_calls ?? []).map((call: any): ToolCall => ({
        id: call.id ?? crypto.randomUUID(),
        name: call.function?.name,
        arguments: typeof call.function?.arguments === "string"
          ? JSON.parse(call.function.arguments)
          : (call.function?.arguments ?? {})
      }));
      return {
        text: data.message?.content,
        toolCalls
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
