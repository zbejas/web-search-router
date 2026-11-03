import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretBox, keyHint } from "../../src/crypto";

describe("SecretBox", () => {
  test("encrypts and decrypts without storing plaintext", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wsr-crypto-"));
    try {
      const box = await SecretBox.open(join(dir, "master.key"));
      const encrypted = await box.encrypt("fc-super-secret-key");
      expect(encrypted.startsWith("v1.")).toBe(true);
      expect(encrypted).not.toContain("super-secret");
      expect(await box.decrypt(encrypted)).toBe("fc-super-secret-key");
      expect(keyHint("fc-super-secret-key")).toBe("****-key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects a different master key", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "wsr-crypto-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "wsr-crypto-b-"));
    try {
      const boxA = await SecretBox.open(join(dirA, "master.key"));
      const boxB = await SecretBox.open(join(dirB, "master.key"));
      const encrypted = await boxA.encrypt("secret");
      await expect(boxB.decrypt(encrypted)).rejects.toThrow();
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});
