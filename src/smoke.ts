import { loadConfig } from "./config/schema";
import { ServerManager } from "./mcp/serverManager";
import { McpToolGateway } from "./mcp/toolGateway";
import { syntheticArgv } from "./syntheticArgv";

function parseArg(argv: string[], name: string): string | undefined {
	const idx = argv.indexOf(name);
	if (idx === -1) {
		return undefined;
	}
	return argv[idx + 1];
}

export async function runSmoke(forwardedArgv: string[]): Promise<void> {
	const argv = syntheticArgv(forwardedArgv);
	const configPath =
		parseArg(argv, "--config") ?? argv[2] ?? "config/servers.json";
	const config = await loadConfig(configPath);
	const manager = new ServerManager(config);
	await manager.startAll();
	try {
		const gateway = new McpToolGateway(manager, config.agent.toolTimeoutMs);
		const tools = await gateway.refreshToolIndex();
		console.log(
			JSON.stringify(
				{
					ok: true,
					totalTools: tools.length,
					toolNames: tools.map((tool) => tool.name),
				},
				null,
				2,
			),
		);
	} finally {
		manager.stopAll();
	}
}

async function main(): Promise<void> {
	await runSmoke(process.argv.slice(2));
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
