import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateCoverage, formatPct, parseArg, parseLcov, pct, runCoverageCheck } from "../src/checkCoverage";

describe("checkCoverage", () => {
  test("parseArg reads flag values from argv", () => {
    const argv = ["bun", "x", "--min", "80", "--lcov", "coverage/lcov.info"];
    expect(parseArg(argv, "--min")).toBe("80");
    expect(parseArg(argv, "--lcov")).toBe("coverage/lcov.info");
    expect(parseArg(argv, "--missing")).toBeUndefined();
  });

  test("parseLcov aggregates LF/LH/FNF/FNH/BRF/BRH", () => {
    const lcov = [
      "TN:",
      "SF:src/file1.ts",
      "LF:10",
      "LH:8",
      "FNF:4",
      "FNH:3",
      "BRF:6",
      "BRH:5",
      "end_of_record",
      "SF:src/file2.ts",
      "LF:20",
      "LH:10",
      "FNF:2",
      "FNH:2",
      "BRF:2",
      "BRH:2",
      "end_of_record"
    ].join("\n");

    const totals = parseLcov(lcov);
    expect(totals.lineFound).toBe(30);
    expect(totals.lineHit).toBe(18);
    expect(totals.functionFound).toBe(6);
    expect(totals.functionHit).toBe(5);
    expect(totals.branchFound).toBe(8);
    expect(totals.branchHit).toBe(7);
  });

  test("parseLcov ignores non-src records", () => {
    const lcov = [
      "SF:tests/file.test.ts",
      "LF:50",
      "LH:0",
      "FNF:10",
      "FNH:0",
      "BRF:10",
      "BRH:0",
      "end_of_record",
      "SF:src/file.ts",
      "LF:10",
      "LH:10",
      "FNF:2",
      "FNH:2",
      "BRF:2",
      "BRH:2",
      "end_of_record"
    ].join("\n");

    const totals = parseLcov(lcov);
    expect(totals.lineFound).toBe(10);
    expect(totals.lineHit).toBe(10);
    expect(totals.functionFound).toBe(2);
    expect(totals.functionHit).toBe(2);
    expect(totals.branchFound).toBe(2);
    expect(totals.branchHit).toBe(2);
  });

  test("pct and format helpers behave as expected", () => {
    expect(pct(3, 4)).toBe(75);
    expect(pct(0, 0)).toBe(100);
    expect(formatPct(80)).toBe("80.00%");
  });

  test("evaluateCoverage returns no failures when threshold is met", () => {
    const lcov = ["SF:src/ok.ts", "LF:100", "LH:85", "FNF:10", "FNH:9", "BRF:20", "BRH:17", "end_of_record"].join("\n");
    const result = evaluateCoverage(lcov, 80);
    expect(result.lines).toBe(85);
    expect(result.functions).toBe(90);
    expect(result.branches).toBe(85);
    expect(result.failed).toEqual([]);
  });

  test("evaluateCoverage reports failing dimensions", () => {
    const lcov = ["SF:src/fail.ts", "LF:100", "LH:79", "FNF:10", "FNH:7", "BRF:20", "BRH:20", "end_of_record"].join("\n");
    const result = evaluateCoverage(lcov, 80);
    expect(result.failed.length).toBe(2);
    expect(result.failed[0]).toContain("lines");
    expect(result.failed[1]).toContain("functions");
  });

  test("runCoverageCheck succeeds when threshold is met", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "coverage-check-"));
    const lcovPath = join(tempRoot, "lcov.info");
    try {
      await writeFile(
        lcovPath,
        ["SF:src/pass.ts", "LF:20", "LH:19", "FNF:4", "FNH:4", "BRF:4", "BRH:4", "end_of_record"].join("\n"),
        "utf8"
      );
      await expect(runCoverageCheck(["bun", "checkCoverage", "--lcov", lcovPath, "--min", "80"])).resolves.toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("runCoverageCheck throws on missing lcov file", async () => {
    await expect(runCoverageCheck(["bun", "checkCoverage", "--lcov", "missing-file.info"])).rejects.toThrow(
      "Coverage file not found"
    );
  });

  test("runCoverageCheck throws on invalid threshold", async () => {
    await expect(runCoverageCheck(["bun", "checkCoverage", "--min", "101"])).rejects.toThrow("Invalid --min value");
  });
});
