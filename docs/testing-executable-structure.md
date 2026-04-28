# Playwright and Postman executable layout

This document defines **where generated or hand-written tests live** and **how to run them**.  
Generated output under `testing/` may be gitignored; use **`templates/testing/`** as the committed reference tree.

## Committed scaffold

The repo ships **runnable** Playwright and Newman packages under [`templates/testing/`](../templates/testing/):

- **Playwright**: `package.json`, `playwright.config.ts`, `tsconfig.json`, and tier folders `smoke/`, `critical/`, `regression/`, plus `helpers/`.
- **Postman**: `package.json`, `collections/` (including a minimal stub collection), `environments/local.environment.json`.
- **Catalog**: `catalog.json` at the `templates/testing/` root (copied next to `playwright/` and `postman/`).

**Copy into your working tree** (creates `testing/playwright`, `testing/postman`, `testing/catalog.json`):

```bash
bun run scaffold:testing
```

Then install dependencies in each runner. From the **repository root** (works the same on Windows, macOS, and Linux):

```bash
bun install --cwd testing/playwright
bun install --cwd testing/postman
```

Equivalent using shell `cd`:

```bash
cd testing/playwright && bun install && cd ../postman && bun install
```

From the **repository root**, run shortcuts:

```bash
bun run test:playwright
bun run test:postman
```

Set `BASE_URL` when running Playwright if the committed default in `playwright.config.ts` is not your target (for example `BASE_URL=https://www.example.com bun run test:playwright`).

On a **fresh machine**, install browsers once after `bun install --cwd testing/playwright`:

```bash
cd testing/playwright
bunx playwright install chromium
```

Use `playwright install --with-deps` on Linux CI if the image lacks browser dependencies.

Re-running `scaffold:testing` overwrites files that exist in `templates/testing/` but **does not delete** extra files already under `testing/` (for example old generated specs). Remove stale paths manually if they conflict.

**Model-generated tests** (`bun run generate:tests`) should only add or replace **content** files: `*.spec.ts` under the tier folders, JSON under `collections/` and optionally `environments/`, and optionally `testing/catalog.json`. Runner boilerplate is not regenerated. To enforce allowed paths at write time, use `bun run generate:tests -- --strict-test-paths` or set `GENERATE_TESTS_STRICT=1`.

---

## Top-level split

| Area | Root directory | Runner |
|------|----------------|--------|
| Browser UI | `testing/playwright/` | Playwright Test (`@playwright/test`) |
| HTTP API | `testing/postman/` | Newman (CLI) |

Optional shared metadata:

| File | Purpose |
|------|---------|
| `testing/catalog.json` | Maps suites to paths, tags, and CI tier (smoke / critical / regression). |

---

## Playwright (`testing/playwright/`)

### Recommended layout

```text
testing/playwright/
  playwright.config.ts          # baseURL, projects, reporter, screenshot on failure
  helpers/                      # optional shared fixtures, page objects
    app.ts
  smoke/                        # fast PR gate
    *.spec.ts
  critical/                     # must-pass before release
    *.spec.ts
  regression/                   # broader nightly
    *.spec.ts
```

### Conventions

- **Specs**: `*.spec.ts` (or `*.test.ts` if you standardize on one—pick one project-wide).
- **Tags**: use `test.describe.configure({ tag: '@smoke' })` or project names in `playwright.config.ts` to separate smoke vs regression.
- **Naming**: `feature-area-behavior.spec.ts` (kebab-case file names).

### Commands (examples)

With `playwright.config.ts` in `testing/playwright/` and `testDir: "."`, run from that directory:

```bash
cd testing/playwright && bunx playwright test smoke --project=chromium
cd testing/playwright && bunx playwright test regression
```

Or use `bun run test:playwright` from the repo root (after `scaffold:testing` and `bun install` under `testing/playwright`).

---

## Postman / Newman (`testing/postman/`)

### Recommended layout

```text
testing/postman/
  collections/
    <service-or-scope>-smoke.collection.json
    <service-or-scope>-regression.collection.json
  environments/
    local.environment.json
    ci.environment.json
  newman/                         # optional
    README.md                     # documented run lines
```

### Conventions

- **Collections**: one JSON per major flow or per microservice; split smoke vs regression by collection or by folder.
- **Environments**: never hardcode secrets in JSON committed to git; use CI variables or local-only env files (gitignored).
- **Variables**: use `{{baseUrl}}`, `{{apiKey}}`, etc., in collection URLs and headers.

### Commands (examples)

From the **repository root**:

```bash
bunx newman run testing/postman/collections/stub-smoke.collection.json \
  -e testing/postman/environments/local.environment.json
```

Or use the package script after `scaffold:testing` and `bun install --cwd testing/postman`:

```bash
bun run test:postman
```

From `testing/postman/`:

```bash
newman run collections/stub-smoke.collection.json -e environments/local.environment.json
```

---

## Catalog (`testing/catalog.json`)

Optional machine-readable index for CI and generators:

```json
{
  "version": 1,
  "playwright": {
    "config": "testing/playwright/playwright.config.ts",
    "suites": [
      { "name": "smoke", "path": "testing/playwright/smoke", "tags": ["smoke"] }
    ]
  },
  "postman": {
    "suites": [
      { "name": "smoke", "collection": "testing/postman/collections/app-smoke.collection.json", "environment": "testing/postman/environments/ci.environment.json" }
    ]
  }
}
```

Shape is advisory; extend as needed.

---

## Relation to this repo

- **Templates (committed)**: [`templates/testing/`](../templates/testing/) is the source of truth for runner packages; use `bun run scaffold:testing` to populate `testing/`.
- **Generated output**: specs and collections are written under `testing/` by `bun run generate:tests` (may be ignored by `.gitignore`); optional `--strict-test-paths` keeps output to content files only.
- **End-to-end workflow** (configure model, scaffold, generate, run): [README Usage](../README.md#usage) and [commands-and-examples.md](commands-and-examples.md).

---

## CI tiers (suggested)

| Tier | Playwright | Postman |
|------|------------|---------|
| PR | `smoke/` only | `*-smoke.collection.json` |
| Main | smoke + selected `critical/` | smoke + critical collections |
| Nightly | full `regression/` | full regression collections |
