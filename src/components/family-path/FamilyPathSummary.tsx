import { Link } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { t, getLocale } from "@/i18n";
import { useNodeMeta } from "@/hooks/useNode";
import { formatMbps, IP_FAMILIES, isPathActive, pathChartPoints, pathKey, type FamilyPath, type IpFamily, type PathPoint } from "@/services/familyPath";
import { useServerPaths } from "./FamilyPathProvider";

export function relativeTime(timestamp: number, now: number) {
  if (!timestamp) return t("family.waiting");
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  return minutes < 1 ? t("family.justNow") : minutes < 60 ? t("family.minutesAgo", { n: minutes }) : minutes < 1440 ? t("family.hoursAgo", { n: Math.floor(minutes / 60) }) : t("family.daysAgo", { n: Math.floor(minutes / 1440) });
}
export const fullTime = (timestamp: number) => timestamp ? new Date(timestamp).toLocaleString(getLocale()) : t("family.waiting");
export const familyLabel = (family: IpFamily) => family === "ipv4" ? "IPv4" : "IPv6";
export function availableFamilies(paths: FamilyPath[], meta?: { ipv4: string; ipv6: string } | null) {
  return IP_FAMILIES.filter(family => paths.some(path => path.family === family) || meta?.[family]);
}
export function latencyText(path?: FamilyPath) {
  if (!path || path.latency_status === "waiting" || !path.latency_at) return t("family.waiting");
  if (path.latency_status !== "ok") return t("family.unreachable");
  return path.rtt_median_ms == null ? t("family.waiting") : `${path.rtt_median_ms.toFixed(0)} ms`;
}
export function bandwidthOld(path: FamilyPath, now: number, interval = 6) {
  return path.bandwidth_status === "error" || (path.bandwidth_at > 0 && now - path.bandwidth_at > interval * 3_600_000 * 2);
}
export function taskLabel(path: FamilyPath | undefined, now: number) {
  if (path?.bandwidth_status === "queued") return t("family.queued");
  if (path?.bandwidth_status === "testing") return t("family.testing", { n: Math.max(0, Math.floor((now - path.bandwidth_started_at) / 1000)) });
  if (path?.bandwidth_status === "error") return t("family.failed");
  if (path?.bandwidth_status === "ok") return t("family.complete");
  return t("family.waiting");
}
export function FamilyTestButton({ id, family, full = false }: { id: string; family: IpFamily; full?: boolean }) {
  const { site, paths, trigger, pending, now } = useServerPaths(id);
  const path = paths.find(p => p.family === family);
  const submitting = pending.has(pathKey(site?.base ?? "", id, family)) || pending.has(pathKey(site?.base ?? "", ""));
  const busy = submitting || Boolean(path && isPathActive(path));
  return <button type="button" className="family-test control-button" disabled={!path || !site?.can_trigger || busy}
    aria-label={t("family.testFamily", { family: familyLabel(family) })} aria-busy={busy}
    title={site?.error ? t("family.dataError") : !site?.can_trigger ? t("family.login") : !path ? t("family.waiting") : undefined}
    onClick={() => site && void trigger(site.base, id, family)}>
    {busy && <LoaderCircle size={13} className="family-spin" aria-hidden />}
    {submitting ? t("family.submitting") : busy ? taskLabel(path, now) : t(full ? "family.testNow" : "family.test")}
  </button>;
}
function Sparkline({ points, now }: { points: PathPoint[]; now: number }) {
  const values = pathChartPoints(points).filter(p => p.observed_at >= now - 7 * 86_400_000);
  const max = Math.max(1, ...values.flatMap(p => [p.vps_to_home_mbps ?? 0, p.home_to_vps_mbps ?? 0]));
  const x = (at: number) => Math.max(0, Math.min(80, 80 * (at - now + 7 * 86_400_000) / (7 * 86_400_000)));
  return <svg className="family-sparkline" viewBox="0 0 80 26" aria-hidden>
    {(["vps_to_home_mbps", "home_to_vps_mbps"] as const).map((key, index) => {
      let pen = false;
      const d = values.map(p => { const v = p[key]; if (v == null) { pen = false; return ""; } const op = pen ? "L" : "M"; pen = true; return `${op}${x(p.observed_at).toFixed(2)},${(24 - v / max * 22).toFixed(2)}`; }).join(" ");
      return <g key={key} style={{ color: `var(--traffic-${index ? "down" : "up"})` }}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        {values.map((p, i) => p[key] != null && values[i - 1]?.[key] == null && values[i + 1]?.[key] == null ? <circle key={p.observed_at} cx={x(p.observed_at)} cy={24 - p[key]! / max * 22} r="1.4" fill="currentColor" /> : null)}
      </g>;
    })}
  </svg>;
}
export function FamilyPathSummary({ id, density = "large" }: { id: string; density?: "large" | "compact" | "mini" | "list" }) {
  const { site, paths, now, errors, loading } = useServerPaths(id);
  const meta = useNodeMeta(id);
  // The collector is named Home Server by the existing backend contract; it has no self-link.
  if (!site || site.unsupported || meta?.name.trim().toLowerCase() === "home server") return null;
  const families = availableFamilies(paths, meta);
  if (!families.length) return null;
  const interactive = density !== "list";
  return <section className={`family-summary family-summary-${density}`} aria-label={t("family.title")}>
    <div className="family-summary-heading"><span>{t("family.title")}</span><span>{site.error ? t("family.dataError") : density === "large" ? t("family.week") : "Mbps"}</span></div>
    {families.map(family => {
      const path = paths.find(p => p.family === family);
      const failed = path?.bandwidth_status === "error";
      const old = path && bandwidthOld(path, now, site.bandwidth_interval_hours);
      const active = path && isPathActive(path);
      const actionError = errors[pathKey(site.base, id, family)];
      const latencyOld = path?.latency_at && now - path.latency_at > 3 * 60_000;
      const hint = actionError || (active || failed ? taskLabel(path, now) : old || latencyOld || site.error ? t("family.stale") : !path?.bandwidth_at ? t("family.waiting") : "");
      const data = <>
        <span className="family-stack-label">{familyLabel(family)}</span>
        <span className={`family-latency${path?.latency_status === "error" ? " family-error" : ""}`}>
          {latencyText(path)}{path?.latency_status === "ok" && path.loss_percent != null && <small> · {path.loss_percent.toFixed(0)}%</small>}
        </span>
        <span className="family-speeds" title={`${t("family.direction")} · ${fullTime(path?.bandwidth_at ?? 0)}`}>
          <span className="family-up">↑ <b>{formatMbps(path?.vps_to_home_mbps)}</b></span>
          <span className="family-down">↓ <b>{formatMbps(path?.home_to_vps_mbps)}</b></span>
          {density === "large" && <small>Mbps</small>}
          {old && path?.bandwidth_at ? <small className="family-old">{t("family.lastSuccess")}</small> : null}
        </span>
        {density === "large" && <Sparkline points={path?.sparkline ?? []} now={now} />}
      </>;
      return <div className="family-summary-row" key={family} data-family={family}>
        {interactive ? <Link to={`/server/${encodeURIComponent(id)}?section=home-path&family=${family}`} className="family-summary-link" aria-label={t("family.details", { family: familyLabel(family) })}>{data}</Link> : <span className="family-summary-link">{data}</span>}
        {interactive && density !== "mini" && <FamilyTestButton id={id} family={family} />}
        {hint && <span className={`family-row-status${failed || actionError ? " family-error" : ""}`} role={actionError ? "alert" : undefined}>{actionError || hint}{old && path?.bandwidth_at ? ` · ${relativeTime(path.bandwidth_at, now)}` : ""}</span>}
      </div>;
    })}
    {loading && <span className="family-row-status">{t("panel.loading")}</span>}
  </section>;
}
