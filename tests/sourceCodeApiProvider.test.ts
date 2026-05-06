import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SourceCodeApiPullRequestProvider, normalizeBrowserCookieInput } from "../src/pr/sourceCodeApiProvider";

describe("SourceCodeApiPullRequestProvider", () => {
  test("normalizeBrowserCookieInput strips Set-Cookie attributes after first pair", () => {
    expect(normalizeBrowserCookieInput("ACCESS_TOKEN=a.b.c; Max-Age=28744; Path=/; Secure")).toBe(
      "ACCESS_TOKEN=a.b.c"
    );
    expect(normalizeBrowserCookieInput("SESSIONID=z; route=1")).toBe("SESSIONID=z; route=1");
  });

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

  test("postComment emit-all writes file, POSTs issues, and prints body to stdout", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "sourcecode-pr-provider-"));
    const requests: { method: string; url: string }[] = [];
    const stdoutLines: string[] = [];
    const previousFetch = globalThis.fetch;
    const previousLog = console.log;
    console.log = (...args: unknown[]) => {
      stdoutLines.push(args.map(String).join(" "));
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({ method: init?.method ?? "GET", url });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const outputPath = join(tempRoot, "review.md");
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com",
        "t",
        outputPath,
        { branch: "b", commit: "c" },
        undefined,
        true
      );
      await provider.postComment("review body", {
        provider: "sourceCodeApi",
        projectKey: "P",
        repoName: "r",
        prId: 3
      });
      expect(await readFile(outputPath, "utf8")).toBe("review body");
      expect(requests.some((r) => r.method === "POST" && r.url.includes("/issues"))).toBe(true);
      expect(stdoutLines).toEqual(["review body"]);
    } finally {
      globalThis.fetch = previousFetch;
      console.log = previousLog;
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("postComment emit-all logs and continues when issues POST fails", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "sourcecode-pr-provider-"));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    try {
      const outputPath = join(tempRoot, "review.md");
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com",
        "t",
        outputPath,
        { branch: "b", commit: "c" },
        undefined,
        true
      );
      await provider.postComment("- hi -", {
        provider: "sourceCodeApi",
        projectKey: "P",
        repoName: "r",
        prId: 3
      });
      expect(await readFile(outputPath, "utf8")).toBe("- hi -");
    } finally {
      globalThis.fetch = previousFetch;
      await rm(tempRoot, { recursive: true, force: true });
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
      const root = JSON.parse(requests[0].body) as Record<string, unknown>;
      expect(root.data).toBeDefined();
      expect(root.repoTask).toEqual({
        name: "LLM PR review #99",
        branch: "feat/x",
        commit: "abc123def"
      });
      const payload = root.data as Record<string, unknown>;
      expect(payload.message).toBe("hello review");
      expect(payload.severity).toBe("INFO");
      expect(payload.branch).toBe("feat/x");
      expect(payload.commit).toBe("abc123def");
      expect(payload.pullRequestId).toBe(99);
      expect(payload.path).toBe("/p");
      expect(payload.repoTask).toEqual(root.repoTask);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("postComment issues POST body is flat when SOURCE_CODE_API_ISSUES_BODY=flat", async () => {
    const prev = process.env.SOURCE_CODE_API_ISSUES_BODY;
    process.env.SOURCE_CODE_API_ISSUES_BODY = "flat";
    const requests: { body: string }[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : ""
      });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com/base",
        "tok",
        undefined,
        { branch: "main", commit: "abc" }
      );
      await provider.postComment("x", {
        provider: "sourceCodeApi",
        projectKey: "P",
        repoName: "r",
        prId: 7
      });
      const root = JSON.parse(requests[0].body) as Record<string, unknown>;
      expect(root.data).toBeUndefined();
      expect(root.repoTask).toEqual({
        name: "LLM PR review #7",
        branch: "main",
        commit: "abc"
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (prev === undefined) {
        delete process.env.SOURCE_CODE_API_ISSUES_BODY;
      } else {
        process.env.SOURCE_CODE_API_ISSUES_BODY = prev;
      }
    }
  });

  test("postComment issues nests repoTask inside data when SOURCE_CODE_API_ISSUES_LAYOUT=nested", async () => {
    const prev = process.env.SOURCE_CODE_API_ISSUES_LAYOUT;
    process.env.SOURCE_CODE_API_ISSUES_LAYOUT = "nested";
    const requests: { body: string }[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : ""
      });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com/base",
        "tok",
        undefined,
        { branch: "b1", commit: "c1" }
      );
      await provider.postComment("z", {
        provider: "sourceCodeApi",
        projectKey: "P",
        repoName: "r",
        prId: 2
      });
      const root = JSON.parse(requests[0].body) as Record<string, unknown>;
      expect(root.repoTask).toBeUndefined();
      const inner = root.data as Record<string, unknown>;
      expect(inner.repoTask).toEqual({
        name: "LLM PR review #2",
        branch: "b1",
        commit: "c1"
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (prev === undefined) {
        delete process.env.SOURCE_CODE_API_ISSUES_LAYOUT;
      } else {
        process.env.SOURCE_CODE_API_ISSUES_LAYOUT = prev;
      }
    }
  });

  test("postComment issues uses snake_case when SOURCE_CODE_API_ISSUES_SNAKE=1", async () => {
    const prev = process.env.SOURCE_CODE_API_ISSUES_SNAKE;
    process.env.SOURCE_CODE_API_ISSUES_SNAKE = "1";
    const requests: { body: string }[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : ""
      });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com/base",
        "tok",
        undefined,
        { branch: "main", commit: "abc" }
      );
      await provider.postComment("x", {
        provider: "sourceCodeApi",
        projectKey: "P",
        repoName: "r",
        prId: 8
      });
      const root = JSON.parse(requests[0].body) as Record<string, unknown>;
      expect(root.repoTask).toBeUndefined();
      expect(root.repo_task).toEqual({
        name: "LLM PR review #8",
        branch: "main",
        commit: "abc"
      });
      const inner = root.data as Record<string, unknown>;
      expect(inner.pull_request_id).toBe(8);
      expect(inner.pullRequestId).toBeUndefined();
      expect(inner.repo_task).toEqual(root.repo_task);
    } finally {
      globalThis.fetch = previousFetch;
      if (prev === undefined) {
        delete process.env.SOURCE_CODE_API_ISSUES_SNAKE;
      } else {
        process.env.SOURCE_CODE_API_ISSUES_SNAKE = prev;
      }
    }
  });

  test("postComment issues payload uses custom repoTask.name when set", async () => {
    const requests: { body: string }[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : ""
      });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com/base",
        "tok",
        undefined,
        {
          branch: "main",
          commit: "abc",
          repoTaskName: "Security scan follow-up"
        }
      );
      await provider.postComment("note", {
        provider: "sourceCodeApi",
        projectKey: "P",
        repoName: "r",
        prId: 5
      });
      const root = JSON.parse(requests[0].body) as Record<string, unknown>;
      expect(root.data).toBeDefined();
      expect(root.repoTask).toEqual({
        name: "Security scan follow-up",
        branch: "main",
        commit: "abc"
      });
      const payload = root.data as Record<string, unknown>;
      expect(payload.repoTask).toEqual(root.repoTask);
      expect(payload.branch).toBe("main");
      expect(payload.commit).toBe("abc");
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

  test("postComment merges bearer token into Cookie as ACCESS_TOKEN", async () => {
    let cookieSent: string | undefined;
    let authSent: string | undefined;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const h = init?.headers;
      if (h && typeof h === "object" && !(h instanceof Headers)) {
        cookieSent = (h as Record<string, string>).Cookie;
        authSent = (h as Record<string, string>).Authorization;
      } else if (h instanceof Headers) {
        cookieSent = h.get("Cookie") ?? undefined;
        authSent = h.get("Authorization") ?? undefined;
      }
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com/base",
        "tok",
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
      expect(authSent).toBe("Bearer tok");
      expect(cookieSent).toBe("SESSIONID=abc; route=1; ACCESS_TOKEN=tok");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("fetchDiff sends ACCESS_TOKEN cookie when only bearer token is set", async () => {
    let cookieForDiff: string | undefined;
    let authForDiff: string | undefined;
    const diff = "diff --git a/a.ts b/a.ts\n+hello\n";
    const encoded = Buffer.from(diff, "utf-8").toString("base64");
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/diff")) {
        const h = init?.headers;
        if (h && typeof h === "object" && !(h instanceof Headers)) {
          cookieForDiff = (h as Record<string, string>).Cookie;
          authForDiff = (h as Record<string, string>).Authorization;
        } else if (h instanceof Headers) {
          cookieForDiff = h.get("Cookie") ?? undefined;
          authForDiff = h.get("Authorization") ?? undefined;
        }
        return new Response(JSON.stringify({ data: { content: encoded } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider("https://scm.example.com", "bearer-only");
      await provider.fetchDiff({
        provider: "sourceCodeApi",
        projectKey: "PROJ",
        repoName: "repo",
        prId: 42
      });
      expect(authForDiff).toBe("Bearer bearer-only");
      expect(cookieForDiff).toBe("ACCESS_TOKEN=bearer-only");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("fetchDiff sets Bearer from ACCESS_TOKEN Set-Cookie paste when --token omitted", async () => {
    let cookieForDiff: string | undefined;
    let authForDiff: string | undefined;
    const diff = "diff --git a/a.ts b/a.ts\n+hello\n";
    const encoded = Buffer.from(diff, "utf-8").toString("base64");
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/diff")) {
        const h = init?.headers;
        if (h && typeof h === "object" && !(h instanceof Headers)) {
          cookieForDiff = (h as Record<string, string>).Cookie;
          authForDiff = (h as Record<string, string>).Authorization;
        } else if (h instanceof Headers) {
          cookieForDiff = h.get("Cookie") ?? undefined;
          authForDiff = h.get("Authorization") ?? undefined;
        }
        return new Response(JSON.stringify({ data: { content: encoded } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com",
        undefined,
        undefined,
        undefined,
        "ACCESS_TOKEN=jwt.one.two; Max-Age=1; Path=/; Secure"
      );
      await provider.fetchDiff({
        provider: "sourceCodeApi",
        projectKey: "PROJ",
        repoName: "repo",
        prId: 42
      });
      expect(authForDiff).toBe("Bearer jwt.one.two");
      expect(cookieForDiff).toBe("ACCESS_TOKEN=jwt.one.two");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("fetchDiff sends Authorization Basic when basic user and password are set", async () => {
    let authForDiff: string | undefined;
    const diff = "diff --git a/a.ts b/a.ts\n+hello\n";
    const encoded = Buffer.from(diff, "utf-8").toString("base64");
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/diff")) {
        const h = init?.headers;
        if (h && typeof h === "object" && !(h instanceof Headers)) {
          authForDiff = (h as Record<string, string>).Authorization;
        } else if (h instanceof Headers) {
          authForDiff = h.get("Authorization") ?? undefined;
        }
        return new Response(JSON.stringify({ data: { content: encoded } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const expected = `Basic ${Buffer.from("svcuser:secretpass", "utf-8").toString("base64")}`;
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "svcuser",
        "secretpass"
      );
      await provider.fetchDiff({
        provider: "sourceCodeApi",
        projectKey: "PROJ",
        repoName: "repo",
        prId: 42
      });
      expect(authForDiff).toBe(expected);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("fetchDiff uses Basic Authorization and ACCESS_TOKEN cookie when basic and bearer are both set", async () => {
    let authForDiff: string | undefined;
    let cookieForDiff: string | undefined;
    const diff = "d\n";
    const encoded = Buffer.from(diff, "utf-8").toString("base64");
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/diff")) {
        const h = init?.headers;
        if (h && typeof h === "object" && !(h instanceof Headers)) {
          authForDiff = (h as Record<string, string>).Authorization;
          cookieForDiff = (h as Record<string, string>).Cookie;
        } else if (h instanceof Headers) {
          authForDiff = h.get("Authorization") ?? undefined;
          cookieForDiff = h.get("Cookie") ?? undefined;
        }
        return new Response(JSON.stringify({ data: { content: encoded } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const provider = new SourceCodeApiPullRequestProvider(
        "https://scm.example.com",
        "jwt-here",
        undefined,
        undefined,
        undefined,
        undefined,
        "basicU",
        "basicP"
      );
      await provider.fetchDiff({
        provider: "sourceCodeApi",
        projectKey: "PROJ",
        repoName: "repo",
        prId: 42
      });
      expect(authForDiff).toBe(`Basic ${Buffer.from("basicU:basicP", "utf-8").toString("base64")}`);
      expect(cookieForDiff).toBe("ACCESS_TOKEN=jwt-here");
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
        "https://scm.example.com/app/sourcecode/api/api/v2",
        "tok",
        undefined,
        { branch: "feat/x", commit: "abc" }
      );
      await provider.postComment("msg", {
        provider: "sourceCodeApi",
        projectKey: "ACME/platform",
        repoName: "checkout-svc",
        prId: 42
      });
      expect(requestedUrl).toBe(
        "https://scm.example.com/app/sourcecode/api/api/v2/projects/ACME/platform/repos/checkout-svc/issues"
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
