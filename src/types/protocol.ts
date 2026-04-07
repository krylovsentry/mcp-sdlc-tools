export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: JsonValue;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number;
  result: JsonValue;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: number;
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
}

export interface McpToolCallResult {
  content?: JsonValue;
  isError?: boolean;
  [key: string]: JsonValue | undefined;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

export interface ModelResponse {
  text?: string;
  toolCalls?: ToolCall[];
}
