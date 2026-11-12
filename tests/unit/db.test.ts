import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeConfig } from "../../src/config";
import { openDatabase } from "../../src/db";

describe("database migrations", () => {
  test("keeps OpenCode providers across reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "wsr-db-"));
    try {
      const config = createRuntimeConfig({ dataDir: dir, port: 0 });
      const first = openDatabase(config);
      first
        .prepare(
          "INSERT INTO providers (id, name, type, base_url) VALUES ('opencode', 'OpenCode', 'opencode', 'https://opencode.ai')",
        )
        .run();
      first.close();

      const second = openDatabase(config);
      const row = second
        .prepare("SELECT id FROM providers WHERE id = 'opencode'")
        .get() as { id: string } | null;
      expect(row?.id).toBe("opencode");
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
