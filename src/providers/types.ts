import type {
  Capability,
  FailureKind,
  Operation,
  ProbeResult,
  ProviderInput,
  ProviderRecord,
  ProviderType,
  Settings,
} from "../types";

export interface AdapterPreset {
  id: string;
  label: string;
  description: string;
  baseUrl: string;
  apiKeyHint?: string;
  config: Record<string, unknown>;
}

export interface AdapterMetadata {
  type: ProviderType;
  label: string;
  shortLabel: string;
  description: string;
  defaultBaseUrl: string;
  docsUrl?: string;
  auth: {
    required: boolean;
    label: string;
    placeholder?: string;
    hint?: string;
  };
  capabilities: Capability[];
  presets?: AdapterPreset[];
  notes?: string[];
}

export interface AdapterExecution {
  ok: boolean;
  response: Response;
  failureKind: FailureKind | null;
  error: string | null;
  creditsUsed?: number;
  /** Present when an adapter normalized a search response. */
  searchResponse?: import("../types").SearchResponse;
}

export interface ProviderAdapter {
  metadata: AdapterMetadata;
  supports(provider: ProviderRecord, operation: Operation): boolean;
  validate(input: ProviderInput): string[];
  execute(
    provider: ProviderRecord,
    request: Request,
    body: ArrayBuffer | null,
    operation: Operation,
    settings: Settings,
  ): Promise<AdapterExecution>;
  probe(provider: ProviderRecord, settings: Settings): Promise<ProbeResult>;
}
