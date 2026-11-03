import type { SearchResponse, SearchResult } from "../types";

export type ApiVersion = "v1" | "v2";

function toFirecrawlItem(result: SearchResult, index: number): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...(result.metadata ?? {}) };
  if (result.siteName) metadata.siteName = result.siteName;
  if (result.publishedAt) metadata.publishedAt = result.publishedAt;
  if (result.score !== undefined) metadata.score = result.score;
  metadata.sourceURL = result.url;
  metadata.url = result.url;

  const item: Record<string, unknown> = {
    url: result.url,
    title: result.title ?? result.url,
    description: result.description ?? result.content ?? "",
    position: index + 1,
  };
  if (result.markdown ?? result.content) {
    item.markdown = result.markdown ?? result.content;
  }
  if (Object.keys(metadata).length > 0) {
    item.metadata = metadata;
  }
  return item;
}

export function buildFirecrawlSearchResponse(
  search: SearchResponse,
  version: ApiVersion,
  routerMeta?: Record<string, unknown>,
): Record<string, unknown> {
  const items = search.results.map(toFirecrawlItem);
  const id = crypto.randomUUID();
  const base: Record<string, unknown> = {
    success: true,
    id,
  };
  if (version === "v1") {
    base.data = items;
  } else {
    base.data = { web: items };
    base.creditsUsed = search.creditsUsed ?? 0;
  }
  if (routerMeta) base.router = routerMeta;
  return base;
}

export function emptySearchResponse(version: ApiVersion): Record<string, unknown> {
  if (version === "v1") {
    return { success: true, data: [] };
  }
  return { success: true, data: { web: [] }, creditsUsed: 0 };
}
