import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ThemeProvider } from "./hooks/useTheme";
import { ToastProvider } from "./hooks/useToast";
import { useHashRoute, type Tab } from "./hooks/useHashRoute";
import { Layout } from "./components/Layout";
import { CommandPalette } from "./components/CommandPalette";
import { ToastContainer } from "./components/ToastContainer";
import { useToast } from "./hooks/useToast";
import { LoginPage } from "./pages/Login";
import { OverviewPage } from "./pages/Overview";
import { ProvidersPage } from "./pages/Providers";
import { RoutingPage } from "./pages/Routing";
import { LogsPage } from "./pages/Logs";
import { AccessPage } from "./pages/Access";
import { SettingsPage } from "./pages/Settings";

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-sm border border-accent/40 bg-accent-soft">
          <Activity size={18} className="text-accent" />
        </span>
        <div>
          <p className="text-[11px] font-extrabold tracking-[0.2em] text-ink">WEB SEARCH ROUTER</p>
          <p className="mt-1 font-mono text-[9px] tracking-[0.2em] text-dim">LOADING CONTROL PLANE</p>
        </div>
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts } = useToast();
  return <ToastContainer toasts={toasts} />;
}

function Shell() {
  const { state, loading, logout } = useAuth();
  const [tab, navigate] = useHashRoute();
  const [commandOpen, setCommandOpen] = useState(false);
  const [addProviderIntent, setAddProviderIntent] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (loading) return <Splash />;
  if (state?.enabled && !state.user) {
    return <LoginPage needsSetup={state.needsSetup || !state.hasUsers} />;
  }

  const go = (next: Tab) => navigate(next);
  const openAddProvider = () => {
    setAddProviderIntent(true);
    navigate("providers");
  };

  return (
    <>
      <Layout
        activeTab={tab}
        onTabChange={go}
        authState={state}
        onLogout={logout}
        onOpenCommand={() => setCommandOpen(true)}
      >
        {tab === "overview" ? <OverviewPage onNavigate={go} onAddProvider={openAddProvider} /> : null}
        {tab === "providers" ? (
          <ProvidersPage
            autoOpen={addProviderIntent}
            onAutoOpen={() => setAddProviderIntent(false)}
          />
        ) : null}
        {tab === "routing" ? <RoutingPage /> : null}
        {tab === "logs" ? <LogsPage /> : null}
        {tab === "access" ? <AccessPage /> : null}
        {tab === "settings" ? <SettingsPage /> : null}
      </Layout>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onSelect={go} />
      <Toasts />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
