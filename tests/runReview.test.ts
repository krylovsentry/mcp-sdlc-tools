import { describe, expect, test } from "bun:test";
import { runPrReview } from "../src/pr/runReview";
import type { LlmProvider } from "../src/providers/openaiCompatProvider";
import type { PrRef, PullRequestProvider } from "../src/pr/types";

describe("runPrReview", () => {
  test("posts trimmed review text", async () => {
    const comments: string[] = [];
    const artifact = {
      title: "Feature PR",
      unifiedDiff: "diff --git a/a.ts b/a.ts\n+export const x = 1;\n"
    };
    const llm: LlmProvider = {
      async complete() {
        return { text: "  Looks good overall.  " };
      }
    };
    const pr: PullRequestProvider = {
      async fetchDiff(_ref: PrRef) {
        return artifact;
      },
      async postComment(body: string, _ref: PrRef) {
        comments.push(body);
      }
    };

    await runPrReview(llm, pr, { provider: "stub" });

    expect(comments).toHaveLength(1);
    expect(comments[0]).toBe("Looks good overall.");
  });

  test("throws when model response has no review text", async () => {
    const llm: LlmProvider = {
      async complete() {
        return { text: "   " };
      }
    };
    const pr: PullRequestProvider = {
      async fetchDiff(_ref: PrRef) {
        return { title: "Empty response", unifiedDiff: "diff --git a/f b/f\n" };
      },
      async postComment(_body: string, _ref: PrRef) {}
    };

    await expect(runPrReview(llm, pr, { provider: "stub" })).rejects.toThrow("Model returned empty review text");
  });
});
