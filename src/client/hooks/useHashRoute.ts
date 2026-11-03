import { useCallback, useEffect, useState } from "react";

export const TABS = ["overview", "providers", "routing", "logs", "access", "settings"] as const;
export type Tab = (typeof TABS)[number];

function currentTab(): Tab {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : "overview";
}

export function useHashRoute(): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(currentTab);

  useEffect(() => {
    const onChange = () => setTab(currentTab());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: Tab) => {
    window.location.hash = `/${next}`;
    setTab(next);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, []);

  return [tab, navigate];
}
