import type { LlmProvider } from "../providers/openaiCompatProvider";
import type { PrRef, PullRequestProvider } from "./types";
import { reviewMessages } from "./reviewPrompt";

export async function runPrReview(
  llm: LlmProvider,
  pr: PullRequestProvider,
  ref: PrRef
): Promise<void> {
  const artifact = await pr.fetchDiff(ref);
  console.error(
    `[review:pr] diff.loaded chars=${artifact.unifiedDiff.length} title=${artifact.title?.trim() || "(no title)"}`
  );
  if (!artifact.unifiedDiff.trim()) {
    throw new Error("Pull request provider returned an empty diff");
  }
  const messages = reviewMessages(artifact);
  const userChars = messages.find((message) => message.role === "user")?.content.length ?? 0;
  console.error(`[review:pr] prompt.ready messages=${messages.length} userChars=${userChars}`);
  const res = await llm.complete(messages, []);
  const summary = (res.text ?? "").trim();
  if (!summary) {
    console.error(
      `[review:pr] model.empty_text toolCalls=${res.toolCalls?.length ?? 0} rawTextLength=${res.text?.length ?? 0}`
    );
    throw new Error("Model returned empty review text");
  }
  console.error(`[review:pr] model.summary chars=${summary.length}`);
  await pr.postComment(summary);
}
