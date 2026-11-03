import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type AuthState } from "../lib/api";

interface AuthContextValue {
  state: AuthState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.authState();
      setState(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load auth state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    await api.login(username, password);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout();
    await refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      loading,
      error,
      refresh,
      login,
      logout,
      isAdmin: Boolean(state?.user && (!state.enabled || state.user.role === "admin")),
    }),
    [state, loading, error, refresh, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
