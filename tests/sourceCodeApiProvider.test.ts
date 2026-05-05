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
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/diff")) {
        return new Response(JSON.stringify({ data: { content: encoded } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

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

  test("fetchDiff merges title when metadata endpoint returns JSON title", async () => {
    const provider = new SourceCodeApiPullRequestProvider("https://scm.example.com", "token");
    const diff = "diff --git a/a.ts b/a.ts\n+hello\n";
    const encoded = Buffer.from(diff, "utf-8").toString("base64");

    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/diff")) {
        return new Response(JSON.stringify({ data: { content: encoded } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ data: { title: "Fix widget" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const artifact = await provider.fetchDiff({
        provider: "sourceCodeApi",
        projectKey: "PROJ",
        repoName: "repo",
        prId: 42
      });
      expect(artifact.title).toBe("Fix widget");
      expect(artifact.unifiedDiff).toBe(diff);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("fetchDiff throws when data.content is missing", async () => {
    const provider = new SourceCodeApiPullRequestProvider("https://scm.example.com");

    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/diff")) {
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

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
      await provider.postComment("review body", {
        provider: "sourceCodeApi",
        projectKey: "PROJ",
        repoName: "repo",
        prId: 1
      });
      const saved = await readFile(outputPath, "utf8");
      expect(saved).toBe("review body");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("postComment POSTs to .../projects/.../repos/.../issues when no output and branch+commit set", async () => {
    const requests: { url: string; method: string; body: string }[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : ""
      });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com/base",
        "tok",
        undefined,
        { branch: "feat/x", commit: "abc123def", path: "/p", severity: "INFO" }
      );
      await provider.postComment("hello review", {
        provider: "sourceCodeApi",
        projectKey: "ENV/X",
        repoName: "svc",
        prId: 99
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe("POST");
      expect(requests[0].url).toBe(
        "https://scm.example.com/base/projects/ENV/X/repos/svc/issues"
      );
      const payload = JSON.parse(requests[0].body) as Record<string, unknown>;
      expect(payload.message).toBe("hello review");
      expect(payload.severity).toBe("INFO");
      expect(payload.branch).toBe("feat/x");
      expect(payload.commit).toBe("abc123def");
      expect(payload.pullRequestId).toBe(99);
      expect(payload.path).toBe("/p");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("postComment sends Cookie when configured (session auth)", async () => {
    let cookieSent: string | undefined;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const h = init?.headers;
      if (h && typeof h === "object" && !(h instanceof Headers)) {
        cookieSent = (h as Record<string, string>).Cookie;
      } else if (h instanceof Headers) {
        cookieSent = h.get("Cookie") ?? undefined;
      }
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com/base",
        undefined,
        undefined,
        { branch: "main", commit: "deadbeef" },
        "SESSIONID=abc; route=1"
      );
      await provider.postComment("x", {
        provider: "sourceCodeApi",
        projectKey: "P",
        repoName: "r",
        prId: 1
      });
      expect(cookieSent).toBe("SESSIONID=abc; route=1");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("issues POST uses v2 base-url (path under .../api/v2/projects/...)", async () => {
    let requestedUrl = "";
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider(
        "https://sfera-t1.ru/app/sourcecode/api/api/v2",
        "tok",
        undefined,
        { branch: "feat/x", commit: "abc" }
      );
      await provider.postComment("msg", {
        provider: "sourceCodeApi",
        projectKey: "ENVHR/INSIDERS",
        repoName: "insider-fe-svc",
        prId: 110684
      });
      expect(requestedUrl).toBe(
        "https://sfera-t1.ru/app/sourcecode/api/api/v2/projects/ENVHR/INSIDERS/repos/insider-fe-svc/issues"
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
