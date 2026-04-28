import type { PrDiffArtifact, PrRef, PullRequestProvider } from "./types";

/**
 * Local/stub PR provider: diff is supplied up front; "post comment" writes to stdout or a file.
 */
export class StubPullRequestProvider implements PullRequestProvider {
  constructor(
    private readonly artifact: PrDiffArtifact,
    private readonly outputPath?: string
  ) {}

  async fetchDiff(_ref: PrRef): Promise<PrDiffArtifact> {
    return this.artifact;
  }

  async postComment(body: string): Promise<void> {
    if (this.outputPath) {
      await Bun.write(this.outputPath, body);
      return;
    }
    console.log(body);
  }
}
