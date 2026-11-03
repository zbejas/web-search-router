import type { ProviderType } from "../types";
import type { ProviderAdapter } from "./types";
import { firecrawlAdapter } from "./firecrawl";
import { deepseekAdapter } from "./deepseek";
import { genericAdapter } from "./generic";

const ADAPTERS: Record<ProviderType, ProviderAdapter> = {
  firecrawl: firecrawlAdapter,
  deepseek: deepseekAdapter,
  generic: genericAdapter,
};

export const PROVIDER_TYPES = Object.keys(ADAPTERS) as ProviderType[];

export function getAdapter(type: ProviderType): ProviderAdapter {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new Error(`Unknown provider type: ${type}`);
  return adapter;
}

export function adapterMetadata(): ProviderAdapter["metadata"][] {
  return PROVIDER_TYPES.map((type) => ADAPTERS[type].metadata);
}

export function isProviderType(value: unknown): value is ProviderType {
  return typeof value === "string" && value in ADAPTERS;
}
