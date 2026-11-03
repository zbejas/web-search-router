import type { FailureKind } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function safeJsonParse<T = unknown>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

export function getPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isFinite(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function renderTemplate(value: unknown, vars: Record<string, string | number | boolean | undefined>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{(\w+)\}\}$/);
    if (exact) {
      const replacement = vars[exact[1]];
      return replacement === undefined ? "" : replacement;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      const replacement = vars[name];
      return replacement === undefined ? "" : String(replacement);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderTemplate(item, vars));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderTemplate(item, vars);
    }
    return out;
  }
  return value;
}

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-subscription-token",
  "proxy-authorization",
]);

export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? "[redacted]" : value;
  }
  return out;
}

const SENSITIVE_KEYS = /(^|[_-])(api[_-]?key|authorization|cookie|password|secret|token)($|[_-])/i;

export function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[max-depth]";
  if (Array.isArray(value)) return value.map((item) => redactJson(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.test(key) ? "[redacted]" : redactJson(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function bodyToLogText(body: ArrayBuffer | null, maxChars: number): string | null {
  if (!body || body.byteLength === 0) return null;
  const text = new TextDecoder().decode(body);
  const parsed = safeJsonParse(text);
  if (parsed !== null) {
    return truncate(JSON.stringify(redactJson(parsed)), maxChars);
  }
  return truncate(text, maxChars);
}

export function responseToLogText(response: Response, body: ArrayBuffer, maxChars: number): string | null {
  if (body.byteLength === 0) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/json|text|xml|javascript|x-www-form-urlencoded/i.test(contentType)) {
    return `[${contentType.split(";")[0]} ${body.byteLength} bytes]`;
  }
  const text = new TextDecoder().decode(body);
  const parsed = safeJsonParse(text);
  if (parsed !== null) {
    return truncate(JSON.stringify(redactJson(parsed)), maxChars);
  }
  return truncate(text, maxChars);
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function statusToFailureKind(status: number, error?: string): FailureKind | null {
  if (status === 0) return error?.toLowerCase().includes("timed out") ? "timeout" : "network";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return null;
}

export function shouldCountAgainstProvider(kind: FailureKind | null): boolean {
  return kind !== null && kind !== "client" && kind !== "unsupported";
}

export function shouldFailover(kind: FailureKind | null): boolean {
  return kind !== "client";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
