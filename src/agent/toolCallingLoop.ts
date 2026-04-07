import type { AppConfig } from "../config/schema";
import type { McpToolGateway } from "../mcp/toolGateway";
import type { ChatMessage } from "../types/protocol";
import { systemPrompt } from "./prompting";
import type { LlmProvider } from "../providers/openaiCompatProvider";

const DEV_TRACE = Bun.env.DEV_TRACE === "1";

function trace(message: string, payload?: unknown): void {
  if (!DEV_TRACE) {
    return;
  }
  if (payload === undefined) {
    console.error(`[dev-trace] ${message}`);
    return;
  }
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const preview = raw.length > 1200 ? `${raw.slice(0, 1200)}...<truncated>` : raw;
  console.error(`[dev-trace] ${message}: ${preview}`);
}

export async function runToolCallingLoop(
  provider: LlmProvider,
  toolGateway: McpToolGateway,
  config: AppConfig,
  userPrompt: string
): Promise<string> {
  trace("input.userPrompt", userPrompt);
  const tools = await toolGateway.refreshToolIndex();
  trace("input.tools", tools.map((tool) => tool.name));
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: userPrompt }
  ];

  for (let i = 0; i < config.agent.maxIterations; i += 1) {
    trace("loop.iteration", i + 1);
    const response = await provider.complete(messages, tools);
    trace("output.model.text", response.text ?? "");
    trace("output.model.toolCalls", response.toolCalls ?? []);
    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const toolCall of response.toolCalls) {
        messages.push({
          role: "assistant",
          content: "",
          toolCallId: toolCall.id,
          name: toolCall.name
        });
        try {
          const result = await toolGateway.callTool(toolCall.name, toolCall.arguments);
          trace(`output.toolResult.${toolCall.name}`, result);
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify(result)
          });
        } catch (error) {
          trace(`output.toolError.${toolCall.name}`, error instanceof Error ? error.message : String(error));
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify({
              isError: true,
              message: error instanceof Error ? error.message : String(error)
            })
          });
        }
      }
      continue;
    }
    if (response.text && response.text.trim()) {
      return response.text;
    }
    return "No model response text was returned.";
  }
  throw new Error("Agent loop exceeded max iterations.");
}
