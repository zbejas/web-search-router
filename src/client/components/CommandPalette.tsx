import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Command,
  KeyRound,
  LayoutDashboard,
  ListTree,
  Route,
  ScrollText,
  Settings,
} from "lucide-react";
import type { Tab } from "../hooks/useHashRoute";
import { Dialog } from "./ui";

const ITEMS: { tab: Tab; label: string; description: string; icon: typeof LayoutDashboard }[] = [
  { tab: "overview", label: "Overview", description: "Routing board and live health", icon: LayoutDashboard },
  { tab: "providers", label: "Providers", description: "Add, test, and order upstreams", icon: ListTree },
  { tab: "routing", label: "Routing", description: "Priority and recovery policy", icon: Route },
  { tab: "logs", label: "Request logs", description: "Attempts, latency, and errors", icon: ScrollText },
  { tab: "access", label: "Access", description: "Users and router API keys", icon: KeyRound },
  { tab: "settings", label: "Settings", description: "Auth, rate limits, retention", icon: Settings },
];

export function CommandPalette({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (tab: Tab) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open]);

  const filtered = useMemo(() => {
    const term = query.toLowerCase().trim();
    if (!term) return ITEMS;
    return ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        item.tab.includes(term),
    );
  }, [query]);

  const choose = (tab: Tab) => {
    onSelect(tab);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Jump to" description="Navigate the control plane without leaving the keyboard.">
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-sm border border-line-strong bg-bg px-3">
          <Command size={14} className="text-dim" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((current) => Math.min(current + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter" && filtered[index]) {
                choose(filtered[index].tab);
              }
            }}
            placeholder="Search pages…"
            className="h-11 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-dim"
            aria-label="Search pages"
          />
          <kbd className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[9px] text-dim">ESC</kbd>
        </div>
        <div className="max-h-80 space-y-1 overflow-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted">No matching pages.</p>
          ) : (
            filtered.map((item, itemIndex) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.tab}
                  onClick={() => choose(item.tab)}
                  onMouseEnter={() => setIndex(itemIndex)}
                  className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors ${
                    itemIndex === index ? "bg-accent-soft text-ink" : "text-muted hover:bg-panel-raised"
                  }`}
                >
                  <Icon size={16} className={itemIndex === index ? "text-accent" : "text-dim"} />
                  <span className="flex-1">
                    <span className="block text-xs font-semibold">{item.label}</span>
                    <span className="block text-[10px] text-dim">{item.description}</span>
                  </span>
                  <ArrowRight size={13} className="text-dim" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}
