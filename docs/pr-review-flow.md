# PR diff review (LLM)

This repo includes a small **stub** flow: read a **unified diff**, send it to the configured model with a review system prompt, then write the review to **stdout** or a **file**. There is no GitHub or GitLab integration yet; the diff always comes from a file or stdin.

- **Script:** `bun run review:pr` → [`reviewPr.ts`](../src/reviewPr.ts)
- **Model:** same `config/servers.json` provider as the rest of the app (`openaiCompat` or `ollama`).
- **Tools:** none (`llm.complete` with an empty tool list).

## CLI reference

| Argument | Required | Description |
|----------|----------|-------------|
| `--config <path>` | No | Config file (default: `config/servers.json`). |
| `--diff <path>` | No* | Read unified diff from this file. If omitted, diff is read from **stdin**. |
| `--output <path>` | No | Write the review to this file. If omitted, uses `prReview.outputPath` from config when set; otherwise prints to **stdout**. |
| `--title "text"` | No | Shown in the prompt as the PR title (helps the model). |

\* You must provide a non-empty diff either via `--diff` or by piping stdin.

### Config: default output file

Optional in `config/servers.json`:

```json
{
  "prReview": {
    "outputPath": ".artifacts/pr-review-last.md"
  }
}
```

When `--output` is not passed, this path is used if present; otherwise the review goes to stdout.

## Examples

### Review a patch file (stdout)

```bash
bun run review:pr -- --diff path/to/changes.diff
```

### Pipe `git diff` (branch range)

```bash
git diff main...HEAD | bun run review:pr --
```

### Staged changes only

```bash
git diff --cached | bun run review:pr --
```

### Unstaged working tree

```bash
git diff | bun run review:pr --
```

### Title + write to a file

```bash
bun run review:pr -- \
  --diff changes.diff \
  --output review.md \
  --title "feat: add widget"
```

### Alternate config

```bash
bun run review:pr -- --config config/servers.json --diff changes.diff
```

Arguments after `--` are passed to the script (`--config`, `--diff`, etc.).

### Source Code API v2: token/cookie + `--branch` / `--commit` (quality POST)

Replace placeholders: `<JWT>`, head branch name, and full commit SHA. Values below match the v2 layout used in repo tests (`.../api/v2/projects/...`).

**1 — Bearer token from env; fetch diff and POST review to `.../repos/.../issues` only (no local file)**

```bash
export SOURCE_CODE_API_TOKEN="<JWT>"
bun run review:pr -- \
  --provider sourceCodeApi \
  --base-url "https://scm.example.com/app/sourcecode/api/api/v2" \
  --project-key "ACME/platform" \
  --repo-name "checkout-svc" \
  --pr-id 42 \
  --branch "feature/your-branch" \
  --commit "0000000000000000000000000000000000000000"
```

**2 — Same auth + branch/commit, plus `--emit-all`: write markdown, POST review, print body on stdout**

```bash
export SOURCE_CODE_API_TOKEN="<JWT>"
bun run review:pr -- \
  --provider sourceCodeApi \
  --emit-all \
  --base-url "https://scm.example.com/app/sourcecode/api/api/v2" \
  --project-key "ACME/platform" \
  --repo-name "checkout-svc" \
  --pr-id 42 \
  --branch "feature/your-branch" \
  --commit "0000000000000000000000000000000000000000" \
  --output ".artifacts/pr-review-last.md"
```

**3 — Pasted browser / Keycloak `Set-Cookie` line in env (optional `--token` omitted); tool strips `Max-Age`, `Path`, etc., and also sends `Authorization: Bearer` from `ACCESS_TOKEN`**

```bash
export SOURCE_CODE_API_COOKIE='ACCESS_TOKEN=<JWT>; Max-Age=28744; Path=/; Secure; HttpOnly'
bun run review:pr -- \
  --provider sourceCodeApi \
  --emit-all \
  --base-url "https://scm.example.com/app/sourcecode/api/api/v2" \
  --project-key "ACME/platform" \
  --repo-name "checkout-svc" \
  --pr-id 42 \
  --branch "feature/your-branch" \
  --commit "0000000000000000000000000000000000000000" \
  --output ".artifacts/pr-review-last.md"
```

You can add `--quality-path` / `--quality-severity` / `--quality-repo-task-name` (maps to `repoTask.name` on POST `.../issues`; default name is `LLM PR review #<prId>`) if your API expects them. Session-only cookies: merge into `SOURCE_CODE_API_COOKIE` (`SESSIONID=...; route=1; ...`) and keep `ACCESS_TOKEN=...` as needed.

For gateways that require **HTTP Basic**, use `--basic-user` and `--basic-password`, or env `SOURCE_CODE_API_BASIC_USER` / `SOURCE_CODE_API_BASIC_PASSWORD`, or `prReview.basicUser` / `basicPassword` in config. If you also pass a bearer JWT, the `Authorization` header is Basic and the JWT is still sent via the `ACCESS_TOKEN` cookie.

### Windows PowerShell

Pipe works the same:

```powershell
git diff main...HEAD | bun run review:pr --
```

Review a file:

```powershell
bun run review:pr -- --diff .\changes.diff --output .\review.md --title "fix: handle null"
```

### Empty diff

If stdin and `--diff` produce an empty string, the command fails with: `Diff is empty. Pass --diff path/to/patch.diff or pipe a unified diff on stdin.`

## Architecture

1. [`PullRequestProvider`](../src/pr/types.ts) — `fetchDiff` + `postComment`.
2. **Stub** ([`stubPrProvider.ts`](../src/pr/stubPrProvider.ts)) — diff is supplied from CLI/stdin; `postComment` prints or writes the model output.
3. [`runPrReview`](../src/pr/runReview.ts) — `fetchDiff` → `complete(messages, [])` → `postComment`.
4. [`reviewPrompt.ts`](../src/pr/reviewPrompt.ts) — builds system + user messages (title + fenced diff).

Future work: a **GitHub** or **GitLab** adapter that implements `fetchDiff` from the API and `postComment` as a PR review comment.

## More commands

Other scripts (agent, tests, scaffold): [commands-and-examples.md](commands-and-examples.md).
