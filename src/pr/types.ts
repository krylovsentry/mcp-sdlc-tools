/**
 * Provider-agnostic PR review: fetch diff artifact, run LLM review, post summary.
 * Stub provider reads/writes local files; future adapters can call GitHub/GitLab APIs.
 */

export type PrRef =
  | { provider: "stub" }
  | {
      provider: "sourceCodeApi";
      projectKey: string;
      repoName: string;
      prId: number;
    };

export interface PrDiffArtifact {
  unifiedDiff: string;
  /** Optional context for the review prompt (e.g. PR title). */
  title?: string;
}

export interface PullRequestProvider {
  fetchDiff(ref: PrRef): Promise<PrDiffArtifact>;
  postComment(body: string): Promise<void>;
}
