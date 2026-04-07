import { z } from "zod";
import { dirname, resolve } from "node:path";

const transportSchema = z.enum(["stdio", "sse"]);

const stdioConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional()
});

const sseConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional()
});

const mcpServerSchema = z.object({
  enabled: z.boolean().default(true),
  transport: transportSchema,
  stdio: stdioConfigSchema.optional(),
  sse: sseConfigSchema.optional()
}).superRefine((value, ctx) => {
  if (value.transport === "stdio" && !value.stdio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stdio config required for stdio transport" });
  }
  if (value.transport === "sse" && !value.sse) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sse config required for sse transport" });
  }
});

const modelProviderSchema = z.enum(["openaiCompat", "ollama"]);

const modelConfigSchema = z.object({
  provider: modelProviderSchema,
  modelName: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  apiKeyFile: z.string().optional(),
  timeoutMs: z.number().int().positive().default(60_000)
});

const agentConfigSchema = z.object({
  maxIterations: z.number().int().positive().default(8),
  toolTimeoutMs: z.number().int().positive().default(45_000),
  requestTimeoutMs: z.number().int().positive().default(60_000)
});

export const appConfigSchema = z.object({
  model: modelConfigSchema,
  mcp: z.object({
    playwright: mcpServerSchema,
    postman: mcpServerSchema
  }),
  agent: agentConfigSchema
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function parseConfig(raw: unknown): AppConfig {
  return appConfigSchema.parse(raw);
}

export async function loadConfig(path = "config/servers.json"): Promise<AppConfig> {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`Config file not found: ${path}. Copy config/servers.example.json to config/servers.json.`);
  }
  const json = await file.json() as Record<string, unknown>;
  const model = (json.model ?? {}) as Record<string, unknown>;

  if (!model.apiKey && typeof model.apiKeyFile === "string" && model.apiKeyFile.trim()) {
    const configDir = dirname(path);
    const apiKeyPath = resolve(configDir, model.apiKeyFile);
    const apiKeyFile = Bun.file(apiKeyPath);
    const apiKeyFileExists = await apiKeyFile.exists();
    if (!apiKeyFileExists) {
      throw new Error(`API key file not found: ${apiKeyPath}`);
    }
    const raw = (await apiKeyFile.text()).trim();
    let apiKey = raw;
    try {
      const parsed = JSON.parse(raw) as { apiKey?: string };
      if (typeof parsed.apiKey === "string" && parsed.apiKey.trim()) {
        apiKey = parsed.apiKey.trim();
      }
    } catch {
      // Allow plain-text API key files.
    }
    json.model = { ...model, apiKey };
  }

  return parseConfig(json);
}
