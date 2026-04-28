# mcp-sdlc-tools

[![Coverage](https://codecov.io/gh/krylovsentry/mcp-sdlc-tools/branch/main/graph/badge.svg)](https://codecov.io/gh/krylovsentry/mcp-sdlc-tools)


Bun-based local framework that:

- auto-launches local MCP servers for **Playwright** and **Postman**,
- supports MCP over **stdio** and **SSE**,
- supports local models via OpenAI-compatible `chat/completions` and **Ollama**.

## Prerequisites

- [Bun](https://bun.sh/) installed and on your `PATH`.

## Configure

1. Install dependencies: `bun install`
2. Copy config: `cp config/servers.example.json config/servers.json` (on Windows: `copy config\servers.example.json config\servers.json`)
3. Edit `config/servers.json`: model endpoint, API keys, and MCP server commands.

See [config/servers.example.json](config/servers.example.json) and the **Model providers** section below.

**Command cheat sheet (all workflows):** [docs/commands-and-examples.md](docs/commands-and-examples.md)

## Usage

### Run the MCP agent (tools + model)

Sends your prompt through the tool-calling loop with MCP servers as configured:

```bash
bun run start --prompt "Open a page and summarize the title"
```

Smoke-check that configured MCP servers start and respond:

```bash
bun run smoke
```

### Generate and run Playwright + Postman tests

The repo ships **committed runner packages** under [`templates/testing/`](templates/testing/). Copy them into a local `testing/` tree (gitignored by default), install dependencies, then generate **content** files only (specs, collections, optional catalog).

| Step | Command |
|------|---------|
| 1. Scaffold | `bun run scaffold:testing` |
| 2. Install runners | `bun install --cwd testing/playwright` and `bun install --cwd testing/postman` (or `cd` into each and `bun install`) |
| 3. (First time) Playwright browsers | `bunx playwright install` with cwd `testing/playwright`, or rely on Playwright’s install hints when you first run tests |
| 4. Generate tests | `bun run generate:tests` (uses [`prompts/generate-tests-autonomous.txt`](prompts/generate-tests-autonomous.txt) and your `config/servers.json` model) |
| 5. Run tests | `bun run test:playwright` and `bun run test:postman` |

Useful flags for generation:

- Dry run (parse model output, no writes): `bun run generate:tests -- --dry-run`
- Only allow content paths (specs, collections, env JSON, `testing/catalog.json`): `bun run generate:tests -- --strict-test-paths` or `GENERATE_TESTS_STRICT=1`

Generation runs with `--disable-tools --test-generation`: the model does **not** call MCP tools; it emits fenced blocks with a `FILE: relative/path` first line inside each block.

Tune prompts and timeouts in [`prompts/generate-tests-autonomous.txt`](prompts/generate-tests-autonomous.txt) and `model.timeoutMs` in config if responses truncate.

**Layout and commands** (tier folders, Newman, optional `catalog.json`): [docs/testing-executable-structure.md](docs/testing-executable-structure.md).

### Generate Postman collections from OpenAPI/Swagger

Use deterministic OpenAPI conversion when you want collections directly from an API spec (without LLM generation):

```bash
bun run openapi:postman -- --spec path/to/openapi.yaml --out testing/postman/collections/service-api.collection.json
```

Generate additional collections for test data and fixture seeding:

```bash
bun run openapi:postman -- \
  --spec path/to/openapi.yaml \
  --out testing/postman/collections/service-api.collection.json \
  --testdata-out testing/postman/collections/service-testdata.collection.json \
  --fixtures-out testing/postman/collections/service-fixtures.collection.json
```

Useful options:

- `--converter-option key=value` (repeatable) to pass options to `openapi-to-postmanv2` (example: `--converter-option folderStrategy=Tags`)
- `--dry-run` to run conversion without writing files

### Model-only checks (no MCP tools)

Runs canned prompts from a JSON file against the configured model (useful for regression-testing the model wiring):

```bash
bun run model:test
bun run model:test -- --cases prompts/model-test-cases.json
```

### PR diff review (no MCP tools)

Sends a unified diff to the model; prints or writes a review. Details: [docs/pr-review-flow.md](docs/pr-review-flow.md).

```bash
bun run review:pr -- --diff path/to/changes.diff
git diff main...HEAD | bun run review:pr --
```

## CLI reference (npm scripts)

| Script | Purpose |
|--------|---------|
| `start` | Agent with MCP tools (`src/index.ts`) |
| `smoke` | MCP server smoke test |
| `test` | Repo unit tests (`bun test tests`) |
| `generate:tests` | Model-driven test file generation |
| `openapi:postman` | Convert OpenAPI/Swagger specs into Postman collections |
| `scaffold:testing` | Copy `templates/testing/*` → `testing/` |
| `test:playwright` | Run Playwright in `testing/playwright` |
| `test:postman` | Run Newman stub/script in `testing/postman` |
| `model:test` | Sequential model prompts from JSON cases |
| `review:pr` | LLM review of a unified diff |
| `dev:debug:agent` | Same as `start` with `DEV_TRACE=1` and `MODEL_TRACE=1` (cross-platform via `cross-env`) |
| `dev:debug:smoke` | Same as `smoke` with tracing |
| `dev:debug:generate` | Same as `generate:tests` with tracing |
| `dev:debug:model:test` | Same as `model:test` with tracing |
| `dev:debug:review` | Same as `review:pr` with tracing |

Pass arguments after `--`, for example: `bun run dev:debug:agent -- --prompt "Hello"`.

## Model providers

- `openaiCompat`: uses `POST {baseUrl}/v1/chat/completions`
- `ollama`: uses `POST {baseUrl}/api/chat`

Capability flags in `config/servers.json`:

- `model.tools`: enable or disable MCP tool calls (`true` / `false`)
- Deprecated alias: `model.supportsTools` — used only if `tools` is omitted; if both are set, **`tools` wins**
- `model.supportsStreaming`: documented capability flag for endpoint behavior

### Ollama examples

- Local: `cp config/servers.ollama-local.example.json config/servers.json`
- Cloud: `cp config/servers.ollama-cloud.example.json config/servers.json`, set `model.baseUrl`, then `cp .secrets/api-keys.example.json .secrets/api-keys.json` and add your key

Switch provider:

```json
{
  "model": {
    "provider": "openaiCompat"
  }
}
```

## Test assets (Playwright + Postman)

- Canonical layout and run examples: [docs/testing-executable-structure.md](docs/testing-executable-structure.md)
- High-level SDLC / process context: [docs/autonomous-testing-sdlc.md](docs/autonomous-testing-sdlc.md)
- Committed runners: [`templates/testing/`](templates/testing/) — copy into `testing/` with `bun run scaffold:testing`

## MCP server transport

Each server (`playwright`, `postman`) supports:

- `stdio` with `command` and `args`
- `sse` with `url`

Architecture notes: [docs/tool-gateway-architecture.md](docs/tool-gateway-architecture.md)

## Notes

- Server logs go to stderr.
- The agent loop enforces max iterations and timeouts.
- For stdio MCP servers, avoid printing raw JSON noise on stdout.
- `model.apiKeyFile`: load API key from a file (plain text or JSON `{ "apiKey": "..." }`).
- `DEV_TRACE=1`: log prompts, model output, and tool output (truncated).
- `MODEL_TRACE=1` (or `DEV_TRACE=1`): log model request timing and parse mode.
- Convenience: `dev:debug:*` scripts in `package.json` set both (see **CLI reference**).
- `generate:tests` persists files when the model returns fenced code blocks whose first line is `FILE: path`. If the model adds an extra inner markdown code fence (e.g. `typescript` / `json` after the `FILE:` line), that wrapper is **stripped** before write so `.spec.ts` and JSON stay valid.
- `review:pr`: optional default output path via `prReview.outputPath` in config when `--output` is omitted.

## Troubleshooting

- **MCP server fails to start:** run the configured `command` + `args` directly in a shell.
- **`ENOENT ... uv_spawn 'npx'`:** use `bunx` in MCP server config, or install Node.js for `npx`.
- **`@modelcontextprotocol/server-playwright` 404:** use `@playwright/mcp` in server args (see upstream Playwright MCP docs).
- **Tool not found:** confirm the server starts and exposes `tools/list`.
- **Model errors:** check `baseUrl`, `modelName`, and service health; set `model.tools` to `false` if the model does not support tools.
- **`test:playwright` fails with syntax errors:** leftover or broken `*.spec.ts` under `testing/playwright/` (for example markdown pasted into a spec). Remove bad files or re-scaffold; `scaffold:testing` does not delete unknown files. Run a single file: `cd testing/playwright && bunx playwright test path/to/file.spec.ts`.
- **Bun not found:** install Bun and reopen the terminal.
