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
