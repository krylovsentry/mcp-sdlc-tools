import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { convertOpenApiToCollection, createFixturesCollection, runOpenApiToPostman } from "../src/openapiToPostman";

const fixturePath = "tests/fixtures/sample-openapi.yaml";

function collectMethods(items: Array<{ request?: { method?: string }; item?: unknown[] }>): string[] {
  const methods: string[] = [];
  for (const item of items) {
    if (Array.isArray(item.item)) {
      methods.push(...collectMethods(item.item as Array<{ request?: { method?: string }; item?: unknown[] }>));
      continue;
    }
    if (item.request?.method) {
      methods.push(item.request.method.toUpperCase());
    }
  }
  return methods;
}

describe("openapiToPostman", () => {
  test("converts OpenAPI fixture into a Postman collection", async () => {
    const collection = await convertOpenApiToCollection(
      { type: "file", data: fixturePath },
      { schemaFaker: false }
    );
    expect(collection.info).toBeTruthy();
    expect(Array.isArray(collection.item)).toBe(true);
    const methods = collectMethods(collection.item ?? []);
    expect(methods).toContain("GET");
    expect(methods).toContain("POST");
    expect(methods).toContain("PATCH");
  });

  test("fixtures collection keeps only mutating methods", async () => {
    const collection = await convertOpenApiToCollection(
      { type: "file", data: fixturePath },
      { schemaFaker: true }
    );
    const fixtures = createFixturesCollection(collection);
    const methods = collectMethods(fixtures.item ?? []);
    expect(methods.length).toBeGreaterThan(0);
    expect(methods).toContain("POST");
    expect(methods).toContain("PATCH");
    expect(methods).not.toContain("GET");
  });

  test("cli writes api, testdata, and fixtures outputs", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "openapi-postman-"));
    try {
      const apiOut = join(tempRoot, "api.collection.json");
      const testDataOut = join(tempRoot, "testdata.collection.json");
      const fixturesOut = join(tempRoot, "fixtures.collection.json");

      await runOpenApiToPostman([
        "bun",
        "src/openapiToPostman.ts",
        "--spec",
        fixturePath,
        "--out",
        apiOut,
        "--testdata-out",
        testDataOut,
        "--fixtures-out",
        fixturesOut
      ]);

      const apiRaw = await readFile(apiOut, "utf8");
      const testDataRaw = await readFile(testDataOut, "utf8");
      const fixturesRaw = await readFile(fixturesOut, "utf8");

      const apiCollection = JSON.parse(apiRaw) as { item?: Array<{ request?: { method?: string }; item?: unknown[] }> };
      const testDataCollection = JSON.parse(testDataRaw) as { item?: Array<{ request?: { method?: string }; item?: unknown[] }> };
      const fixturesCollection = JSON.parse(fixturesRaw) as { item?: Array<{ request?: { method?: string }; item?: unknown[] }> };

      expect(apiCollection.item).toBeTruthy();
      expect(testDataCollection.item).toBeTruthy();
      const fixtureMethods = collectMethods(fixturesCollection.item ?? []);
      expect(fixtureMethods.length).toBeGreaterThan(0);
      expect(fixtureMethods).not.toContain("GET");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
