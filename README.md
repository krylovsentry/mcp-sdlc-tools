# Local MCP + Local Model Framework

Bun-based local framework that:
- auto-launches local `MCP Playwright` and `MCP Postman` servers,
- supports MCP over `stdio` and `SSE`,
- supports local models via OpenAI-compatible `chat/completions` and Ollama.

## Quick start

1. Install dependencies:
   - `bun install`
2. Copy config:
   - `cp config/servers.example.json config/servers.json`
3. Update model and server commands in `config/servers.json`.
4. Run:
   - `bun run start --prompt "Open a page and summarize the title"`
5. Smoke-check MCP server wiring:
   - `bun run smoke`
6. Run test-generation prompt from file:
   - `bun run generate:tests`
   - dry run (parse only, no file writes): `bun run generate:tests -- --dry-run`

## Model providers

- `openaiCompat`: uses `POST {baseUrl}/v1/chat/completions`
- `ollama`: uses `POST {baseUrl}/api/chat`

### Ollama config examples

- Local Ollama:
  - `cp config/servers.ollama-local.example.json config/servers.json`
- Cloud Ollama (`deepseek-v3.1:671b-cloud`):
  - `cp config/servers.ollama-cloud.example.json config/servers.json`
  - set `model.baseUrl` to your real cloud endpoint
  - create secrets file:
    - `cp .secrets/api-keys.example.json .secrets/api-keys.json`
  - put your real key in `.secrets/api-keys.json`

Switch providers via:

```json
{
  "model": {
    "provider": "openaiCompat"
  }
}
```

## MCP server transport

Each server (`playwright`, `postman`) supports:
- `stdio` mode with `command` and `args`
- `sse` mode with `url`

## Notes

- Server logs are written to stderr.
- The agent loop has max iteration and timeout guards.
- For stdio servers, avoid printing JSON noise to stdout in the server process.
- `model.apiKeyFile` is supported. If set, config loader reads API key from file.
- API key file can be plain text or JSON with `{ "apiKey": "..." }`.
- Dev trace mode: set `DEV_TRACE=1` to log prompt input, model outputs, and tool outputs (truncated).
- `generate:tests` writes real files from model output when the model uses fenced blocks with `FILE: relative/path`.

## Troubleshooting

- Server fails to start:
  - run configured command directly to verify dependencies.
- `ENOENT ... uv_spawn 'npx'`:
  - switch MCP server command to `bunx` in your config, or install Node.js to get `npx`.
- `GET https://registry.npmjs.org/@modelcontextprotocol%2fserver-playwright - 404`:
  - use Playwright MCP package `@playwright/mcp` in config args.
- Tool not found:
  - check `tools/list` support in MCP server and server startup success.
- Model errors:
  - verify `baseUrl`, `modelName`, and model service health.
- Bun command missing:
  - install Bun and reopen terminal.
