import type {
  Capability,
  Operation,
  ProviderRecord,
  RequestLogInput,
  RouteAttempt,
  Settings,
} from "./types";
import type { ProviderStore } from "./providers/store";
import { getAdapter } from "./providers/registry";
import { buildFirecrawlSearchResponse } from "./providers/search";
import type { SettingsService } from "./settings";
import type { Logger } from "./logger";
import {
  bodyToLogText,
  redactHeaders,
  responseToLogText,
  shouldCountAgainstProvider,
} from "./utils";

export interface RouteInput {
  request: Request;
  body: ArrayBuffer | null;
  keyId: string | null;
  clientIp: string | null;
  requestId: string;
}

export interface RouteOutput {
  response: Response;
  provider: ProviderRecord | null;
  attempts: RouteAttempt[];
  operation: Operation;
}

const VERSIONED_OPERATION = /^\/(v[12])\/(search|scrape|crawl|map|extract|batch\/scrape)(?:\/|$)/;

export function detectOperation(pathname: string): Operation {
  if (pathname === "/api/search" || pathname === "/search") return "search";
  const match = pathname.match(VERSIONED_OPERATION);
  if (match) {
    const raw = match[2];
    if (raw === "batch/scrape") return "batch_scrape";
    return raw as Capability;
  }
  return "proxy";
}

export function apiVersionForPath(pathname: string): "v1" | "v2" {
  if (pathname.startsWith("/v1/")) return "v1";
  return "v2";
}

function sortByPriority(a: ProviderRecord, b: ProviderRecord): number {
  return b.priority - a.priority || a.name.localeCompare(b.name);
}

export function orderCandidates(
  providers: ProviderRecord[],
  operation: Operation,
): { primary: ProviderRecord[]; lastResort: ProviderRecord[]; supporting: ProviderRecord[] } {
  const supporting = providers
    .filter((provider) => provider.enabled)
    .filter((provider) => {
      try {
        return getAdapter(provider.type).supports(provider, operation);
      } catch {
        return false;
      }
    })
    .sort(sortByPriority);

  return {
    supporting,
    primary: supporting.filter((provider) => provider.health !== "unhealthy"),
    lastResort: supporting.filter((provider) => provider.health === "unhealthy"),
  };
}

function routerHeaders(
  requestId: string,
  attempts: RouteAttempt[],
  provider: ProviderRecord | null,
  durationMs: number,
): Headers {
  const headers = new Headers();
  headers.set("x-router-request-id", requestId);
  headers.set("x-router-attempts", String(attempts.length));
  headers.set("x-router-latency-ms", String(durationMs));
  if (provider) {
    headers.set("x-router-provider", provider.id);
    headers.set("x-router-provider-type", provider.type);
  }
  return headers;
}

function copyResponseHeaders(response: Response, extra: Headers): Headers {
  const headers = new Headers(response.headers);
  for (const [key, value] of extra) headers.set(key, value);
  return headers;
}

export class RouterService {
  constructor(
    private readonly providers: ProviderStore,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
  ) {}

  async route(input: RouteInput): Promise<RouteOutput> {
    const started = Date.now();
    const settings = this.settings.get();
    const url = new URL(input.request.url);
    const operation = detectOperation(url.pathname);
    const allProviders = await this.providers.listInternal();
    const { primary, lastResort, supporting } = orderCandidates(allProviders, operation);

    if (supporting.length === 0) {
      const enabled = allProviders.filter((provider) => provider.enabled);
      const message =
        enabled.length === 0
          ? "No providers are enabled"
          : `No enabled provider supports ${operation}`;
      return this.finalize(
        input,
        operation,
        new Response(JSON.stringify({ success: false, error: message }), {
          status: enabled.length === 0 ? 503 : 501,
          headers: { "content-type": "application/json" },
        }),
        null,
        [],
        started,
        message,
        "unsupported",
      );
    }

    if (primary.length === 0 && (!settings.routing.lastResortEnabled || lastResort.length === 0)) {
      const message = "No healthy providers are available";
      return this.finalize(
        input,
        operation,
        new Response(JSON.stringify({ success: false, error: message }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
        null,
        [],
        started,
        message,
        null,
      );
    }

    const attempts: RouteAttempt[] = [];
    const tried = new Set<string>();
    const maxAttempts =
      settings.routing.maxAttempts > 0 ? settings.routing.maxAttempts : Number.POSITIVE_INFINITY;
    const deadline = started + settings.routing.totalTimeoutMs;

    const phases: { phase: RouteAttempt["phase"]; providers: ProviderRecord[] }[] = [
      { phase: "primary", providers: primary },
    ];
    if (settings.routing.lastResortEnabled) {
      phases.push({ phase: "last_resort", providers: lastResort });
    }

    let lastFailure: {
      provider: ProviderRecord;
      response: Response;
      kind: import("./types").FailureKind | null;
      error: string | null;
    } | null = null;

    for (const phase of phases) {
      for (const provider of phase.providers) {
        if (attempts.length >= maxAttempts) break;
        if (tried.has(provider.id)) continue;
        const remainingBudget = deadline - Date.now();
        if (remainingBudget <= 0) break;
        tried.add(provider.id);

        const attemptStarted = Date.now();
        const attemptSettings: Settings = {
          ...settings,
          routing: {
            ...settings.routing,
            requestTimeoutMs: Math.min(settings.routing.requestTimeoutMs, remainingBudget),
          },
        };
        let execution;
        try {
          const adapter = getAdapter(provider.type);
          execution = await adapter.execute(
            provider,
            input.request,
            input.body,
            operation,
            attemptSettings,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Provider adapter error";
          execution = {
            ok: false,
            response: new Response(JSON.stringify({ success: false, error: message }), {
              status: 502,
              headers: { "content-type": "application/json" },
            }),
            failureKind: "unknown" as const,
            error: message,
          };
        }

        const latencyMs = Date.now() - attemptStarted;
        const attempt: RouteAttempt = {
          providerId: provider.id,
          providerType: provider.type,
          priority: provider.priority,
          phase: phase.phase,
          ok: execution.ok,
          statusCode: execution.response.status,
          latencyMs,
          error: execution.error,
          failureKind: execution.failureKind,
        };
        attempts.push(attempt);

        if (execution.ok) {
          await this.providers.recordSuccess(provider.id, execution.response.status, latencyMs);
          const response = await this.materializeSearchResponse(
            input,
            operation,
            provider,
            execution,
            attempts,
            started,
          );
          return this.finalize(
            input,
            operation,
            response,
            provider,
            attempts,
            started,
            null,
            null,
          );
        }

        lastFailure = {
          provider,
          response: execution.response,
          kind: execution.failureKind,
          error: execution.error,
        };

        if (shouldCountAgainstProvider(execution.failureKind) && execution.failureKind) {
          await this.providers.recordFailure(
            provider.id,
            execution.failureKind,
            execution.response.status,
            execution.error ?? `Upstream returned ${execution.response.status}`,
            latencyMs,
            settings,
          );
        }

        const status = execution.response.status;
        const stopForClientError =
          execution.failureKind === "client" && status !== 404 && status !== 405;
        if (stopForClientError) break;
      }
      if (attempts.length >= maxAttempts) break;
      if (lastFailure?.kind === "client" && lastFailure.response.status !== 404 && lastFailure.response.status !== 405) {
        break;
      }
    }

    if (lastFailure && lastFailure.kind === "client") {
      return this.finalize(
        input,
        operation,
        lastFailure.response,
        lastFailure.provider,
        attempts,
        started,
        lastFailure.error,
        lastFailure.kind,
      );
    }

    const payload = {
      success: false,
      error: "All providers failed",
      attempts,
    };
    return this.finalize(
      input,
      operation,
      new Response(JSON.stringify(payload), {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
      lastFailure?.provider ?? null,
      attempts,
      started,
      lastFailure?.error ?? "All providers failed",
      lastFailure?.kind ?? null,
    );
  }

  private async materializeSearchResponse(
    input: RouteInput,
    operation: Operation,
    provider: ProviderRecord,
    execution: import("./providers/types").AdapterExecution,
    attempts: RouteAttempt[],
    started: number,
  ): Promise<Response> {
    if (!execution.searchResponse || operation !== "search") {
      return execution.response;
    }

    const version = apiVersionForPath(new URL(input.request.url).pathname);
    const payload = buildFirecrawlSearchResponse(execution.searchResponse, version, {
      providerId: provider.id,
      providerType: provider.type,
      attempts,
      latencyMs: Date.now() - started,
      requestId: input.requestId,
    });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  private async finalize(
    input: RouteInput,
    operation: Operation,
    response: Response,
    provider: ProviderRecord | null,
    attempts: RouteAttempt[],
    started: number,
    error: string | null,
    errorKind: import("./types").FailureKind | null,
  ): Promise<RouteOutput> {
    const durationMs = Date.now() - started;
    const body = await response.arrayBuffer();
    const headers = copyResponseHeaders(
      response,
      routerHeaders(input.requestId, attempts, provider, durationMs),
    );
    const finalResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

    const settings = this.settings.get();
    const url = new URL(input.request.url);
    const logInput: RequestLogInput = {
      requestId: input.requestId,
      method: input.request.method,
      path: url.pathname,
      query: url.search,
      requestHeaders: redactHeaders(input.request.headers),
      requestBody: bodyToLogText(input.body, settings.logging.maxBodyChars),
      operation,
      providerId: provider?.id ?? attempts.at(-1)?.providerId ?? null,
      providerType: provider?.type ?? attempts.at(-1)?.providerType ?? null,
      attempts,
      responseStatus: response.status,
      responseHeaders: redactHeaders(headers),
      responseBody: responseToLogText(
        finalResponse,
        body,
        settings.logging.maxBodyChars,
      ),
      durationMs,
      error,
      errorKind,
      keyId: input.keyId,
      clientIp: input.clientIp,
    };
    this.logger.log(logInput);

    return { response: finalResponse, provider, attempts, operation };
  }
}
