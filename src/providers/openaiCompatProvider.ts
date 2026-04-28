import type { ChatMessage, JsonObject, JsonValue, ModelResponse, ToolCall } from "../types/protocol";

export interface LlmProvider {
  complete(messages: ChatMessage[], tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): Promise<ModelResponse>;
}

interface OpenAiCompatConfig {
  baseUrl: string;
  apiKey?: string;
  modelName: string;
  timeoutMs: number;
}

const MODEL_TRACE = Bun.env.MODEL_TRACE === "1" || Bun.env.DEV_TRACE === "1";

function trace(message: string): void {
  if (MODEL_TRACE) {
    console.error(`[model:openaiCompat] ${message}`);
  }
}

export class OpenAiCompatProvider implements LlmProvider {
  constructor(private readonly config: OpenAiCompatConfig) {}

  async complete(messages: ChatMessage[], tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const endpoint = `${this.config.baseUrl}/v1/chat/completions`;
    const startedAt = Date.now();
    try {
      trace(`request.start endpoint=${endpoint} model=${this.config.modelName} messages=${messages.length} tools=${tools.length} timeoutMs=${this.config.timeoutMs}`);
      const payload: Record<string, unknown> = {
        model: this.config.modelName,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          tool_call_id: message.toolCallId,
          name: message.name
        }))
      };
      if (tools.length > 0) {
        payload.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description ?? "",
            parameters: tool.inputSchema ?? { type: "object", properties: {} }
          }
        }));
        payload.tool_choice = "auto";
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const elapsedMs = Date.now() - startedAt;
      trace(`request.response status=${res.status} elapsedMs=${elapsedMs} contentType=${res.headers.get("content-type") ?? "unknown"}`);
      if (!res.ok) {
        const bodyPreview = await this.readBodyPreview(res);
        throw new Error(`OpenAI-compat request failed with status=${res.status} body=${bodyPreview}`);
      }
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("text/event-stream")) {
        trace("response.mode=stream");
        return await this.parseStreamingResponse(res);
      }
      trace("response.mode=json");
      return await this.parseJsonResponse(res);
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[model:openaiCompat] request.error elapsedMs=${elapsedMs} reason=${reason}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseJsonResponse(res: Response): Promise<ModelResponse> {
    let data: any;
    try {
      data = await res.json();
    } catch (error) {
      throw new Error(`Failed to parse JSON model response: ${error instanceof Error ? error.message : String(error)}`);
    }
    const choice = data.choices?.[0]?.message;
    const toolCalls = (choice?.tool_calls ?? []).map((call: any): ToolCall => ({
      id: call.id,
      name: call.function?.name,
      arguments: this.parseArguments(call.function?.arguments)
    }));
    return {
      text: typeof choice?.content === "string" ? choice.content : undefined,
      toolCalls
    };
  }

  private async parseStreamingResponse(res: Response): Promise<ModelResponse> {
    if (!res.body) {
      return { text: "" };
    }

    const textParts: string[] = [];
    const toolCallParts = new Map<number, { id: string; name: string; argumentsText: string }>();
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          continue;
        }
        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = parsed.choices?.[0]?.delta;
        if (typeof delta?.content === "string") {
          textParts.push(delta.content);
        }
        const deltaToolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
        for (const item of deltaToolCalls) {
          const index = typeof item.index === "number" ? item.index : 0;
          const existing = toolCallParts.get(index) ?? {
            id: item.id ?? crypto.randomUUID(),
            name: "",
            argumentsText: ""
          };
          if (typeof item.id === "string" && item.id) {
            existing.id = item.id;
          }
          if (typeof item.function?.name === "string" && item.function.name) {
            existing.name = item.function.name;
          }
          if (typeof item.function?.arguments === "string") {
            existing.argumentsText += item.function.arguments;
          }
          toolCallParts.set(index, existing);
        }
      }
    }

    trace(`stream.done textChars=${textParts.join("").length} toolCalls=${toolCallParts.size}`);
    const toolCalls: ToolCall[] = Array.from(toolCallParts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => ({
        id: value.id,
        name: value.name,
        arguments: this.parseArguments(value.argumentsText)
      }))
      .filter((toolCall) => Boolean(toolCall.name));

    return {
      text: textParts.join(""),
      toolCalls
    };
  }

  private parseArguments(raw: unknown): JsonObject {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as JsonObject;
    }
    if (typeof raw !== "string") {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as JsonValue;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as JsonObject;
      }
      return {};
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
