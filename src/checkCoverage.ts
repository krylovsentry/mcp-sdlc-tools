import { existsSync } from "node:fs";

export type Totals = {
  lineFound: number;
  lineHit: number;
  functionFound: number;
  functionHit: number;
  branchFound: number;
  branchHit: number;
};

export function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) {
    return undefined;
  }
  return argv[idx + 1];
}

export function pct(hit: number, found: number): number {
  if (found === 0) {
    return 100;
  }
  return (hit / found) * 100;
}

export function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function parseLcov(content: string): Totals {
  const totals: Totals = {
    lineFound: 0,
    lineHit: 0,
    functionFound: 0,
    functionHit: 0,
    branchFound: 0,
    branchHit: 0
  };

  let includeRecord = false;
  let record: Totals = {
    lineFound: 0,
    lineHit: 0,
    functionFound: 0,
    functionHit: 0,
    branchFound: 0,
    branchHit: 0
  };

  function flushRecord(): void {
    if (!includeRecord) {
      record = {
        lineFound: 0,
        lineHit: 0,
        functionFound: 0,
        functionHit: 0,
        branchFound: 0,
        branchHit: 0
      };
      return;
    }
    totals.lineFound += record.lineFound;
    totals.lineHit += record.lineHit;
    totals.functionFound += record.functionFound;
    totals.functionHit += record.functionHit;
    totals.branchFound += record.branchFound;
    totals.branchHit += record.branchHit;
    record = {
      lineFound: 0,
      lineHit: 0,
      functionFound: 0,
      functionHit: 0,
      branchFound: 0,
      branchHit: 0
    };
  }

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      const sourcePath = line.slice(3);
      includeRecord = /(^|[\\/])src[\\/]/.test(sourcePath);
      continue;
    }
    if (line === "end_of_record") {
      flushRecord();
      includeRecord = false;
      continue;
    }
    if (line.startsWith("LF:")) {
      record.lineFound += Number(line.slice(3)) || 0;
      continue;
    }
    if (line.startsWith("LH:")) {
      record.lineHit += Number(line.slice(3)) || 0;
      continue;
    }
    if (line.startsWith("FNF:")) {
      record.functionFound += Number(line.slice(4)) || 0;
      continue;
    }
    if (line.startsWith("FNH:")) {
      record.functionHit += Number(line.slice(4)) || 0;
      continue;
    }
    if (line.startsWith("BRF:")) {
      record.branchFound += Number(line.slice(4)) || 0;
      continue;
    }
    if (line.startsWith("BRH:")) {
      record.branchHit += Number(line.slice(4)) || 0;
    }
  }

  flushRecord();
  return totals;
}

export function evaluateCoverage(content: string, min: number): { lines: number; functions: number; branches: number; failed: string[] } {
  const totals = parseLcov(content);
  const lines = pct(totals.lineHit, totals.lineFound);
  const functions = pct(totals.functionHit, totals.functionFound);
  const branches = pct(totals.branchHit, totals.branchFound);
  const failed: string[] = [];
  if (lines < min) failed.push(`lines ${formatPct(lines)} < ${min}%`);
  if (functions < min) failed.push(`functions ${formatPct(functions)} < ${min}%`);
  if (branches < min) failed.push(`branches ${formatPct(branches)} < ${min}%`);
  return { lines, functions, branches, failed };
}

export async function runCoverageCheck(argv = process.argv): Promise<void> {
  const lcovPath = parseArg(argv, "--lcov") ?? "coverage/lcov.info";
  const minRaw = parseArg(argv, "--min") ?? "80";
  const min = Number(minRaw);
  if (!Number.isFinite(min) || min < 0 || min > 100) {
    throw new Error(`Invalid --min value: ${minRaw}. Expected number between 0 and 100.`);
  }

  if (!existsSync(lcovPath)) {
    throw new Error(`Coverage file not found: ${lcovPath}`);
  }

  const content = await Bun.file(lcovPath).text();
  const { lines, functions, branches, failed } = evaluateCoverage(content, min);

  console.log(`[coverage] lines=${formatPct(lines)} functions=${formatPct(functions)} branches=${formatPct(branches)}`);

  if (failed.length > 0) {
    throw new Error(`Coverage threshold failed: ${failed.join(", ")}`);
  }
}

if (import.meta.main) {
  runCoverageCheck().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
