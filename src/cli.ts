#!/usr/bin/env bun
import { runCoverageCheck } from "./checkCoverage";
import { runGenerateTests } from "./generateTests";
import { runAgent } from "./index";
import { runModelTests } from "./modelTests";
import { runOpenApiToPostman } from "./openapiToPostman";
import { runReviewPr } from "./reviewPr";
import { runScaffoldTesting } from "./scaffoldTesting";
import { runSmoke } from "./smoke";
import { syntheticArgv } from "./syntheticArgv";

const HELP = `mcp-sdlc-tools — unified CLI (same behavior as package.json scripts)

Usage:
  mcp-sdlc <command> [options]

Commands:
  agent, start          MCP agent + tool loop (--prompt required; see bun run start)
  smoke                 Start MCP servers and list tools
  generate-tests        Model-driven Playwright/Postman file generation
  openapi-postman       OpenAPI/Swagger → Postman collections
  scaffold-testing      Copy templates/testing → ./testing
  model-test            Run canned model prompts from JSON
  review-pr             LLM review of a unified diff (or Source Code API provider)
  coverage-check        Enforce lcov thresholds (same as coverage:check)

Examples:
  mcp-sdlc agent --prompt "Summarize the workflow"
  mcp-sdlc smoke
  mcp-sdlc openapi-postman --spec ./api.yaml --out ./collection.json
  git diff main...HEAD | mcp-sdlc review-pr

Pass flags after the command name (same as bun run <script> -- ...).
`;

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const cmd = argv[0];
	const rest = argv.slice(1);

	if (!cmd || cmd === "-h" || cmd === "--help") {
		console.log(HELP);
		process.exit(cmd ? 0 : 1);
	}

	switch (cmd) {
		case "agent":
		case "start": {
			const answer = await runAgent(rest);
			console.log(answer);
			break;
		}
		case "smoke":
			await runSmoke(rest);
			break;
		case "generate-tests":
			await runGenerateTests(rest);
			break;
		case "openapi-postman":
			await runOpenApiToPostman(syntheticArgv(rest));
			break;
		case "scaffold-testing":
			await runScaffoldTesting();
			break;
		case "model-test":
			await runModelTests(rest);
			break;
		case "review-pr":
			await runReviewPr(rest);
			break;
		case "coverage-check":
			await runCoverageCheck(syntheticArgv(rest));
			break;
		default:
			console.error(`Unknown command: ${cmd}\n`);
			console.log(HELP);
			process.exit(1);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
