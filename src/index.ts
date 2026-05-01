import { runToolCallingLoop } from "./agent/toolCallingLoop";
import { loadConfig } from "./config/schema";
import { ServerManager } from "./mcp/serverManager";
import { McpToolGateway } from "./mcp/toolGateway";
import { OllamaProvider } from "./providers/ollamaProvider";
import { OpenAiCompatProvider } from "./providers/openaiCompatProvider";
import { syntheticArgv } from "./syntheticArgv";

function parseArg(argv: string[], name: string): string | undefined {
	const idx = argv.indexOf(name);
	if (idx === -1) {
		return undefined;
	}
	return argv[idx + 1];
}

/** Runs the MCP agent loop; returns the assistant message text (stdout content when run as a script). */
export async function runAgent(forwardedArgv: string[]): Promise<string> {
	const argv = syntheticArgv(forwardedArgv);
	const prompt = parseArg(argv, "--prompt");
	if (!prompt) {
		throw new Error('Missing required "--prompt" argument.');
	}
	const disableTools = argv.includes("--disable-tools");
	const testGeneration = argv.includes("--test-generation");

	const configPath = parseArg(argv, "--config") ?? "config/servers.json";
	console.error(`[app] loading config from ${configPath}`);
	const config = await loadConfig(configPath);
	console.error(
		`[app] model provider=${config.model.provider} model=${config.model.modelName} baseUrl=${config.model.baseUrl}`,
	);
	const effectiveDisableTools = disableTools || !config.model.tools;
	if (!config.model.tools) {
		console.error("[app] model.tools=false, tool execution disabled by config");
	}
	const manager = new ServerManager(config);

	if (!effectiveDisableTools) {
		await manager.startAll();
	}
	try {
		const gateway = new McpToolGateway(manager, config.agent.toolTimeoutMs);
		const provider =
			config.model.provider === "openaiCompat"
				? new OpenAiCompatProvider(config.model)
				: new OllamaProvider(config.model);
		console.error("[app] starting agent loop");
		const answer = await runToolCallingLoop(provider, gateway, config, prompt, {
			disableTools: effectiveDisableTools,
			testGeneration: testGeneration && effectiveDisableTools,
		});
		console.error("[app] agent loop completed");
		return answer;
	} finally {
		if (!effectiveDisableTools) {
			manager.stopAll();
		}
	}
}

async function main(): Promise<void> {
	const answer = await runAgent(process.argv.slice(2));
	console.log(answer);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
