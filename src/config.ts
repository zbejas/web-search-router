import { chmodSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const VERSION = "0.1.0";

export interface RuntimeConfig {
  dataDir: string;
  dbPath: string;
  masterKeyPath: string;
  distDir: string;
  host: string;
  port: number;
}

export function parseArgs(argv: string[]): { host: string; port: number; dataDir: string } {
  let host = "0.0.0.0";
  let port = 8123;
  let dataDir = "data";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--host" && next) {
      host = next;
      i++;
    } else if (arg === "--port" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error(`Invalid --port value: ${next}`);
      }
      port = parsed;
      i++;
    } else if (arg === "--data-dir" && next) {
      dataDir = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Web Search Router ${VERSION}

Usage:
  bun run src/index.tsx [--port 8123] [--host 0.0.0.0] [--data-dir ./data]

All application configuration is editable in the web UI.`);
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { host, port, dataDir };
}

export function createRuntimeConfig(input: {
  dataDir: string;
  host?: string;
  port?: number;
  distDir?: string;
}): RuntimeConfig {
  const dataDir = resolve(input.dataDir);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    // A bind-mounted volume may not allow chmod; the directory still works.
  }
  return {
    dataDir,
    dbPath: resolve(dataDir, "router.db"),
    masterKeyPath: resolve(dataDir, "master.key"),
    distDir: resolve(input.distDir ?? "dist"),
    host: input.host ?? "0.0.0.0",
    port: input.port ?? 8123,
  };
}
