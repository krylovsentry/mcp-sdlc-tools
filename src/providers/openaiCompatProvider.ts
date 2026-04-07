import type { ChatMessage, ModelResponse, ToolCall } from "../types/protocol";

export interface LlmProvider {
  complete(messages: ChatMessage[], tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): Promise<ModelResponse>;
}

interface OpenAiCompatConfig {
  baseUrl: string;
  apiKey?: string;
  modelName: string;
  timeoutMs: number;
}

export class OpenAiCompatProvider implements LlmProvider {
  constructor(private readonly config: OpenAiCompatConfig) {}

  async complete(messages: ChatMessage[], tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.config.modelName,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content,
            tool_call_id: message.toolCallId,
            name: message.name
          })),
          tools: tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description ?? "",
              parameters: tool.inputSchema ?? { type: "object", properties: {} }
            }
          })),
          tool_choice: "auto"
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`OpenAI-compat request failed with ${res.status}`);
      }
      const data = await res.json();
      const choice = data.choices?.[0]?.message;
      const toolCalls = (choice?.tool_calls ?? []).map((call: any): ToolCall => ({
        id: call.id,
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments || "{}")
      }));
      return {
        text: typeof choice?.content === "string" ? choice.content : undefined,
        toolCalls
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
