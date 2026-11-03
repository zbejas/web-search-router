import { createApp, createRuntime, startBackgroundJobs } from "./app";
import { createRuntimeConfig, parseArgs, VERSION } from "./config";

// Runtime data contains encrypted provider keys and request logs.
process.umask(0o077);

const args = parseArgs(Bun.argv.slice(2));
const config = createRuntimeConfig({
  dataDir: args.dataDir,
  host: args.host,
  port: args.port,
});

const runtime = await createRuntime(config);
const app = createApp(runtime);
const server = app.listen({ port: config.port, hostname: config.host });
startBackgroundJobs(runtime);

console.log(`Web Search Router ${VERSION} listening on http://${config.host}:${config.port}`);
console.log(`Data directory: ${config.dataDir}`);
console.log("All settings, providers, and credentials are managed in the web dashboard.");

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}; shutting down.`);
  runtime.stopBackgroundJobs();
  try {
    server.stop();
  } catch {
    // server may already be closed
  }
  try {
    runtime.db.close();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
