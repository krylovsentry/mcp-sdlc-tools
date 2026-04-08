import type { ChatMessage, ModelResponse, ToolCall } from "../types/protocol";
import type { LlmProvider } from "./openaiCompatProvider";

interface OllamaConfig {
  baseUrl: string;
  modelName: string;
  apiKey?: string;
  timeoutMs: number;
}

const MODEL_TRACE = Bun.env.MODEL_TRACE === "1" || Bun.env.DEV_TRACE === "1";

function trace(message: string): void {
  if (MODEL_TRACE) {
    console.error(`[model:ollama] ${message}`);
  }
}

export class OllamaProvider implements LlmProvider {
  constructor(private readonly config: OllamaConfig) {}

  async complete(messages: ChatMessage[], tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const endpoint = `${this.config.baseUrl}/api/chat`;
    const startedAt = Date.now();
    try {
      trace(`request.start endpoint=${endpoint} model=${this.config.modelName} messages=${messages.length} tools=${tools.length} timeoutMs=${this.config.timeoutMs}`);
      const res = await fetch(endpoint, {
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
      const elapsedMs = Date.now() - startedAt;
      trace(`request.response status=${res.status} elapsedMs=${elapsedMs} contentType=${res.headers.get("content-type") ?? "unknown"}`);
      if (!res.ok) {
        const bodyPreview = await this.readBodyPreview(res);
        throw new Error(`Ollama request failed with status=${res.status} body=${bodyPreview}`);
      }
      let data: any;
      try {
        data = await res.json();
      } catch (error) {
        throw new Error(`Failed to parse Ollama JSON response: ${error instanceof Error ? error.message : String(error)}`);
      }
      const toolCalls = (data.message?.tool_calls ?? []).map((call: any): ToolCall => ({
        id: call.id ?? crypto.randomUUID(),
        name: call.function?.name,
        arguments: typeof call.function?.arguments === "string"
          ? this.parseArguments(call.function.arguments)
          : (call.function?.arguments ?? {})
      }));
      trace(`response.done textChars=${typeof data.message?.content === "string" ? data.message.content.length : 0} toolCalls=${toolCalls.length}`);
      return {
        text: data.message?.content,
        toolCalls
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[model:ollama] request.error elapsedMs=${elapsedMs} reason=${reason}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private parseArguments(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private async readBodyPreview(res: Response): Promise<string> {
    try {
      const text = await res.text();
      return text.length > 300 ? `${text.slice(0, 300)}...<truncated>` : text;
    } catch {
      return "<unavailable>";
    }
  }
}
