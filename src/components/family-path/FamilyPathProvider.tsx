import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiBases } from "@/services/cfsm/config";
import { ApiRequestError, getServerApiBase } from "@/services/api";
import { useAuth } from "@/hooks/useAuth";
import { getFamilyPaths, isPathActive, pathKey, triggerFamilyTest, type FamilySite, type IpFamily } from "@/services/familyPath";

interface FamilyContext {
  sites: FamilySite[]; now: number; pending: ReadonlySet<string>; errors: Record<string, string>;
  visible: boolean; loading: boolean;
  trigger: (base: string, id?: string, family?: IpFamily) => Promise<void>;
}
const Context = createContext<FamilyContext | null>(null);
export function FamilyPathProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { pathname, search } = useLocation();
  const { data: me } = useAuth();
  const [visible, setVisible] = useState(!document.hidden);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const enabled = visible && (pathname.startsWith("/server/") || (pathname === "/" && !search.includes("theme-manage")));
  const key = useMemo(() => ["family-paths", Boolean(me?.logged_in)] as const, [me?.logged_in]);
  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async ({ signal }) => {
      const previous = client.getQueryData<FamilySite[]>(key) ?? [];
      return Promise.all(getApiBases().map(async base => {
        const old = previous.find(site => site.base === base);
        let withHistory = !old || Date.now() - old.sparklineAt > 600_000;
        try {
          let data = await getFamilyPaths(base, withHistory, signal);
          const changed = data.paths.some(path => {
            const before = old?.paths.find(p => p.server_id === path.server_id && p.family === path.family);
            return !before || (!isPathActive(path) && (before.bandwidth_at !== path.bandwidth_at || before.bandwidth_started_at !== path.bandwidth_started_at || before.bandwidth_status !== path.bandwidth_status));
          });
          if (!withHistory && changed) { data = await getFamilyPaths(base, true, signal); withHistory = true; }
          return { ...data, base, sparklineAt: withHistory ? Date.now() : old?.sparklineAt ?? 0,
            paths: data.paths.map(path => ({ ...path, sparkline: withHistory ? path.sparkline : old?.paths.find(p => p.server_id === path.server_id && p.family === path.family)?.sparkline })) };
        } catch (error) {
          if (signal.aborted) throw error;
          return { ...(old ?? { paths: [], bandwidth_interval_hours: 6, sparklineAt: 0 }), base, can_trigger: false,
            error: error instanceof Error ? error.message : String(error), unsupported: error instanceof ApiRequestError && error.status === 404 };
        }
      }));
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: q => enabled ? ((q.state.data ?? []).some(site => site.paths.some(isPathActive)) ? 3_000 : 60_000) : false,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    const update = () => { setVisible(!document.hidden); if (!document.hidden) void client.invalidateQueries({ queryKey: key }); };
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [client, key]);
  const active = (query.data ?? []).some(site => site.paths.some(isPathActive));
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), active ? 1_000 : 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, active]);
  const trigger = useCallback(async (base: string, id?: string, family?: IpFamily) => {
    const actionKey = pathKey(base, id ?? "", family);
    const sites = client.getQueryData<FamilySite[]>(key) ?? [];
    const selected = sites.find(site => site.base === base)?.paths.filter(p => (!id || p.server_id === id) && (!family || p.family === family)) ?? [];
    if (pendingRef.current.has(actionKey) || (selected.length > 0 && selected.every(isPathActive))) return;
    pendingRef.current.add(actionKey); setPending(new Set(pendingRef.current));
    setErrors(old => ({ ...old, [actionKey]: "" }));
    try {
      const result = await triggerFamilyTest(base, id, family);
      client.setQueryData<FamilySite[]>(key, current => current?.map(site => site.base !== base ? site : { ...site,
        paths: site.paths.map(path => (!id || path.server_id === id) && (!family || path.family === family) ? {
          ...path, bandwidth_status: path.bandwidth_status === "testing" ? "testing" : "queued", bandwidth_requested_at: result.requested_at,
        } : path) }));
      void client.invalidateQueries({ queryKey: key });
    } catch (error) { setErrors(old => ({ ...old, [actionKey]: error instanceof Error ? error.message : String(error) })); }
    finally { pendingRef.current.delete(actionKey); setPending(new Set(pendingRef.current)); }
  }, [client, key]);
  return <Context.Provider value={{ sites: query.data ?? [], pending, errors, now, trigger, visible, loading: query.isPending }}>{children}</Context.Provider>;
}
export function useFamilyPaths() {
  const value = useContext(Context);
  if (!value) throw new Error("FamilyPathProvider missing");
  return value;
}
export function useServerPaths(id: string) {
  const context = useFamilyPaths();
  const base = getServerApiBase(id);
  const site = base !== undefined ? context.sites.find(s => s.base === base) : context.sites.find(s => s.paths.some(p => p.server_id === id)) ?? context.sites[0];
  return { ...context, site, paths: site?.paths.filter(p => p.server_id === id) ?? [] };
}
