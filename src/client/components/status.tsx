import { Boxes, Flame, Globe2, Waves } from "lucide-react";
import type { ProviderHealth, ProviderType } from "../lib/api";
import { Badge, type Tone } from "./ui";

export function HealthBadge({
  health,
  enabled = true,
}: {
  health: ProviderHealth;
  enabled?: boolean;
}) {
  if (!enabled) return <Badge tone="dim" dot>disabled</Badge>;
  if (health === "healthy") return <Badge tone="ok" dot>healthy</Badge>;
  if (health === "unhealthy") return <Badge tone="bad" dot>auto-disabled</Badge>;
  return <Badge tone="warn" dot>unverified</Badge>;
}

export function healthTone(health: ProviderHealth, enabled = true): Tone {
  if (!enabled) return "dim";
  if (health === "healthy") return "ok";
  if (health === "unhealthy") return "bad";
  return "warn";
}

export function StatusDot({ health, enabled = true }: { health: ProviderHealth; enabled?: boolean }) {
  const color = !enabled
    ? "bg-dim"
    : health === "healthy"
      ? "bg-ok animate-live"
      : health === "unhealthy"
        ? "bg-bad"
        : "bg-warn";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
}

const PROVIDER_ICONS = {
  firecrawl: Flame,
  deepseek: Waves,
  generic: Globe2,
} as const;

export function ProviderTypeMark({ type, size = 28 }: { type: ProviderType; size?: number }) {
  const Icon = PROVIDER_ICONS[type] ?? Boxes;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-sm border border-line bg-bg text-muted"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

export function ProviderTypeBadge({ type }: { type: ProviderType }) {
  return <Badge tone="dim">{type}</Badge>;
}
