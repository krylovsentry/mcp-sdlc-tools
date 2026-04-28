# Tool Gateway Architecture

## High-Level Flow

```mermaid
flowchart LR
  userPrompt[UserPrompt] --> agentLoop[ToolCallingLoop]
  agentLoop --> modelProvider[ModelProvider]
  modelProvider --> agentLoop

  agentLoop --> toolGateway[McpToolGateway]

  toolGateway --> listReq["tools/list per server"]
  listReq --> serverManager[ServerManager]

  serverManager --> playwrightClient[PlaywrightClient]
  serverManager --> postmanClient[PostmanClient]

  playwrightClient --> transports[StdioTransport_or_SseTransport]
  postmanClient --> transports

  transports --> mcpServers[McpServers]

  toolGateway --> callReq["tools/call by namespaced tool"]
  callReq --> serverManager
  serverManager --> mcpServers

  mcpServers --> toolResult[ToolResult]
  toolResult --> toolGateway
  toolGateway --> agentLoop
  agentLoop --> finalAnswer[FinalAnswer]
```

## Component Responsibilities

- `ToolCallingLoop`
  - Sends messages to model provider.
  - Decides whether to continue with tool calls or return final answer.

- `McpToolGateway`
  - Discovers tools from all configured MCP servers (`tools/list`).
  - Builds namespaced tool index (for example `playwright.browser_navigate`).
  - Routes each `tools/call` request to the right server.

- `ServerManager`
  - Starts/stops MCP server processes.
  - Creates and caches transport clients per server.

- `Stdio/SSE Transports`
  - Handles JSON-RPC request/response flow to MCP servers.
  - Applies timeout and error propagation.

- `MCP Servers`
  - Execute real tool actions (browser automation and Postman MCP operations).

## Runtime Sequence

1. Agent loop asks gateway for available tools.
2. Gateway calls `tools/list` on each server and caches tool metadata.
3. Model returns a tool call.
4. Gateway resolves the namespaced tool and issues `tools/call`.
5. Tool result is injected back into loop context.
6. Loop repeats until model produces final response.

## OpenAPI/Swagger Collection Generation (Offline)

OpenAPI/Swagger collection generation is intentionally separate from the MCP tool gateway path:

- Entry point: `bun run openapi:postman`
- Implementation: `src/openapiToPostman.ts` + `src/openapiToPostman.cli.ts`
- Converter: `openapi-to-postmanv2` (schemaFaker on/off)
- Outputs: API collection, optional test-data collection, optional fixtures collection (POST/PUT/PATCH filtered)

```mermaid
flowchart LR
  specInput[OpenAPI_or_SwaggerSpec] --> converterApi["Converter schemaFaker:false"]
  specInput --> converterData["Converter schemaFaker:true"]
  converterApi --> apiOutput[ApiCollectionJson]
  converterData --> testDataOutput[TestDataCollectionJson]
  converterData --> fixturesFilter[FilterPostPutPatch]
  fixturesFilter --> fixturesOutput[FixturesCollectionJson]
```
