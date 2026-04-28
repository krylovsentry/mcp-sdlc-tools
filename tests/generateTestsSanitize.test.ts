import { describe, expect, test } from "bun:test";
import { sanitizeGeneratedContent, stripMarkdownCodeFences } from "../src/generateTestsSanitize";

describe("stripMarkdownCodeFences", () => {
  test("strips one typescript wrapper", () => {
    const raw = "```typescript\nimport { x } from \"y\";\n```\n";
    const { text, stripped } = stripMarkdownCodeFences(raw);
    expect(stripped).toBe(true);
    expect(text).toBe('import { x } from "y";\n');
  });

  test("strips nested double wrapper", () => {
    const raw = "```typescript\n```typescript\nconst a = 1;\n```\n```\n";
    const { text, stripped } = stripMarkdownCodeFences(raw);
    expect(stripped).toBe(true);
    expect(text).toBe("const a = 1;\n");
  });

  test("leaves plain source unchanged", () => {
    const raw = 'import { test } from "@playwright/test";\n';
    const { text, stripped } = stripMarkdownCodeFences(raw);
    expect(stripped).toBe(false);
    expect(text).toBe(raw);
  });

  test("json fence", () => {
    const raw = '```json\n{"a":1}\n```\n';
    const { text, stripped } = stripMarkdownCodeFences(raw);
    expect(stripped).toBe(true);
    expect(text).toBe('{"a":1}\n');
  });
});

describe("sanitizeGeneratedContent", () => {
  test("strips for .spec.ts path", () => {
    const { text, stripped } = sanitizeGeneratedContent(
      "testing/playwright/smoke/x.spec.ts",
      "```typescript\nimport { test } from \"@playwright/test\";\n```\n"
    );
    expect(stripped).toBe(true);
    expect(text).toContain('@playwright/test');
    expect(text).not.toContain("```");
  });

  test("skips markdown paths", () => {
    const raw = "```ts\nx\n```\n";
    const { text, stripped } = sanitizeGeneratedContent("docs/foo.md", raw);
    expect(stripped).toBe(false);
    expect(text).toBe(raw);
  });
});
