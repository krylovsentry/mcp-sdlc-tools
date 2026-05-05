import type { PrDiffArtifact, PrRef, PullRequestProvider } from "./types";

type SourceCodeApiRef = Extract<PrRef, { provider: "sourceCodeApi" }>;

/** Branch/commit (and optional path/severity) for POST Source Code API `.../projects/.../repos/.../issues` when not writing `--output`. */
export type SourceCodeApiQualityPost = {
  branch: string;
  commit: string;
  path?: string;
  severity?: string;
};

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
    private readonly outputPath?: string,
    private readonly qualityPost?: SourceCodeApiQualityPost,
    /** Browser session string (e.g. `NAME=value; NAME2=value2`) when the API expects cookies instead of Bearer. */
    private readonly cookie?: string
  ) {}

  private applyAuthHeaders(headers: Record<string, string>): void {
    if (this.cookie) {
      headers.Cookie = this.cookie;
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
  }

  async fetchDiff(ref: PrRef): Promise<PrDiffArtifact> {
    if (ref.provider !== "sourceCodeApi") {
      throw new Error(`Unsupported ref provider for SourceCodeApiPullRequestProvider: ${ref.provider}`);
    }
    return this.fetchSourceCodeApiDiff(ref);
  }

  async postComment(body: string, ref: PrRef): Promise<void> {
    if (this.outputPath) {
      await Bun.write(this.outputPath, body);
      console.error(
        `[review:pr] output.written path=${JSON.stringify(this.outputPath)} chars=${body.length}`
      );
      return;
    }
    if (ref.provider === "sourceCodeApi" && this.qualityPost) {
      await this.postProjectRepoIssue(body, ref, this.qualityPost);
      return;
    }
    if (this.qualityPost && ref.provider !== "sourceCodeApi") {
      console.error("[review:pr] issues.post skipped reason=ref-not-sourceCodeApi");
    } else if (ref.provider === "sourceCodeApi" && !this.qualityPost) {
      console.error(
        "[review:pr] issues.post skipped reason=missing-branch-commit pass --branch and --commit (or prReview.qualityBranch / qualityCommit in config)"
      );
    }
    console.error(`[review:pr] output.stdout chars=${body.length}`);
    console.log(body);
  }

  /**
   * POST /projects/{projectKey}/repos/{repoName}/issues (same OpenAPI v2 base as diff).
   * Body shape follows common Source Code swagger; align field names with your spec if requests fail validation.
   */
  private async postProjectRepoIssue(
    msg: string,
    ref: SourceCodeApiRef,
    qc: SourceCodeApiQualityPost
  ): Promise<void> {
    const projectPath = encodePathPreservingSlashes(ref.projectKey);
    const repoPath = encodePathPreservingSlashes(ref.repoName);
    const path = `/projects/${projectPath}/repos/${repoPath}/issues`;
    const url = joinUrl(this.baseUrl, path);

    const payload: Record<string, unknown> = {
      branch: qc.branch,
      commit: qc.commit,
      pullRequestId: ref.prId,
      severity: qc.severity ?? "INFO",
      message: msg,
      path: qc.path && qc.path.length > 0 ? qc.path : "/"
    };

    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "x-correlation-id": crypto.randomUUID()
    };
    this.applyAuthHeaders(headers);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Source Code API create issue failed (${response.status} ${response.statusText}): ${text}`
      );
    }

    console.error(
      `[review:pr] issues.post ok http=${response.status} project=${ref.projectKey} repo=${ref.repoName} prId=${ref.prId}`
    );
  }

  private async tryFetchPrTitle(ref: SourceCodeApiRef): Promise<string | undefined> {
    const projectPath = encodePathPreservingSlashes(ref.projectKey);
    const repoPath = encodePathPreservingSlashes(ref.repoName);
    const path = `/projects/${projectPath}/repos/${repoPath}/pull-requests/${ref.prId}`;
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    this.applyAuthHeaders(headers);
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
    this.applyAuthHeaders(headers);

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
