import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { t } from "@/i18n";
import { useNodeMeta } from "@/hooks/useNode";
import { usePreferences } from "@/hooks/usePreferences";
import { useMetricColorsVersion } from "@/hooks/useMetricColors";
import { safeCanvasColor } from "@/components/node/CanvasStrip";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { ChartTooltip } from "@/components/instance/ChartParts";
import { buildChartTooltipHooks, createTimeAxisFormatter, getAxisColors, SPARSE_SERIES_POINTS, useResponsiveChartSize, type ChartTooltipState } from "@/components/instance/chartShared";
import { formatMbps, getFamilyHistory, isPathActive, pathChartPoints, pathKey, type IpFamily, type PathPoint } from "@/services/familyPath";
import { useServerPaths } from "./FamilyPathProvider";
import { availableFamilies, bandwidthOld, familyLabel, FamilyTestButton, fullTime, latencyText, relativeTime, taskLabel } from "./FamilyPathSummary";

const EMPTY: PathPoint[] = [];
export function FamilyPathPanel({ id }: { id: string }) {
  const { paths, site, now, visible, errors, pending } = useServerPaths(id);
  const meta = useNodeMeta(id);
  const [search, setSearch] = useSearchParams();
  const families = availableFamilies(paths, meta);
  const requested = search.get("family") as IpFamily;
  const family = families.includes(requested) ? requested : families[0] ?? "ipv4";
  const [hours, setHours] = useState(168);
  const path = paths.find(p => p.family === family);
  const resultKey = path && !isPathActive(path) ? `${path.bandwidth_status}:${path.bandwidth_at}:${path.bandwidth_started_at}` : "active";
  const history = useQuery({
    queryKey: ["family-history", site?.base, id, family, hours, resultKey],
    queryFn: ({ signal }) => getFamilyHistory(id, family, hours, { base: site?.base, signal }),
    enabled: visible && Boolean(site && !site.unsupported && families.length && meta?.name.trim().toLowerCase() !== "home server"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const deepLink = search.get("section") === "home-path";
  const hasSite = Boolean(site);
  useEffect(() => {
    if (!deepLink || !hasSite || !families.length) return;
    const frame = requestAnimationFrame(() => document.getElementById("home-path")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [deepLink, id, hasSite, families.length]);
  if (!site || site.unsupported || !families.length || meta?.name.trim().toLowerCase() === "home server") return null;
  const actionKey = pathKey(site.base, id, family);
  const actionError = errors[actionKey];
  const submitting = pending.has(actionKey);
  const old = path && bandwidthOld(path, now, site.bandwidth_interval_hours);
  const latencyValid = path?.latency_status === "ok";
  const latencyOld = path && path.latency_at > 0 && now - path.latency_at > 3 * 60_000;
  const value = (v: number | null | undefined, unit: string) => latencyValid && v != null ? `${v.toFixed(1)} ${unit}` : "—";
  const points = history.data?.points ?? EMPTY;
  const selectFamily = (next: IpFamily) => setSearch(prev => { const copy = new URLSearchParams(prev); copy.set("family", next); copy.set("section", "home-path"); return copy; }, { replace: true });
  return <InstancePanel id="home-path" title={t("family.panel")} className="family-panel" description={t("family.interval", { n: site.bandwidth_interval_hours })}
    aside={<div className="family-panel-controls">
      <div className="instance-segmented" aria-label={t("family.title")}>
        {families.map(f => <button key={f} type="button" aria-pressed={family === f} data-active={family === f} onClick={() => selectFamily(f)}>{familyLabel(f)}</button>)}
      </div>
      <div className="instance-segmented" aria-label={t("family.records")}>
        {[24, 168, 720].map(n => <button key={n} type="button" aria-pressed={hours === n} data-active={hours === n} onClick={() => setHours(n)}>{n === 24 ? t("duration.hours", { n }) : t("duration.days", { n: n / 24 })}</button>)}
      </div>
      <FamilyTestButton id={id} family={family} full />
    </div>}>
    <div className="family-detail-status" aria-live="polite">
      <span className={path?.bandwidth_status === "error" ? "family-error" : ""}>
        {(submitting || (path && isPathActive(path))) && <LoaderCircle size={14} className="family-spin" aria-hidden />}
        {submitting ? t("family.submitting") : taskLabel(path, now)}
      </span>
      <span className="family-address">{familyLabel(family)}{path?.ip_address ? ` · ${path.ip_address}` : ""}</span>
    </div>
    {(site.error || actionError) && <p className="family-error" role="alert">{actionError || t("family.dataError")}</p>}
    <div className="family-metrics">
      <Metric label="RTT" value={latencyText(path)} warning={Boolean(latencyOld || path?.latency_status === "error")} />
      <Metric label="p95" value={value(path?.rtt_p95_ms, "ms")} />
      <Metric label={t("family.loss")} value={value(path?.loss_percent, "%")} />
      <Metric label={t("family.jitter")} value={value(path?.jitter_ms, "ms")} />
      <Metric label={`↑ ${t("family.up")}`} value={`${formatMbps(path?.vps_to_home_mbps)} Mbps`} tone="up" />
      <Metric label={`↓ ${t("family.down")}`} value={`${formatMbps(path?.home_to_vps_mbps)} Mbps`} tone="down" />
    </div>
    <div className="family-update-times">
      <span title={fullTime(path?.latency_at ?? 0)}>{t("family.latencyUpdated")} · {relativeTime(path?.latency_at ?? 0, now)}{latencyOld ? ` · ${t("family.stale")}` : ""}</span>
      <span title={fullTime(path?.bandwidth_at ?? 0)}>{t(old ? "family.lastSuccess" : "family.bandwidthUpdated")} · {relativeTime(path?.bandwidth_at ?? 0, now)}</span>
    </div>
    {path?.latency_status === "error" && <p className="family-error">{t("family.latency")} · {path.latency_error || t("family.unreachable")}</p>}
    {path?.bandwidth_status === "error" && <p className="family-error">{t("family.failed")} · {path.bandwidth_error}</p>}
    {history.isError ? <div className="family-history-notice" role="alert">{t("family.historyError")} <button className="control-button family-test" onClick={() => void history.refetch()}><RefreshCw size={13} />{t("family.retry")}</button></div>
      : history.isPending ? <div className="family-history-notice"><LoaderCircle size={16} className="family-spin" />{t("panel.loading")}</div>
      : <BandwidthChart key={`${id}:${family}:${hours}`} points={points} hours={hours} end={history.dataUpdatedAt || now} />}
    <details className="family-records">
      <summary>{t("family.records")} <span>{points.length}</span></summary>
      <div className="family-records-scroll"><table>
        <thead><tr><th>{t("family.time")}</th><th>{t("family.result")}</th><th>↑ {t("family.up")} · Mbps</th><th>↓ {t("family.down")} · Mbps</th><th>{t("family.reason")}</th></tr></thead>
        <tbody>{[...points].reverse().slice(0, 30).map(point => <tr key={point.observed_at}>
          <td>{fullTime(point.observed_at)}</td><td className={point.status === "ok" ? "" : "family-error"}>{t(point.status === "ok" ? "family.complete" : "family.failed")}</td>
          <td>{point.status === "ok" ? point.vps_to_home_mbps?.toFixed(2) ?? "—" : "—"}</td><td>{point.status === "ok" ? point.home_to_vps_mbps?.toFixed(2) ?? "—" : "—"}</td><td>{point.error || "—"}</td>
        </tr>)}</tbody>
      </table></div>
      {!points.length && <p className="family-history-notice">{t("family.noHistory")}</p>}
    </details>
  </InstancePanel>;
}
function Metric({ label, value, tone, warning }: { label: string; value: string; tone?: string; warning?: boolean }) {
  return <div className={`family-metric${tone ? ` family-${tone}` : ""}${warning ? " family-warning" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}
function BandwidthChart({ points, hours, end }: { points: PathPoint[]; hours: number; end: number }) {
  const { resolvedAppearance } = usePreferences();
  const colorVersion = useMetricColorsVersion();
  const { w, h, ref } = useResponsiveChartSize("wide");
  const chartPoints = useMemo(() => pathChartPoints(points), [points]);
  const data = useMemo<uPlot.AlignedData>(() => [chartPoints.map(p => p.observed_at / 1000), chartPoints.map(p => p.vps_to_home_mbps), chartPoints.map(p => p.home_to_vps_mbps)], [chartPoints]);
  const dataRef = useRef(data); dataRef.current = data;
  const [tooltip, setTooltip] = useState<ChartTooltipState>({ show: false, left: 0, top: 0, time: "", rows: [] });
  const options = useMemo<uPlot.Options>(() => {
    void colorVersion;
    const colors = [safeCanvasColor("var(--traffic-up)"), safeCanvasColor("var(--traffic-down)")];
    const axis = getAxisColors(resolvedAppearance === "dark");
    const hooks = buildChartTooltipHooks({ dataRef, rangeHours: hours, estimatedWidth: 244, setTooltip,
      buildRows: idx => colors.map((color, n) => ({ label: t(n ? "family.down" : "family.up"), color,
        value: dataRef.current[n + 1]?.[idx] == null ? t("family.gap") : `${dataRef.current[n + 1][idx]!.toFixed(2)} Mbps` })) });
    return { width: w, height: h, padding: [12, 12, 0, 0], legend: { show: false }, select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      cursor: { drag: { x: false, y: false }, points: { size: 5 } },
      scales: { x: { time: true, range: () => [end / 1000 - hours * 3600, end / 1000] }, y: { auto: true, range: (_u, _min, max) => [0, Math.max(1, max * 1.1)] } },
      axes: [{ stroke: axis.text, grid: { show: false }, ticks: { show: false }, values: createTimeAxisFormatter(hours), incrs: hours >= 168 ? [86400, 172800, 345600, 604800, 1209600, 2592000] : undefined, space: 80, font: "12px sans-serif" },
        { stroke: axis.text, grid: { stroke: axis.grid, width: 1 }, ticks: { show: false }, size: 58, font: "12px sans-serif" }],
      series: [{}, ...colors.map((color, n) => ({ label: t(n ? "family.down" : "family.up"), stroke: color, width: 1.25, spanGaps: false, points: { ...SPARSE_SERIES_POINTS, size: 3 } }))],
      hooks: { init: [hooks.onInit], destroy: [hooks.onDestroy], setCursor: [hooks.onSetCursor] },
    };
    // The color version invalidates CSS-variable resolution when a user changes their palette.
  }, [w, h, resolvedAppearance, colorVersion, hours, end]);
  const successful = points.some(p => p.status === "ok" && (p.vps_to_home_mbps != null || p.home_to_vps_mbps != null));
  return <div className="family-history">
    <div className="family-chart-legend"><span>Mbps</span><span className="family-up">↑ {t("family.up")}</span><span className="family-down">↓ {t("family.down")}</span></div>
    <div ref={ref} className="family-chart instance-chart-wrap">
      {successful ? <><UplotReact options={options} data={data} /><ChartTooltip tooltip={tooltip} /></> : <p className="family-history-notice">{t(points.length ? "family.noSuccess" : "family.noHistory")}</p>}
    </div>
  </div>;
}
