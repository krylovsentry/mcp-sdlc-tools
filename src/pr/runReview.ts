import type { LlmProvider } from "../providers/openaiCompatProvider";
import type { PrRef, PullRequestProvider } from "./types";
import { reviewMessages } from "./reviewPrompt";

export async function runPrReview(
  llm: LlmProvider,
  pr: PullRequestProvider,
  ref: PrRef
): Promise<void> {
  const artifact = await pr.fetchDiff(ref);
  const messages = reviewMessages(artifact);
  const res = await llm.complete(messages, []);
  const summary = (res.text ?? "").trim();
  if (!summary) {
    throw new Error("Model returned empty review text");
  }
  await pr.postComment(summary);
}
