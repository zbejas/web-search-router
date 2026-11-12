import { Boxes, Flame, Globe2, SquareTerminal, Waves } from "lucide-react";
import type { Provider, ProviderHealth, ProviderType } from "../lib/api";
import { formatDate, formatNumber, formatRelative } from "../lib/format";
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

export function creditTone(
  provider: Pick<Provider, "creditsRemaining" | "creditsPlan">,
): Tone {
  if (provider.creditsRemaining === null) return "dim";
  if (provider.creditsRemaining <= 0) return "bad";
  if (
    provider.creditsPlan !== null &&
    provider.creditsPlan > 0 &&
    provider.creditsRemaining / provider.creditsPlan <= 0.1
  ) {
    return "warn";
  }
  return "ok";
}

export function CreditBadge({
  provider,
  showPlan = false,
}: {
  provider: Provider;
  showPlan?: boolean;
}) {
  if (provider.type !== "firecrawl" || provider.creditsRemaining === null) return null;
  const details = [`Checked ${formatRelative(provider.creditsCheckedAt)}`];
  if (provider.creditsPlan !== null) {
    details.push(`Plan ${formatNumber(provider.creditsPlan)} credits`);
  }
  if (provider.creditsPeriodEnd) {
    details.push(`Resets ${formatDate(provider.creditsPeriodEnd)}`);
  }
  return (
    <span title={details.join(" · ")}>
      <Badge tone={creditTone(provider)} dot>
        {formatNumber(provider.creditsRemaining)} credits
        {showPlan && provider.creditsPlan !== null
          ? ` of ${formatNumber(provider.creditsPlan)}`
          : ""}
      </Badge>
    </span>
  );
}

const PROVIDER_ICONS = {
  firecrawl: Flame,
  deepseek: Waves,
  opencode: SquareTerminal,
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
