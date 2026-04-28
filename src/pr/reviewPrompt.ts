import type { ChatMessage } from "../types/protocol";
import type { PrDiffArtifact } from "./types";

const SYSTEM = [
  "You are an experienced software engineer reviewing a pull request.",
  "Analyze the unified diff for correctness, regressions, security issues, and test coverage.",
  "Be concise and actionable: use short sections (Summary, Issues, Suggestions).",
  "If the diff is large, prioritize high-risk areas; do not restate the entire patch."
].join(" ");

export function reviewMessages(artifact: PrDiffArtifact): ChatMessage[] {
  const title = artifact.title?.trim() || "(no title)";
  const user = [
    `PR title: ${title}`,
    "",
    "Unified diff:",
    "```diff",
    artifact.unifiedDiff,
    "```"
  ].join("\n");

  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user }
  ];
}
