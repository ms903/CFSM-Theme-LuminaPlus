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
import { formatMbps, HOME_BANDWIDTH_DIRECTIONS, getFamilyHistory, isPathActive, pathChartPoints, pathKey, type BandwidthDetails, type IpFamily, type PathPoint } from "@/services/familyPath";
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
  return <InstancePanel id="home-path" title={t("family.panel")} className="family-panel" description={site.bandwidth_duration_seconds
    ? t("family.timedInterval", { n: site.bandwidth_duration_seconds, h: site.bandwidth_interval_hours })
    : t("family.interval", { n: site.bandwidth_interval_hours })}
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
      {HOME_BANDWIDTH_DIRECTIONS.map(({ field, tone, label, arrow }) =>
        <Metric key={tone} label={`${arrow} ${t(label)}`} value={`${formatMbps(path?.[field])} Mbps`} tone={tone} />
      )}
    </div>
    {path?.bandwidth_details && <SpeedQuality details={path.bandwidth_details} />}
    <div className="family-update-times">
      <span title={fullTime(path?.latency_at ?? 0)}>{t("family.latencyUpdated")} · {relativeTime(path?.latency_at ?? 0, now)}{latencyOld ? ` · ${t("family.stale")}` : ""}</span>
      <span title={fullTime(path?.bandwidth_at ?? 0)}>{t(old ? "family.lastSuccess" : "family.bandwidthUpdated")} · {relativeTime(path?.bandwidth_at ?? 0, now)}</span>
    </div>
    {path?.latency_status === "error" && <p className="family-error">{t("family.latency")} · {path.latency_error || t("family.unreachable")}</p>}
    {path?.bandwidth_status === "error" && <p className="family-error">{t("family.failed")} · {path.bandwidth_error}</p>}
    {history.isError ? <div className="family-history-notice" role="alert">{t("family.historyError")} <button className="control-button family-test" onClick={() => void history.refetch()}><RefreshCw size={13} />{t("family.retry")}</button></div>
      : history.isPending ? <div className="family-history-notice"><LoaderCircle size={16} className="family-spin" />{t("panel.loading")}</div>
      : <BandwidthChart key={`${id}:${family}:${hours}`} points={points} hours={hours} intervalHours={site.bandwidth_interval_hours} end={history.dataUpdatedAt || now} />}
    <details className="family-records">
      <summary>{t("family.records")} <span>{points.length}</span></summary>
      <div className="family-records-scroll"><table>
        <thead><tr><th>{t("family.time")}</th><th>{t("family.result")}</th>{HOME_BANDWIDTH_DIRECTIONS.map(({ tone, label, arrow }) => <th key={tone}>{arrow} {t(label)} · Mbps</th>)}<th>{t("family.quality")}</th><th>{t("family.reason")}</th></tr></thead>
        <tbody>{[...points].reverse().slice(0, 30).map(point => <tr key={point.observed_at}>
          <td>{fullTime(point.observed_at)}</td><td className={point.status === "ok" ? "" : "family-error"}>{t(point.status === "ok" ? "family.complete" : "family.failed")}</td>
          {HOME_BANDWIDTH_DIRECTIONS.map(({ field, tone }) =>
            <td key={tone}>{point.status === "ok" ? point[field]?.toFixed(2) ?? "—" : "—"}</td>
          )}
          <td>{point.bandwidth_details
            ? `${point.bandwidth_details.duration_seconds}s · ${t("family.retransmits")} ${retransmitText(point.bandwidth_details)} · ${icmpLossText(point.bandwidth_details)}`
            : "—"}</td>
          <td>{point.error || "—"}</td>
        </tr>)}</tbody>
      </table></div>
      {!points.length && <p className="family-history-notice">{t("family.noHistory")}</p>}
    </details>
  </InstancePanel>;
}
function retransmitText(details: BandwidthDetails) {
  return t("family.retransmitValue", {
    down: details.vps_to_home.retransmits?.toLocaleString() ?? "—",
    up: details.home_to_vps.retransmits?.toLocaleString() ?? "—",
  });
}
function icmpLossText(details: BandwidthDetails) {
  const icmp = details.icmp;
  return icmp ? `${((icmp.sent - icmp.received) * 100 / icmp.sent).toFixed(1)}% (${icmp.sent - icmp.received}/${icmp.sent})` : "—";
}
function SpeedQuality({ details }: { details: BandwidthDetails }) {
  const ms = (value?: number | null) => value == null ? "—" : `${value.toFixed(1)} ms`;
  return <section aria-label={t("family.quality")}>
    <div className="family-update-times"><span>{t("family.durationMeasured", {
      down: details.vps_to_home.seconds.toFixed(1), up: details.home_to_vps.seconds.toFixed(1), warmup: details.warmup_seconds,
    })}</span></div>
    <div className="family-metrics">
      <Metric label={t("family.retransmits")} value={retransmitText(details)} />
      <Metric label={t("family.icmpLoss")} value={icmpLossText(details)} />
      <Metric label={t("family.icmpRTT")} value={`${ms(details.icmp?.rtt_avg_ms)} / ${ms(details.icmp?.rtt_mdev_ms)}`} />
    </div>
  </section>;
}
function Metric({ label, value, tone, warning }: { label: string; value: string; tone?: string; warning?: boolean }) {
  return <div className={`family-metric${tone ? ` family-${tone}` : ""}${warning ? " family-warning" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}
function BandwidthChart({ points, hours, intervalHours, end }: { points: PathPoint[]; hours: number; intervalHours: number; end: number }) {
  const { resolvedAppearance } = usePreferences();
  const colorVersion = useMetricColorsVersion();
  const { w, h, ref } = useResponsiveChartSize("wide");
  const chartPoints = useMemo(() => pathChartPoints(points, intervalHours), [points, intervalHours]);
  const data = useMemo<uPlot.AlignedData>(() => [chartPoints.map(p => p.observed_at / 1000), ...HOME_BANDWIDTH_DIRECTIONS.map(({ field }) => chartPoints.map(p => p[field]))], [chartPoints]);
  const dataRef = useRef(data); dataRef.current = data;
  const [tooltip, setTooltip] = useState<ChartTooltipState>({ show: false, left: 0, top: 0, time: "", rows: [] });
  const options = useMemo<uPlot.Options>(() => {
    void colorVersion;
    const colors = HOME_BANDWIDTH_DIRECTIONS.map(({ tone }) => safeCanvasColor(`var(--traffic-${tone})`));
    const axis = getAxisColors(resolvedAppearance === "dark");
    const hooks = buildChartTooltipHooks({ dataRef, rangeHours: hours, estimatedWidth: 244, setTooltip,
      buildRows: idx => colors.map((color, n) => ({ label: t(HOME_BANDWIDTH_DIRECTIONS[n].label), color,
        value: dataRef.current[n + 1]?.[idx] == null ? t("family.gap") : `${dataRef.current[n + 1][idx]!.toFixed(2)} Mbps` })) });
    return { width: w, height: h, padding: [12, 12, 0, 0], legend: { show: false }, select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      cursor: { drag: { x: false, y: false }, points: { size: 5 } },
      scales: { x: { time: true, range: () => [end / 1000 - hours * 3600, end / 1000] }, y: { auto: true, range: (_u, _min, max) => [0, Math.max(1, max * 1.1)] } },
      axes: [{ stroke: axis.text, grid: { show: false }, ticks: { show: false }, values: createTimeAxisFormatter(hours), incrs: hours >= 168 ? [86400, 172800, 345600, 604800, 1209600, 2592000] : undefined, space: 80, font: "12px sans-serif" },
        { stroke: axis.text, grid: { stroke: axis.grid, width: 1 }, ticks: { show: false }, size: 58, font: "12px sans-serif" }],
      series: [{}, ...colors.map((color, n) => ({ label: t(HOME_BANDWIDTH_DIRECTIONS[n].label), stroke: color, width: 1.25, spanGaps: false, points: { ...SPARSE_SERIES_POINTS, size: 3 } }))],
      hooks: { init: [hooks.onInit], destroy: [hooks.onDestroy], setCursor: [hooks.onSetCursor] },
    };
    // The color version invalidates CSS-variable resolution when a user changes their palette.
  }, [w, h, resolvedAppearance, colorVersion, hours, end]);
  const successful = points.some(p => p.status === "ok" && (p.vps_to_home_mbps != null || p.home_to_vps_mbps != null));
  return <div className="family-history">
    <div className="family-chart-legend"><span>Mbps</span>{HOME_BANDWIDTH_DIRECTIONS.map(({ tone, label, arrow }) => <span key={tone} className={`family-${tone}`}>{arrow} {t(label)}</span>)}</div>
    <div ref={ref} className="family-chart instance-chart-wrap">
      {successful ? <><UplotReact options={options} data={data} /><ChartTooltip tooltip={tooltip} /></> : <p className="family-history-notice">{t(points.length ? "family.noSuccess" : "family.noHistory")}</p>}
    </div>
  </div>;
}
