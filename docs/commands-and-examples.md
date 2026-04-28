# Commands and examples

Copy-paste examples for common tasks. Configure the model and MCP servers in `config/servers.json` first (see [`config/servers.example.json`](../config/servers.example.json)).

## Setup

```bash
bun install
cp config/servers.example.json config/servers.json
# Windows (cmd):  copy config\servers.example.json config\servers.json
# Windows (PowerShell): Copy-Item config\servers.example.json config\servers.json
```

Edit `config/servers.json`: model `baseUrl`, `modelName`, API keys, and MCP server `command` / `args`.

## Run the MCP agent (tools + model)

```bash
bun run start --prompt "Open a page and summarize the title"
```

Custom config file:

```bash
bun run start --config config/servers.json --prompt "Your prompt here"
```

## Smoke-check MCP servers

```bash
bun run smoke
```

## Tests: scaffold, generate, run

**1. Copy committed runners into `testing/`**

```bash
bun run scaffold:testing
```

**2. Install dependencies in each runner**

```bash
bun install --cwd testing/playwright
bun install --cwd testing/postman
```

**3. (First time) Playwright browsers**

```bash
cd testing/playwright
bunx playwright install chromium
cd ../..
```

**4. Generate test files from the model**

Uses [`prompts/generate-tests-autonomous.txt`](../prompts/generate-tests-autonomous.txt) and your configured model. The writer strips accidental **inner** markdown code fences from `.ts` / `.json` bodies so specs stay runnable if the model double-wraps output.

```bash
bun run generate:tests
```

Dry run (parse output, do not write files):

```bash
bun run generate:tests -- --dry-run
```

Only allow “content” paths (specs, collections, env JSON, `testing/catalog.json`):

```bash
bun run generate:tests -- --strict-test-paths
```

Or via environment variable:

```bash
# Unix / Git Bash
GENERATE_TESTS_STRICT=1 bun run generate:tests
```

```powershell
# Windows PowerShell
$env:GENERATE_TESTS_STRICT="1"; bun run generate:tests
```

```bat
REM Windows cmd
set GENERATE_TESTS_STRICT=1 && bun run generate:tests
```

Custom prompt file:

```bash
bun run generate:tests -- --prompt-file path/to/prompt.txt
```

**5. Run Playwright and Newman from repo root**

```bash
bun run test:playwright
bun run test:postman
```

Playwright with a custom base URL:

```bash
# Unix / Git Bash
BASE_URL=https://example.com bun run test:playwright
```

```powershell
# Windows PowerShell
$env:BASE_URL="https://example.com"; bun run test:playwright
```

Directory layout and Newman details: [testing-executable-structure.md](testing-executable-structure.md).

## Generate Postman collections from OpenAPI/Swagger

Deterministic conversion without the LLM generation path:

```bash
bun run openapi:postman -- --spec path/to/openapi.yaml --out testing/postman/collections/service-api.collection.json
```

Generate API + test-data + fixtures collections:

```bash
bun run openapi:postman -- \
  --spec path/to/openapi.yaml \
  --out testing/postman/collections/service-api.collection.json \
  --testdata-out testing/postman/collections/service-testdata.collection.json \
  --fixtures-out testing/postman/collections/service-fixtures.collection.json
```

Pass converter options (repeatable):

```bash
bun run openapi:postman -- \
  --spec path/to/openapi.yaml \
  --out testing/postman/collections/service-api.collection.json \
  --converter-option folderStrategy=Tags \
  --converter-option requestNameSource=operationId
```

## Model-only regression checks (`model:test`)

No MCP tools; runs canned prompts from a JSON file:

```bash
bun run model:test
bun run model:test -- --cases prompts/model-test-cases.json
```

## PR diff review (`review:pr`)

No MCP tools; sends a unified diff to the model. Full options: [pr-review-flow.md](pr-review-flow.md).

```bash
bun run review:pr -- --diff path/to/changes.diff
bun run review:pr -- --diff changes.diff --output review.md --title "feat: add widget"
git diff main...HEAD | bun run review:pr --
```

PowerShell (pipe git diff):

```powershell
git diff main...HEAD | bun run review:pr --
```

## Repo unit tests

```bash
bun test tests
# or
bun run test
```

## Debugging and tracing

**Package scripts** (work on Windows, macOS, and Linux via `cross-env`):

```bash
bun run dev:debug:agent -- --prompt "Hello"
bun run dev:debug:smoke
bun run dev:debug:generate
bun run dev:debug:model:test
bun run dev:debug:review -- --diff path/to/changes.diff
```

**Manual env** (Unix / Git Bash):

```bash
DEV_TRACE=1 MODEL_TRACE=1 bun run start --prompt "..."
```

Windows PowerShell:

```powershell
$env:DEV_TRACE="1"; $env:MODEL_TRACE="1"; bun run start --prompt "..."
```

## See also

| Topic | Document |
|--------|----------|
| PR review CLI and architecture | [pr-review-flow.md](pr-review-flow.md) |
| Playwright / Postman layout | [testing-executable-structure.md](testing-executable-structure.md) |
| SDLC / process context | [autonomous-testing-sdlc.md](autonomous-testing-sdlc.md) |
| MCP tool gateway | [tool-gateway-architecture.md](tool-gateway-architecture.md) |
| README overview | [README.md](../README.md) |
