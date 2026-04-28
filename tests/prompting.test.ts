import { describe, expect, test } from "bun:test";
import { systemPrompt, testGenerationSystemPrompt } from "../src/agent/prompting";

describe("systemPrompt", () => {
  test("includes expected tool-calling guidance", () => {
    const prompt = systemPrompt();

    expect(prompt).toContain("local tool-using assistant");
    expect(prompt).toContain("wait for tool results before final response");
    expect(prompt).toContain("Keep answers concise and factual.");
  });
});

describe("testGenerationSystemPrompt", () => {
  test("includes expected completeness and formatting requirements", () => {
    const prompt = testGenerationSystemPrompt();

    expect(prompt).toContain("senior test automation engineer");
    expect(prompt).toContain("raw source or JSON only");
    expect(prompt).toContain("Never summarize");
    expect(prompt).toContain("at least two per test case unless impossible");
  });
});
