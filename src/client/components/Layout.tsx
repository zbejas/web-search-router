import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Command,
  KeyRound,
  LayoutDashboard,
  ListTree,
  LogOut,
  Menu,
  Moon,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  ShieldOff,
  Sun,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Tab } from "../hooks/useHashRoute";
import { useTheme } from "../hooks/useTheme";
import type { AuthState } from "../lib/api";
import { APP_VERSION } from "../lib/version";
import { Badge } from "./ui";

const NAV_ITEMS: { tab: Tab; label: string; icon: typeof LayoutDashboard; hint: string }[] = [
  { tab: "overview", label: "Overview", icon: LayoutDashboard, hint: "Routing board and live health" },
  { tab: "providers", label: "Providers", icon: ListTree, hint: "Add, test, and order upstreams" },
  { tab: "routing", label: "Routing", icon: Route, hint: "Priority and recovery policy" },
  { tab: "logs", label: "Request logs", icon: ScrollText, hint: "Attempts, latency, and errors" },
  { tab: "access", label: "Access", icon: KeyRound, hint: "Users and router API keys" },
  { tab: "settings", label: "Settings", icon: Settings, hint: "Auth, rate limits, retention" },
];

export function Layout({
  activeTab,
  onTabChange,
  authState,
  onLogout,
  onOpenCommand,
  children,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  authState: AuthState | null;
  onLogout: () => void;
  onOpenCommand: () => void;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 980px)").matches);
  const railRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const { theme, toggle } = useTheme();
  const active = NAV_ITEMS.find((item) => item.tab === activeTab) ?? NAV_ITEMS[0];

  useEffect(() => {
    const query = window.matchMedia("(max-width: 980px)");
    const update = () => {
      setIsMobile(query.matches);
      if (!query.matches) setMobileOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (railRef.current) railRef.current.inert = isMobile && !mobileOpen;
    if (isMobile && mobileOpen) {
      const first = railRef.current?.querySelector<HTMLElement>("[data-first-nav]");
      first?.focus();
    } else if (isMobile && wasOpen.current) {
      hamburgerRef.current?.focus();
    }
    wasOpen.current = mobileOpen;
  }, [isMobile, mobileOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && mobileOpen) setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const navigate = (tab: Tab) => {
    onTabChange(tab);
    setMobileOpen(false);
  };

  return (
    <div className="app-shell">
      {mobileOpen ? (
        <div className="rail-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      ) : null}
      <aside
        ref={railRef}
        id="primary-navigation"
        className={`rail ${mobileOpen ? "open" : ""}`}
        aria-label="Primary"
        aria-hidden={isMobile && !mobileOpen ? true : undefined}
      >
        <div className="rail-inner">
          <div className="flex items-center justify-between px-4 pb-3 pt-5">
            <button
              onClick={() => navigate("overview")}
              className="group flex items-center gap-3 text-left"
              aria-label="Web Search Router home"
            >
              <span className="grid h-9 w-9 place-items-center rounded-sm border border-accent/40 bg-accent-soft">
                <Activity size={17} className="text-accent" />
              </span>
              <span>
                <span className="block text-[12px] font-extrabold tracking-[0.16em] text-ink">
                  WEB SEARCH
                </span>
                <span className="block font-mono text-[9px] tracking-[0.34em] text-muted">ROUTER</span>
              </span>
            </button>
            <button
              className="btn btn-ghost btn-icon hidden max-[980px]:inline-flex"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X size={17} />
            </button>
          </div>

          <div className="mx-4 mb-4 border-y border-line py-3">
            <div className="flex items-center justify-between">
              <span className="mono-label">Control plane</span>
              <Badge tone={authState?.enabled ? "ok" : "warn"} dot>
                {authState?.enabled ? "secured" : "open"}
              </Badge>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-dim">
              {authState?.enabled
                ? "Session and API key enforcement is active."
                : "Auth is off. Enable it in Settings before exposing this host."}
            </p>
          </div>

          <nav className="flex-1 space-y-0.5 px-3" aria-label="Primary">
            {NAV_ITEMS.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.tab}
                  data-first-nav={index === 0 ? true : undefined}
                  onClick={() => navigate(item.tab)}
                  className={`nav-item w-full ${activeTab === item.tab ? "active" : ""}`}
                  aria-current={activeTab === item.tab ? "page" : undefined}
                  title={item.hint}
                >
                  <Icon size={15} />
                  <span className="flex-1 text-left">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="space-y-3 border-t border-line p-4">
            <div className="flex items-center justify-between">
              <span className="mono-label">Theme</span>
              <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label="Toggle theme">
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {authState?.enabled ? (
                  <ShieldCheck size={14} className="shrink-0 status-ok" />
                ) : (
                  <ShieldOff size={14} className="shrink-0 status-warn" />
                )}
                <span className="truncate text-[11px] text-muted">
                  {authState?.user?.username ?? "not signed in"}
                </span>
              </div>
              {authState?.enabled ? (
                <button className="btn btn-ghost btn-icon" onClick={onLogout} aria-label="Sign out">
                  <LogOut size={14} />
                </button>
              ) : null}
            </div>
            <p className="font-mono text-[9px] tracking-[0.18em] text-dim">WSR / V{APP_VERSION}</p>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={hamburgerRef}
              className="btn btn-ghost btn-icon mobile-nav"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="primary-navigation"
            >
              <Menu size={18} />
            </button>
            <div className="hidden items-center gap-2 text-[11px] text-dim sm:flex">
              <span className="font-mono tracking-[0.16em]">WSR</span>
              <span>/</span>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[13px] font-bold tracking-tight text-ink">{active.label}</h1>
              <p className="hidden truncate text-[10px] text-dim sm:block">{active.hint}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              className="btn btn-secondary hidden sm:inline-flex"
              onClick={onOpenCommand}
              aria-label="Open command palette"
            >
              <Command size={13} />
              <span className="text-[11px] text-muted">Jump to</span>
              <kbd className="ml-1 rounded-sm border border-line px-1.5 py-0.5 font-mono text-[9px] text-dim">
                ⌘K
              </kbd>
            </button>
            <button
              className="btn btn-ghost btn-icon sm:hidden"
              onClick={onOpenCommand}
              aria-label="Open command palette"
            >
              <Command size={16} />
            </button>
            <Badge tone="dim" className="hidden md:inline-flex">
              {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </Badge>
          </div>
        </header>

        <main className="page">{children}</main>
      </div>
    </div>
  );
}
