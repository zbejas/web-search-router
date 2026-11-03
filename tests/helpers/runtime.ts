import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, createRuntime, type Runtime } from "../../src/app";
import { createRuntimeConfig } from "../../src/config";

export interface TestContext {
  dir: string;
  runtime: Runtime;
  app: ReturnType<typeof createApp>;
  close: () => void;
}

export async function createTestContext(): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), "wsr-test-"));
  const config = createRuntimeConfig({ dataDir: dir, port: 0 });
  const runtime = await createRuntime(config);
  const app = createApp(runtime);
  return {
    dir,
    runtime,
    app,
    close: () => {
      runtime.stopBackgroundJobs();
      runtime.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function request(
  app: TestContext["app"],
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, init));
}

export async function json<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function cookieFrom(response: Response): string | null {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return null;
  return setCookie.split(";")[0] ?? null;
}
