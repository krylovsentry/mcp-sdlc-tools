/**
 * Models often wrap file bodies in an extra ```typescript / ```json fence inside the outer
 * FILE: block. That produces invalid source on disk. Strip one or more outer code-fence wrappers.
 */
export function stripMarkdownCodeFences(content: string): { text: string; stripped: boolean } {
  let s = content.replace(/^\uFEFF/, "").trim();

  const fenceOpen = /^```[a-zA-Z0-9_.+#-]*\s*\r?\n/;
  const fenceClose = /\r?\n```\s*$/;

  let passes = 0;
  const maxPasses = 8;
  while (passes < maxPasses && fenceOpen.test(s)) {
    s = s.replace(fenceOpen, "");
    if (fenceClose.test(s)) {
      s = s.replace(fenceClose, "");
    } else {
      break;
    }
    s = s.trim();
    passes += 1;
  }

  if (s.length > 0 && !s.endsWith("\n")) {
    s += "\n";
  }

  return { text: s, stripped: passes > 0 };
}

/** Apply fence stripping for paths that should be raw source or JSON (not markdown docs). */
export function sanitizeGeneratedContent(path: string, content: string): { text: string; stripped: boolean } {
  const lower = path.toLowerCase();
  const shouldStrip =
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".json") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml");

  if (!shouldStrip) {
    return { text: content, stripped: false };
  }

  return stripMarkdownCodeFences(content);
}
