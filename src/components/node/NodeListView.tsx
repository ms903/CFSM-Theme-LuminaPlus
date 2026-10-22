import { FamilyPathSummary } from "@/components/family-path/FamilyPathSummary";
import { t } from "@/i18n";
import { memo, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CircleDollarSign } from "lucide-react";
import { clsx } from "clsx";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { usePreferences } from "@/hooks/usePreferences";
import { useMetricColorsVersion } from "@/hooks/useMetricColors";
import { formatBytes } from "@/utils/format";
import { speedRateColor } from "@/utils/metricTone";
import { CanvasStrip, fillRoundedRect, safeCanvasColor } from "./CanvasStrip";
import { LatencyBars } from "./LatencyBars";
import { HealthBucketTooltip } from "./HealthBucketTooltip";
import { formatOsLabel, joinTagTitle, nodeDetailLinkLabels } from "./nodeCardShared";
import { formatHealthBucketTooltip } from "./pingBucketText";
import type { PingOverviewTaskLoadState } from "@/types/cfsm";
import { HOMEPAGE_PING_BUCKET_COUNT } from "@/hooks/usePingOverview";

const GAUGE_SEGMENTS = 14;


function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function pctText(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value >= 10 ? Math.round(value).toString() : value.toFixed(1);
}

type ListPingState = PingOverviewTaskLoadState | "unconfigured";

export function resolveListPingState(
  loadState: PingOverviewTaskLoadState | undefined,
  hasRealHomepagePingBinding: boolean,
  pingIsAssigned: boolean,
): ListPingState {
  if (!hasRealHomepagePingBinding && !pingIsAssigned) return "unconfigured";
  return loadState ?? (pingIsAssigned ? "ready" : "pending");
}

export function formatListPingStatus(
  latency: number | null,
  state: ListPingState,
) {
  const roundedLatency = latency == null ? null : Math.round(latency);
  const value = roundedLatency == null ? null : t("list.latencyMs", { n: roundedLatency });
  if (value != null) {
    if (state === "error") {
      return {
        visibleText: `${roundedLatency}`,
        title: t("card.pingStale"),
        ariaText: t("list.valueWithStatus", { value, status: t("card.pingStale") }),
      };
    }
    if (state === "pending") {
      return {
        visibleText: `${roundedLatency}`,
        title: t("list.pingRefreshing"),
        ariaText: t("list.valueWithStatus", { value, status: t("list.pingRefreshing") }),
      };
    }
    return {
      visibleText: `${roundedLatency}`,
      title: `${value}`,
      ariaText: value,
    };
  }

  switch (state) {
    case "unconfigured":
      return {
        visibleText: t("card.pingUnset"),
        title: t("card.pingUnsetTitle"),
        ariaText: t("card.pingUnsetTitle"),
      };
    case "pending":
      return {
        visibleText: t("card.pingLoading"),
        title: t("card.pingLoadingTitle"),
        ariaText: t("card.pingLoadingTitle"),
      };
    case "error":
      return {
        visibleText: t("card.pingFailed"),
        title: t("card.pingFailedTitle"),
        ariaText: t("card.pingFailedTitle"),
      };
    default:
      return {
        visibleText: t("card.pingNoSamples"),
        title: t("card.pingNoSamplesTitle"),
        ariaText: t("card.pingNoSamples"),
      };
  }
}

// 细 canvas 分段条 + 百分比,与大卡 MetricBar 同一视觉语言,但压成一格(数值在上、细条在下)。
function ListGauge({
  value,
  fraction,
  paint,
  redrawKey,
  unit = "%",
}: {
  value: string;
  fraction: number;
  paint: string;
  redrawKey: string;
  unit?: string;
}) {
  const activeSegments = clamp01(fraction) * GAUGE_SEGMENTS;
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const inactive = safeCanvasColor("var(--progress-bg)");
      const active = safeCanvasColor(paint);
      const gap = 2;
      const segWidth = Math.max(1, (width - gap * (GAUGE_SEGMENTS - 1)) / GAUGE_SEGMENTS);
      for (let i = 0; i < GAUGE_SEGMENTS; i += 1) {
        const x = i * (segWidth + gap);
        const fill = Math.max(0, Math.min(1, activeSegments - i));
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = inactive;
        fillRoundedRect(ctx, x, 0, segWidth, height, 2);
        if (fill > 0) {
          ctx.globalAlpha = 0.42 + fill * 0.56;
          ctx.fillStyle = active;
          fillRoundedRect(ctx, x, 0, segWidth, height, 2);
        }
      }
      ctx.globalAlpha = 1;
    },
    [activeSegments, paint],
  );
  return (
    <div className="node-list-gauge">
      <span className="node-list-gauge-value tabular">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <CanvasStrip className="node-list-gauge-track" height={8} redrawKey={redrawKey} draw={draw} />
    </div>
  );
}

// 一格两行的小堆叠(实时速率/在线到期共用):每行「值 + 可选单位」,可单独着色。
function StackLine({
  icon,
  value,
  unit,
  color,
}: {
  icon?: React.ReactNode;
  value: string;
  unit?: string;
  color?: string;
}) {
  return (
    <span className="node-list-line" style={color ? { color } : undefined}>
      {icon && <span className="node-list-line-icon">{icon}</span>}
      <span className="node-list-line-value tabular">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </span>
  );
}

// 网络列:当前延迟在上,聚合延迟柱状图在下(热力着色,与大卡同一视觉语言)。
function ListLatency({
  latency,
  loadState,
  hasRealHomepagePingBinding,
  pingIsAssigned,
  latencyColor,
  buckets,
  redrawKey,
}: {
  latency: number | null;
  loadState: PingOverviewTaskLoadState | undefined;
  hasRealHomepagePingBinding: boolean;
  pingIsAssigned: boolean;
  latencyColor: string;
  buckets: Parameters<typeof LatencyBars>[0]["buckets"];
  redrawKey: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const state = resolveListPingState(
    loadState,
    hasRealHomepagePingBinding,
    pingIsAssigned,
  );
  const status = formatListPingStatus(latency, state);
  const hoveredBucket = hoveredIndex == null ? null : (buckets[hoveredIndex] ?? null);
  const tooltip = hoveredBucket
    ? formatHealthBucketTooltip(hoveredBucket, "latency")
    : null;

  return (
    <div
      className="node-list-latency"
      data-ping-state={state}
      aria-label={t("list.netLatencyAria", { status: status.ariaText })}
    >
      <span
        className="node-list-latency-value tabular"
        style={{ color: latencyColor }}
        title={status.title}
      >
        {status.visibleText}
        {latency != null && <small>ms</small>}
      </span>
      <span className="node-list-latency-bars">
        <LatencyBars
          buckets={buckets}
          redrawKey={redrawKey}
          height={14}
          onHoverIndex={setHoveredIndex}
        />
        <HealthBucketTooltip text={tooltip} index={hoveredIndex} count={buckets.length} />
      </span>
    </div>
  );
}

const NodeRow = memo(function NodeRow({ uuid }: { uuid: string }) {
  const { resolvedAppearance } = usePreferences();
  const colorsVersion = useMetricColorsVersion();
  const redrawKey = `${resolvedAppearance}:${colorsVersion}`;
  const model = useNodeCardModel(uuid, {
    pingBucketCount: HOMEPAGE_PING_BUCKET_COUNT,
  });

  if (!model.node) {
    return <div className="node-list-row is-loading" aria-busy />;
  }

  const {
    node,
    traffic,
    ping,
    pingBuckets,
    footerTags,
    expire,
    expireColor,
    uptime,
    renewalPrice,
    latencyColor,
    hasRealHomepagePingBinding,
    loadFraction,
    upRate,
    downRate,
    isOffline,
    osName,
  } = model;
  const listPingState = resolveListPingState(
    ping.loadState,
    hasRealHomepagePingBinding,
    ping.isAssigned,
  );
  const listPingStatus = formatListPingStatus(ping.lastValue, listPingState);
  const detailLabels = nodeDetailLinkLabels(node.name, osName);
  const usedPct = `${Math.round(clamp01(traffic.fraction) * 100)}%`;
  const rowLabel = [
    node.name,
    t("list.ariaOs", { os: formatOsLabel(osName, node.os) }),
    `CPU ${pctText(node.cpuPct)}`,
    `${t("metric.memory")} ${pctText(node.ramPct)}`,
    `${t("metric.disk")} ${pctText(node.diskPct)}`,
    `${t("metric.load")} ${node.load1.toFixed(2)}`,
    `${t("traffic.upload")} ${upRate.value}${upRate.unit}`,
    `${t("traffic.download")} ${downRate.value}${downRate.unit}`,
    t("list.ariaTrafficUsed", { value: usedPct }),
    t("list.netLatencyAria", { status: listPingStatus.ariaText }),
    node.online === true
      ? t("status.online")
      : node.online === false
        ? t("status.offline")
        : t("status.unknown"),
    t("list.ariaUptime", { value: `${uptime.value}${uptime.unit}` }),
    `${t("card.expire")} ${expire.value}${expire.unit}`,
    t("common.viewDetails"),
  ].join(t("common.listSeparator"));

  return (
    <Link
      to={`/server/${encodeURIComponent(uuid)}`}
      className={clsx("node-list-row", isOffline && "is-offline")}
      title={detailLabels.title}
      aria-label={rowLabel}
    >
      <div className="node-list-cell node-list-node">
        <div className="node-list-node-text">
          <div className="node-list-node-head">
            <Flag region={node.region} size={14} />
            <span className="node-list-name" title={node.name}>
              {node.name}
            </span>
          </div>
          {(renewalPrice || footerTags.length > 0) && (
            <div className="node-list-chips" title={footerTags.length > 0 ? joinTagTitle(footerTags) : undefined}>
              {renewalPrice && (
                <span className="dstatus-price-chip">
                  <CircleDollarSign size={12} strokeWidth={2.2} />
                  {renewalPrice}
                </span>
              )}
              {footerTags.map((tag, index) => (
                <span
                  key={`${tag.label}-${index}`}
                  className="dstatus-tag-chip"
                  data-tag={tag.color}
                  style={{ background: "var(--tag-bg)", color: "var(--tag-fg)" }}
                >
                  {tag.label}
                </span>
              ))}
            </div>
          )}
          <FamilyPathSummary id={uuid} density="list" />
        </div>
      </div>

      <div className="node-list-cell col-os">
        <OsLogo value={node.os} size={16} />
        <span className="node-list-os-name" title={node.os || osName}>
          {formatOsLabel(osName, node.os)}
        </span>
      </div>

      <div className="node-list-cell col-metric">
        <ListGauge value={pctText(node.cpuPct)} fraction={node.cpuPct / 100} paint="var(--progress-cpu)" redrawKey={redrawKey} />
      </div>
      <div className="node-list-cell col-metric">
        <ListGauge value={pctText(node.ramPct)} fraction={node.ramPct / 100} paint="var(--progress-memory)" redrawKey={redrawKey} />
      </div>
      <div className="node-list-cell col-metric">
        <ListGauge value={pctText(node.diskPct)} fraction={node.diskPct / 100} paint="var(--progress-disk)" redrawKey={redrawKey} />
      </div>

      <div className="node-list-cell col-load">
        <ListGauge
          value={node.load1.toFixed(2)}
          unit=""
          fraction={loadFraction}
          paint="var(--progress-load)"
          redrawKey={redrawKey}
        />
      </div>

      <div className="node-list-cell col-live node-list-stack">
        <StackLine
          icon={<ArrowUp size={11} strokeWidth={2.4} />}
          value={upRate.value}
          unit={upRate.unit}
          color={speedRateColor(upRate.unit)}
        />
        <StackLine
          icon={<ArrowDown size={11} strokeWidth={2.4} />}
          value={downRate.value}
          unit={downRate.unit}
          color={speedRateColor(downRate.unit)}
        />
      </div>

      <div
        className="node-list-cell col-traffic"
        title={traffic.tooltip}
      >
        <div className="node-list-traffic-rows">
          <StackLine icon={<ArrowUp size={11} strokeWidth={2.1} />} value={formatBytes(node.trafficUp)} />
          <StackLine icon={<ArrowDown size={11} strokeWidth={2.1} />} value={formatBytes(node.trafficDown)} />
        </div>
        <span className="node-list-traffic-quota" style={{ color: traffic.color }}>
          {usedPct}
        </span>
      </div>

      <div className="node-list-cell col-net">
        <ListLatency
          latency={ping.lastValue}
          loadState={ping.loadState}
          hasRealHomepagePingBinding={hasRealHomepagePingBinding}
          pingIsAssigned={ping.isAssigned}
          latencyColor={latencyColor}
          buckets={pingBuckets}
          redrawKey={redrawKey}
        />
      </div>

      <div className="node-list-cell col-life node-list-stack">
        <StackLine value={uptime.value} unit={uptime.unit} color="var(--progress-cpu)" />
        <StackLine value={expire.value} unit={expire.unit} color={expireColor} />
      </div>
    </Link>
  );
});

export function NodeListView({ uuids }: { uuids: string[] }) {
  return (
    <div className="node-list-scroll">
      <div className="node-list">
        <div className="node-list-row node-list-head" aria-hidden>
          <div className="node-list-cell node-list-node">{t("list.headNode")}</div>
          <div className="node-list-cell col-os">{t("list.headOs")}</div>
          <div className="node-list-cell col-metric">CPU</div>
          <div className="node-list-cell col-metric">{t("metric.memory")}</div>
          <div className="node-list-cell col-metric">{t("metric.disk")}</div>
          <div className="node-list-cell col-load">{t("metric.load")}</div>
          <div className="node-list-cell col-live">{t("traffic.live")}</div>
          <div className="node-list-cell col-traffic">{t("card.traffic")}</div>
          <div className="node-list-cell col-net">{t("list.headNetwork")}</div>
          <div className="node-list-cell col-life">{t("list.headLife")}</div>
        </div>
        {uuids.map((uuid) => (
          <NodeRow key={uuid} uuid={uuid} />
        ))}
      </div>
    </div>
  );
}
