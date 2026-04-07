import type { JsonRpcRequest, JsonRpcResponse, JsonValue } from "../../types/protocol";

export class StdioMcpClient {
  private proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: JsonValue) => void; reject: (reason?: unknown) => void }>();
  private readonly label: string;

  constructor(command: string, args: string[], env?: Record<string, string>, cwd?: string, label = "unknown") {
    this.label = label;
    console.error(`[mcp:${this.label}] spawning stdio server: ${command} ${args.join(" ")} (cwd=${cwd ?? process.cwd()})`);
    this.proc = Bun.spawn({
      cmd: [command, ...args],
      cwd,
      env: { ...Bun.env, ...(env ?? {}) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    this.proc.exited.then((exitCode) => {
      console.error(`[mcp:${this.label}] process exited with code ${exitCode}`);
      const error = new Error(`[mcp:${this.label}] process exited before response (code=${exitCode})`);
      for (const [id, pending] of this.pending.entries()) {
        pending.reject(error);
        this.pending.delete(id);
      }
    }).catch((error) => {
      console.error(`[mcp:${this.label}] failed awaiting process exit:`, error);
    });
    this.readLoop().catch((error) => {
      console.error(`[mcp:${this.label}] stdio read loop failed:`, error);
    });
    this.stderrLoop().catch((error) => {
      console.error(`[mcp:${this.label}] stderr loop failed:`, error);
    });
  }

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of this.proc.stdout) {
      buffer += decoder.decode(chunk);
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        let response: JsonRpcResponse;
        try {
          response = JSON.parse(line) as JsonRpcResponse;
        } catch {
          console.error(`[mcp:${this.label}] non-JSON stdout line: ${line.slice(0, 300)}`);
          continue;
        }
        if ("id" in response && typeof response.id === "number") {
          const pending = this.pending.get(response.id);
          if (!pending) {
            console.error(`[mcp:${this.label}] got response for unknown id=${response.id}`);
            continue;
          }
          this.pending.delete(response.id);
          if ("error" in response) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      }
    }
  }

  private async stderrLoop(): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of this.proc.stderr) {
      const text = decoder.decode(chunk);
      if (text.trim()) {
        console.error(`[mcp:${this.label}:stderr] ${text.trimEnd()}`);
      }
    }
  }

  async request(method: string, params?: JsonValue, timeoutMs = 45_000): Promise<JsonValue> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<JsonValue>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    console.error(`[mcp:${this.label}] -> ${method} (id=${id})`);
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    return Promise.race([
      promise,
      new Promise<JsonValue>((_, reject) => {
        setTimeout(() => reject(new Error(`[mcp:${this.label}] Timeout waiting for ${method} (id=${id}, timeoutMs=${timeoutMs})`)), timeoutMs);
      })
    ]);
  }

  stop(): void {
    console.error(`[mcp:${this.label}] stopping process`);
    this.proc.kill();
  }
}
