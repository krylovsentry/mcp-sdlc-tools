/** Builds a process.argv-shaped array for CLI entrypoints (preserves argv[2] positional semantics). */
export function syntheticArgv(forwarded: string[]): string[] {
	return [process.execPath, "mcp-sdlc", ...forwarded];
}
