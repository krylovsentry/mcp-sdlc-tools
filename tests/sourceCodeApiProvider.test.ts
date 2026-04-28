import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SourceCodeApiPullRequestProvider } from "../src/pr/sourceCodeApiProvider";

describe("SourceCodeApiPullRequestProvider", () => {
  test("fetchDiff decodes base64 diff content", async () => {
    const provider = new SourceCodeApiPullRequestProvider("https://scm.example.com", "token");
    const diff = "diff --git a/a.ts b/a.ts\n+hello\n";
    const encoded = Buffer.from(diff, "utf-8").toString("base64");

    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { content: encoded } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as unknown as typeof fetch;

    try {
      const artifact = await provider.fetchDiff({
        provider: "sourceCodeApi",
        projectKey: "PROJ",
        repoName: "repo",
        prId: 42
      });
      expect(artifact.unifiedDiff).toBe(diff);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("fetchDiff throws when data.content is missing", async () => {
    const provider = new SourceCodeApiPullRequestProvider("https://scm.example.com");

    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as unknown as typeof fetch;

    try {
      await expect(
        provider.fetchDiff({
          provider: "sourceCodeApi",
          projectKey: "PROJ",
          repoName: "repo",
          prId: 1
        })
      ).rejects.toThrow("missing data.content");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("postComment writes to output file when configured", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "sourcecode-pr-provider-"));
    try {
      const outputPath = join(tempRoot, "review.txt");
      const provider = new SourceCodeApiPullRequestProvider("https://scm.example.com", undefined, outputPath);
      await provider.postComment("review body");
      const saved = await readFile(outputPath, "utf8");
      expect(saved).toBe("review body");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
