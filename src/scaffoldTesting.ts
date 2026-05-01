import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function runScaffoldTesting(): Promise<void> {
	const repoRoot = process.cwd();
	const templatesRoot = join(repoRoot, "templates", "testing");
	const testingRoot = join(repoRoot, "testing");

	await mkdir(testingRoot, { recursive: true });
	await cp(join(templatesRoot, "playwright"), join(testingRoot, "playwright"), {
		recursive: true,
	});
	await cp(join(templatesRoot, "postman"), join(testingRoot, "postman"), {
		recursive: true,
	});
	await cp(
		join(templatesRoot, "catalog.json"),
		join(testingRoot, "catalog.json"),
	);

	console.error(`[scaffold:testing] copied templates -> ${testingRoot}`);
}

async function main(): Promise<void> {
	await runScaffoldTesting();
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
