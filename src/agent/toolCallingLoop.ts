import type { AppConfig } from "../config/schema";
import type { McpToolGateway } from "../mcp/toolGateway";
import type { ChatMessage } from "../types/protocol";
import { systemPrompt, testGenerationSystemPrompt } from "./prompting";
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
  userPrompt: string,
  options?: { disableTools?: boolean; testGeneration?: boolean }
): Promise<string> {
  trace("input.userPrompt", userPrompt);
  const tools = options?.disableTools ? [] : await toolGateway.refreshToolIndex();
  trace("input.tools", tools.map((tool) => tool.name));
  const systemContent = options?.disableTools && options?.testGeneration
    ? testGenerationSystemPrompt()
    : systemPrompt();
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userPrompt }
  ];
  let lastText = "";
  let lastToolSignature = "";
  let sameToolSignatureCount = 0;

  for (let i = 0; i < config.agent.maxIterations; i += 1) {
    trace("loop.iteration", i + 1);
    const response = await provider.complete(messages, tools);
    trace("output.model.text", response.text ?? "");
    trace("output.model.toolCalls", response.toolCalls ?? []);
    if (response.text && response.text.trim()) {
      lastText = response.text.trim();
    }
    if (response.toolCalls && response.toolCalls.length > 0) {
      if (options?.disableTools) {
        trace("loop.disableTools.ignoringToolCalls", response.toolCalls);
        if (lastText) {
          return lastText;
        }
        return "Model returned tool calls while tools are disabled. No text output produced.";
      }
      const toolSignature = JSON.stringify(
        response.toolCalls.map((toolCall) => ({
          name: toolCall.name,
          arguments: toolCall.arguments
        }))
      );
      if (toolSignature === lastToolSignature) {
        sameToolSignatureCount += 1;
      } else {
        sameToolSignatureCount = 0;
        lastToolSignature = toolSignature;
      }
      if (sameToolSignatureCount >= 2) {
        const loopHint = "Model repeated same tool calls multiple times. Stopping to avoid infinite loop.";
        trace("loop.break.repeatedToolCalls", loopHint);
        if (lastText) {
          return `${lastText}\n\n[Loop guard] ${loopHint}`;
        }
        return `[Loop guard] ${loopHint}`;
      }
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
  if (lastText) {
    return `${lastText}\n\n[Loop guard] Reached max iterations (${config.agent.maxIterations}).`;
  }
  throw new Error(
    `Agent loop exceeded max iterations (${config.agent.maxIterations}). ` +
    "Enable DEV_TRACE=1 and MODEL_TRACE=1 to inspect repeated tool call patterns."
  );
}
