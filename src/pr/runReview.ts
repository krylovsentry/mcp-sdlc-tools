import type { LlmProvider } from "../providers/openaiCompatProvider";
import { diffLineStats } from "./diffStats";
import type { PrRef, PullRequestProvider } from "./types";
import { reviewMessages } from "./reviewPrompt";

function firstLinePreview(text: string, maxChars = 140): string {
  const line =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const collapsed = line.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxChars - 1))}…`;
}

export async function runPrReview(
  llm: LlmProvider,
  pr: PullRequestProvider,
  ref: PrRef
): Promise<void> {
  const artifact = await pr.fetchDiff(ref);
  const { files, additions, deletions } = diffLineStats(artifact.unifiedDiff);
  const titleLabel = artifact.title?.trim() || "(no title)";
  console.error(
    `[review:pr] diff.loaded chars=${artifact.unifiedDiff.length} files=${files} +${additions} -${deletions} title=${JSON.stringify(titleLabel)}`
  );
  if (!artifact.unifiedDiff.trim()) {
    throw new Error("Pull request provider returned an empty diff");
  }
  const messages = reviewMessages(artifact);
  const userChars = messages.find((message) => message.role === "user")?.content.length ?? 0;
  console.error(`[review:pr] prompt.ready messages=${messages.length} userChars=${userChars}`);
  console.error("[review:pr] llm.request.start");
  const llmStartedAt = Date.now();
  const res = await llm.complete(messages, []);
  const llmElapsedMs = Date.now() - llmStartedAt;
  console.error(
    `[review:pr] llm.request.done elapsedMs=${llmElapsedMs} textChars=${res.text?.length ?? 0} toolCalls=${res.toolCalls?.length ?? 0}`
  );
  const summary = (res.text ?? "").trim();
  if (!summary) {
    console.error(
      `[review:pr] model.empty_text toolCalls=${res.toolCalls?.length ?? 0} rawTextLength=${res.text?.length ?? 0}`
    );
    throw new Error("Model returned empty review text");
  }
  console.error(
    `[review:pr] review.ready chars=${summary.length} preview=${JSON.stringify(firstLinePreview(summary))}`
  );
  await pr.postComment(summary, ref);
}
