import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { createApp, createRuntime } from "../../src/app";
import { createRuntimeConfig } from "../../src/config";
import { startMockUpstream } from "../helpers/upstream";

const dataDir = resolve(".e2e-data");
rmSync(dataDir, { recursive: true, force: true });

const mock = startMockUpstream(4311);
const config = createRuntimeConfig({ dataDir, host: "127.0.0.1", port: 4310 });
const runtime = await createRuntime(config);

await runtime.providers.create({
  id: "primary",
  name: "Primary Firecrawl",
  type: "firecrawl",
  baseUrl: mock.url,
  apiKey: "fc-e2e",
  priority: 100,
  config: { probeMode: "auto" },
});
await runtime.providers.create({
  id: "secondary",
  name: "Secondary Firecrawl",
  type: "firecrawl",
  baseUrl: mock.url,
  apiKey: "fc-e2e",
  priority: 50,
  config: { probeMode: "auto" },
});
await runtime.providers.create({
  id: "disabled-fallback",
  name: "Disabled fallback",
  type: "generic",
  baseUrl: mock.url,
  priority: 10,
  enabled: false,
  config: {
    auth: { type: "none" },
    search: {
      method: "GET",
      path: "/search",
      queryParam: "q",
      extraQuery: { format: "json" },
      resultsPath: "results",
      fields: { title: "title", url: "url", content: "content", description: "content" },
    },
  },
});
await runtime.health.runDueChecks({ force: true });

const app = createApp(runtime);
const server = app.listen({ port: 4310, hostname: "127.0.0.1" });
console.log(`E2E server listening on http://127.0.0.1:4310`);

function shutdown(): void {
  try {
    server.stop();
  } catch {
    // ignore
  }
  mock.close();
  runtime.stopBackgroundJobs();
  runtime.db.close();
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
