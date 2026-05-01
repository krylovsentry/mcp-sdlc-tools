import { runOpenApiToPostman } from "./openapiToPostman";
import { syntheticArgv } from "./syntheticArgv";

async function main(): Promise<void> {
	await runOpenApiToPostman(syntheticArgv(process.argv.slice(2)));
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
