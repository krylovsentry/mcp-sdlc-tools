import { describe, expect, test } from "bun:test";
import { reviewMessages } from "../src/pr/reviewPrompt";

describe("reviewMessages", () => {
  test("builds system and user messages with provided title and diff", () => {
    const messages = reviewMessages({
      title: "Improve PR review flow",
      unifiedDiff: "diff --git a/a.ts b/a.ts\n+const a = 1;\n"
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("reviewing a pull request");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("PR title: Improve PR review flow");
    expect(messages[1]?.content).toContain("```diff");
    expect(messages[1]?.content).toContain("+const a = 1;");
  });

  test("uses fallback title when missing", () => {
    const messages = reviewMessages({
      unifiedDiff: "diff --git a/file.ts b/file.ts\n"
    });

    expect(messages[1]?.content).toContain("PR title: (no title)");
  });
});
