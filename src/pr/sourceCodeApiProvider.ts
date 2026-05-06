import type { PrDiffArtifact, PrRef, PullRequestProvider } from "./types";

type SourceCodeApiRef = Extract<PrRef, { provider: "sourceCodeApi" }>;

/** Branch/commit (and optional path/severity) for POST Source Code API `.../projects/.../repos/.../issues` when not writing `--output`. */
export type SourceCodeApiQualityPost = {
  branch: string;
  commit: string;
  path?: string;
  severity?: string;
  /** Body `repoTask.name` (API requires non-empty; default in provider: `LLM PR review #<prId>`). */
  repoTaskName?: string;
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

/** Cookie pair name used by some stacks when the session JWT is also sent as a cookie (e.g. Keycloak / browser channel). */
const ACCESS_TOKEN_COOKIE = "ACCESS_TOKEN";

/**
 * Turn a pasted `Set-Cookie` line into a `Cookie` header fragment (`name=value` only).
 * Request cookies must not include Path, Max-Age, etc.
 */
export function normalizeBrowserCookieInput(raw: string): string {
  const t = raw.trim();
  if (!t) {
    return t;
  }
  const attrStart = t.search(/;\s*(?:Path|Max-Age|Expires|Domain|Secure|HttpOnly|SameSite)\b/i);
  if (attrStart === -1) {
    return t;
  }
  const firstPart = t.slice(0, attrStart).trim();
  return firstPart.includes("=") ? firstPart : t;
}

function parseCookiePairs(cookieHeader: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const p = part.trim();
    if (!p) {
      continue;
    }
    const eq = p.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const name = p.slice(0, eq).trim();
    const value = p.slice(eq + 1).trim();
    if (name) {
      map.set(name, value);
    }
  }
  return map;
}

function cookieHeaderFromPairs(pairs: Map<string, string>): string {
  return [...pairs.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
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
    private readonly cookie?: string,
    /**
     * When true: write `outputPath` if set, attempt issues POST when `qualityPost` is set, then print body to stdout.
     * POST failures are logged and ignored so local file + stdout still succeed (e.g. 401 while debugging auth).
     */
    private readonly emitAll?: boolean,
    /** HTTP Basic (`Authorization: Basic`) when the gateway requires it alongside Bearer/cookies. */
    private readonly basicUser?: string,
    private readonly basicPassword?: string
  ) {}

  private applyAuthHeaders(headers: Record<string, string>): void {
    const normalizedCookieInput = this.cookie ? normalizeBrowserCookieInput(this.cookie) : "";
    const pairs = normalizedCookieInput ? parseCookiePairs(normalizedCookieInput) : new Map<string, string>();

    const tokenTrim = this.token?.trim();
    const accessFromCookie = pairs.get(ACCESS_TOKEN_COOKIE)?.trim();
    const bearerRaw = tokenTrim || accessFromCookie;

    const basicUserTrim = this.basicUser?.trim();
    const basicSecret = this.basicPassword ?? "";

    if (basicUserTrim) {
      const credentials = Buffer.from(`${basicUserTrim}:${basicSecret}`, "utf-8").toString("base64");
      headers.Authorization = `Basic ${credentials}`;
    } else if (bearerRaw) {
      headers.Authorization = `Bearer ${bearerRaw}`;
    }

    if (bearerRaw) {
      pairs.set(ACCESS_TOKEN_COOKIE, bearerRaw);
    }

    if (pairs.size > 0) {
      headers.Cookie = cookieHeaderFromPairs(pairs);
    }
  }

  async fetchDiff(ref: PrRef): Promise<PrDiffArtifact> {
    if (ref.provider !== "sourceCodeApi") {
      throw new Error(`Unsupported ref provider for SourceCodeApiPullRequestProvider: ${ref.provider}`);
    }
    return this.fetchSourceCodeApiDiff(ref);
  }

  async postComment(body: string, ref: PrRef): Promise<void> {
    if (this.emitAll) {
      if (this.outputPath) {
        await Bun.write(this.outputPath, body);
        console.error(
          `[review:pr] output.written path=${JSON.stringify(this.outputPath)} chars=${body.length}`
        );
      } else {
        console.error("[review:pr] emit-all.warn no output path configured; skipping file write");
      }
      if (ref.provider === "sourceCodeApi" && this.qualityPost) {
        try {
          await this.postProjectRepoIssue(body, ref, this.qualityPost);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[review:pr] issues.post failed (continuing) error=${JSON.stringify(msg)}`);
        }
      } else if (this.qualityPost && ref.provider !== "sourceCodeApi") {
        console.error("[review:pr] issues.post skipped reason=ref-not-sourceCodeApi");
      } else if (ref.provider === "sourceCodeApi" && !this.qualityPost) {
        console.error(
          "[review:pr] issues.post skipped reason=missing-branch-commit pass --branch and --commit (or prReview.qualityBranch / qualityCommit in config)"
        );
      }
      console.error(`[review:pr] output.stdout chars=${body.length}`);
      console.log(body);
      return;
    }

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
   * Body: `{ "data": { branch, commit, pullRequestId, …, repoTask: { name, branch, commit } } }` (same `data` envelope as read endpoints).
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

    const taskName =
      qc.repoTaskName?.trim() ||
      `LLM PR review #${ref.prId}`;

    /** API mirrors response shape (`{ data: … }`); flat body leaves `repoTask` unset and `name` validates as empty. */
    const data: Record<string, unknown> = {
      branch: qc.branch,
      commit: qc.commit,
      pullRequestId: ref.prId,
      severity: qc.severity ?? "INFO",
      message: msg,
      path: qc.path && qc.path.length > 0 ? qc.path : "/",
      repoTask: {
        name: taskName,
        branch: qc.branch,
        commit: qc.commit
      }
    };
    const flat =
      process.env.SOURCE_CODE_API_ISSUES_BODY?.trim().toLowerCase() === "flat";
    const payload = flat ? data : { data };

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
