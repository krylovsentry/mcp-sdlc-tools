import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { convert as openapiConvert } from "openapi-to-postmanv2";

type ConverterInput =
  | { type: "file"; data: string }
  | { type: "string"; data: string }
  | { type: "json"; data: Record<string, unknown> };

type ConverterResult = {
  result: boolean;
  reason?: string;
  output?: Array<{ type: string; data: unknown }>;
};

type PostmanRequest = {
  method?: string;
};

type PostmanItem = {
  name?: string;
  request?: PostmanRequest;
  item?: PostmanItem[];
};

type PostmanCollection = {
  info?: Record<string, unknown>;
  item?: PostmanItem[];
  variable?: unknown[];
  auth?: unknown;
};

type ConvertFn = (
  data: ConverterInput,
  options: Record<string, unknown>,
  callback: (error: unknown, result: ConverterResult) => void
) => void;

const converter: { convert: ConvertFn } = { convert: openapiConvert as ConvertFn };

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) {
    return undefined;
  }
  return argv[idx + 1];
}

function parseRepeatedArg(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) {
      values.push(argv[i + 1]);
    }
  }
  return values;
}

function parseConverterOptions(values: string[]): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const entry of values) {
    const eqIndex = entry.indexOf("=");
    if (eqIndex <= 0) {
      throw new Error(`Invalid --converter-option value: ${entry}. Expected key=value.`);
    }
    const key = entry.slice(0, eqIndex).trim();
    const rawValue = entry.slice(eqIndex + 1).trim();
    if (!key) {
      throw new Error(`Invalid --converter-option value: ${entry}. Missing key.`);
    }
    options[key] = parseOptionValue(rawValue);
  }
  return options;
}

function parseOptionValue(value: string): unknown {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function isHttpUrl(spec: string): boolean {
  return /^https?:\/\//i.test(spec);
}

async function loadSpecInput(spec: string): Promise<ConverterInput> {
  if (isHttpUrl(spec)) {
    const response = await fetch(spec);
    if (!response.ok) {
      throw new Error(`Failed to fetch spec: ${spec} (${response.status} ${response.statusText})`);
    }
    const body = await response.text();
    return { type: "string", data: body };
  }
  const file = Bun.file(spec);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`Spec file not found: ${spec}`);
  }
  return { type: "file", data: spec };
}

export async function convertOpenApiToCollection(
  input: ConverterInput,
  options: Record<string, unknown>
): Promise<PostmanCollection> {
  return await new Promise<PostmanCollection>((resolve, reject) => {
    converter.convert(input, options, (error, result) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (!result.result) {
        reject(new Error(`Conversion failed: ${result.reason ?? "unknown reason"}`));
        return;
      }
      const collection = result.output?.find((entry) => entry.type === "collection")?.data;
      if (!collection || typeof collection !== "object") {
        reject(new Error("Conversion failed: no collection returned."));
        return;
      }
      resolve(collection as PostmanCollection);
    });
  });
}

function filterItemTree(items: PostmanItem[], allowedMethods: Set<string>): PostmanItem[] {
  const filtered: PostmanItem[] = [];
  for (const item of items) {
    if (Array.isArray(item.item) && item.item.length > 0) {
      const nextChildren = filterItemTree(item.item, allowedMethods);
      if (nextChildren.length > 0) {
        filtered.push({ ...item, item: nextChildren });
      }
      continue;
    }
    const method = item.request?.method?.toUpperCase();
    if (method && allowedMethods.has(method)) {
      filtered.push(item);
    }
  }
  return filtered;
}

export function createFixturesCollection(
  collection: PostmanCollection,
  allowedMethods = ["POST", "PUT", "PATCH"]
): PostmanCollection {
  const methods = new Set(allowedMethods.map((method) => method.toUpperCase()));
  const items = Array.isArray(collection.item) ? collection.item : [];
  return {
    ...collection,
    item: filterItemTree(items, methods)
  };
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(data, null, 2)}\n`);
}

export async function runOpenApiToPostman(argv = process.argv): Promise<void> {
  const spec = parseArg(argv, "--spec");
  const out = parseArg(argv, "--out");
  const testDataOut = parseArg(argv, "--testdata-out");
  const fixturesOut = parseArg(argv, "--fixtures-out");
  const dryRun = argv.includes("--dry-run");
  const optionValues = parseRepeatedArg(argv, "--converter-option");

  if (!spec) {
    throw new Error('Missing required "--spec" argument.');
  }
  if (!out) {
    throw new Error('Missing required "--out" argument.');
  }

  const baseOptions = parseConverterOptions(optionValues);
  const input = await loadSpecInput(spec);

  const apiCollection = await convertOpenApiToCollection(input, {
    schemaFaker: false,
    ...baseOptions
  });
  if (!dryRun) {
    await writeJson(out, apiCollection);
  }
  console.error(`[openapi:postman] ${dryRun ? "would write" : "wrote"} ${out}`);

  let testDataCollection: PostmanCollection | null = null;
  if (testDataOut || fixturesOut) {
    testDataCollection = await convertOpenApiToCollection(input, {
      schemaFaker: true,
      ...baseOptions
    });
  }

  if (testDataOut && testDataCollection) {
    if (!dryRun) {
      await writeJson(testDataOut, testDataCollection);
    }
    console.error(`[openapi:postman] ${dryRun ? "would write" : "wrote"} ${testDataOut}`);
  }

  if (fixturesOut && testDataCollection) {
    const fixturesCollection = createFixturesCollection(testDataCollection);
    if (!dryRun) {
      await writeJson(fixturesOut, fixturesCollection);
    }
    console.error(`[openapi:postman] ${dryRun ? "would write" : "wrote"} ${fixturesOut}`);
  }
}

