import type { PrDiffArtifact, PrRef, PullRequestProvider } from "./types";

type SourceCodeApiRef = Extract<PrRef, { provider: "sourceCodeApi" }>;

type DiffResponse = {
  data?: {
    content?: string;
  };
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
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
      return;
    }
    console.log(body);
  }

  private async fetchSourceCodeApiDiff(ref: SourceCodeApiRef): Promise<PrDiffArtifact> {
    const path = `/projects/${encodeURIComponent(ref.projectKey)}/repos/${encodeURIComponent(ref.repoName)}/pull-requests/${ref.prId}/diff?binary=false&contextLines=3`;
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
      unifiedDiff: decodeMaybeBase64(encoded)
    };
  }
}
