import { existsSync, readFileSync, writeFileSync } from "node:fs";

const KEY_BYTES = 32;
const PREFIX = "v1";

export class SecretBox {
  private constructor(private readonly key: CryptoKey) {}

  static async open(masterKeyPath: string): Promise<SecretBox> {
    let raw: Uint8Array;
    if (existsSync(masterKeyPath)) {
      const text = readFileSync(masterKeyPath, "utf8").trim();
      raw = Uint8Array.from(Buffer.from(text, "base64"));
      if (raw.length !== KEY_BYTES) {
        throw new Error(`Invalid master key at ${masterKeyPath}: expected ${KEY_BYTES} bytes`);
      }
    } else {
      raw = new Uint8Array(KEY_BYTES);
      crypto.getRandomValues(raw);
      writeFileSync(masterKeyPath, Buffer.from(raw).toString("base64") + "\n", {
        mode: 0o600,
      });
    }

    const key = await crypto.subtle.importKey(
      "raw",
      raw as BufferSource,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    return new SecretBox(key);
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      this.key,
      new TextEncoder().encode(plaintext) as BufferSource,
    );
    return `${PREFIX}.${Buffer.from(iv).toString("base64url")}.${Buffer.from(ciphertext).toString("base64url")}`;
  }

  async decrypt(encoded: string): Promise<string> {
    const [prefix, ivText, ciphertextText] = encoded.split(".");
    if (prefix !== PREFIX || !ivText || !ciphertextText) {
      throw new Error("Unsupported encrypted secret format");
    }
    const iv = Buffer.from(ivText, "base64url");
    const ciphertext = Buffer.from(ciphertextText, "base64url");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      this.key,
      ciphertext as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  }
}

export function keyHint(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 4) return "****";
  return `****${secret.slice(-4)}`;
}
