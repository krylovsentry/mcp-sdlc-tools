import type { PrDiffArtifact, PrRef, PullRequestProvider } from "./types";

type SourceCodeApiRef = Extract<PrRef, { provider: "sourceCodeApi" }>;

type DiffResponse = {
  data?: {
    content?: string;
  };
};

function extractPrTitle(json: unknown): string | undefined {
  if (!json || typeof json !== "object") {
    return undefined;
  }
  const o = json as Record<string, unknown>;
  const nested = (key: string): Record<string, unknown> | undefined => {
    const v = o[key];
    if (!v || typeof v !== "object") {
      return undefined;
    }
    return v as Record<string, unknown>;
  };
  const candidates: unknown[] = [
    o.title,
    o.name,
    o.subject,
    nested("data")?.title,
    nested("pullRequest")?.title
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      return c.trim();
    }
  }
  return undefined;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function encodePathPreservingSlashes(value: string): string {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function decodeMaybeBase64(value: string): string {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    // If decoded contains replacement chars and input looks textual, keep original.
    if (decoded.includes("\uFFFD")) {
      return value;
    }
    return decoded;
  } catch {
    return value;
  }
}

/**
 * Pull request provider for "Source Code API v2" .
 * Uses GET /projects/{projectKey}/repos/{repoName}/pull-requests/{prId}/diff.
 */
export class SourceCodeApiPullRequestProvider implements PullRequestProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly outputPath?: string
  ) {}

  async fetchDiff(ref: PrRef): Promise<PrDiffArtifact> {
    if (ref.provider !== "sourceCodeApi") {
      throw new Error(`Unsupported ref provider for SourceCodeApiPullRequestProvider: ${ref.provider}`);
    }
    return this.fetchSourceCodeApiDiff(ref);
  }

  async postComment(body: string): Promise<void> {
    // The provided OpenAPI spec did not expose a direct "create PR comment" endpoint.
    // Keep current behavior parity with stub provider: print/write generated review.
    if (this.outputPath) {
      await Bun.write(this.outputPath, body);
      console.error(
        `[review:pr] output.written path=${JSON.stringify(this.outputPath)} chars=${body.length}`
      );
      return;
    }
    console.error(`[review:pr] output.stdout chars=${body.length}`);
    console.log(body);
  }

  private async tryFetchPrTitle(ref: SourceCodeApiRef): Promise<string | undefined> {
    const projectPath = encodePathPreservingSlashes(ref.projectKey);
    const repoPath = encodePathPreservingSlashes(ref.repoName);
    const path = `/projects/${projectPath}/repos/${repoPath}/pull-requests/${ref.prId}`;
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    try {
      const response = await fetch(joinUrl(this.baseUrl, path), {
        method: "GET",
        headers
      });
      if (!response.ok) {
        console.error(`[review:pr] pr.meta skipped http=${response.status}`);
        return undefined;
      }
      const json = (await response.json()) as unknown;
      const title = extractPrTitle(json);
      if (title) {
        console.error(`[review:pr] pr.meta ok title=${JSON.stringify(title)}`);
      } else {
        console.error("[review:pr] pr.meta ok title=(none)");
      }
      return title;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[review:pr] pr.meta failed error=${JSON.stringify(msg)}`);
      return undefined;
    }
  }

  private async fetchSourceCodeApiDiff(ref: SourceCodeApiRef): Promise<PrDiffArtifact> {
    const title = await this.tryFetchPrTitle(ref);
    const projectPath = encodePathPreservingSlashes(ref.projectKey);
    const repoPath = encodePathPreservingSlashes(ref.repoName);
    const path = `/projects/${projectPath}/repos/${repoPath}/pull-requests/${ref.prId}/diff?binary=false&contextLines=3`;
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(joinUrl(this.baseUrl, path), {
      method: "GET",
      headers
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`SourceCode API diff request failed (${response.status} ${response.statusText}): ${body}`);
    }

    const json = await response.json() as DiffResponse;
    const encoded = json.data?.content;
    if (!encoded || typeof encoded !== "string") {
      throw new Error("SourceCode API diff response missing data.content");
    }

    return {
      unifiedDiff: decodeMaybeBase64(encoded),
      ...(title ? { title } : {})
    };
  }
}
