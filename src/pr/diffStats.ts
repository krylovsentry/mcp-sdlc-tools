/**
 * Lightweight stats from a unified diff for logging (no full patch parsing).
 */
export function diffLineStats(unifiedDiff: string): {
  files: number;
  additions: number;
  deletions: number;
} {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of unifiedDiff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      files += 1;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }
  return { files, additions, deletions };
}
