import { describe, expect, test } from "bun:test";
import { diffLineStats } from "../src/pr/diffStats";

describe("diffLineStats", () => {
  test("counts files and +/- lines", () => {
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "-old",
      "+new",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "+only add"
    ].join("\n");
    expect(diffLineStats(patch)).toEqual({ files: 2, additions: 2, deletions: 1 });
  });

  test("empty diff", () => {
    expect(diffLineStats("")).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});
