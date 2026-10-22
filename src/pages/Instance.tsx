import { FamilyPathPanel } from "@/components/family-path/FamilyPathPanel";
import { t } from "@/i18n";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import "uplot/dist/uPlot.min.css";
import { InstanceDetails } from "@/components/instance/InstanceDetails";
import { PingChart } from "@/components/instance/PingChart";
import { LoadChart } from "@/components/instance/LoadChart";
import { Spinner } from "@/components/ui/Spinner";
import {
  buildLoadTimeRangeOptions,
  buildPingTimeRangeOptions,
} from "@/components/instance/chartShared";
import { useAuth } from "@/hooks/useAuth";
import { useNodeMeta, useNodeStoreStatus, useRealtimeFocus } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { ANONYMOUS_MAX_HISTORY_HOURS } from "@/services/api";

// 1 小时：详情页每打开一次就是一趟 /api/history/all 全量行，默认档位越短后端读的行越少。
const DEFAULT_PING_HOURS = 1;
/** `/api/history/all` 的 hours 上限。 */
const MAX_HISTORY_HOURS = 168;
type TimeRangeOption = ReturnType<typeof buildLoadTimeRangeOptions>[number];

function RangeSelector({
  ranges,
  value,
  onChange,
}: {
  ranges: TimeRangeOption[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="instance-segmented is-scrollable">
      {ranges.map((range) => (
        <button
          key={range.value}
          type="button"
          data-active={value === range.value ? "true" : "false"}
          aria-pressed={value === range.value}
          onClick={() => onChange(range.value)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

export function Instance() {
  const { uuid } = useParams<{ uuid: string }>();
  const [search] = useSearchParams();
  const homePathRequested = search.get("section") === "home-path";
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const meta = useNodeMeta(uuid ?? "");
  const storeStatus = useNodeStoreStatus(Boolean(uuid));
  // 详情页只订阅这一台的实时推送（后端文档：详情页不要订阅全量再在前端过滤）。
  useRealtimeFocus(uuid);
  const [chartType, setChartType] = useState<"load" | "ping">("load");
  const [loadHours, setLoadHours] = useState(0);
  const [pingHours, setPingHours] = useState(DEFAULT_PING_HOURS);
  const chartControlsRef = useRef<HTMLDivElement | null>(null);

  // 后端最长支持 7 天；未登录访客查询超过 24 小时会被拒绝，所以直接不显示更长的档位。
  const maxHistoryHours = me?.logged_in
    ? MAX_HISTORY_HOURS
    : ANONYMOUS_MAX_HISTORY_HOURS;

  const loadRanges = useMemo(
    () => buildLoadTimeRangeOptions(maxHistoryHours),
    [maxHistoryHours],
  );
  const pingRanges = useMemo(
    () => buildPingTimeRangeOptions(maxHistoryHours),
    [maxHistoryHours],
  );
  const showPingChart = themeSettings.isReady && themeSettings.showPingChart;

  const alignCharts = useCallback(() => {
    const frame = window.requestAnimationFrame(() => {
      if (homePathRequested) return;
      const element = chartControlsRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight) return;
      element.scrollIntoView({ behavior: "auto", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [homePathRequested]);

  useEffect(() => {
    if (!loadRanges.some((range) => range.value === loadHours)) {
      setLoadHours(loadRanges[0]?.value ?? 0);
    }
  }, [loadHours, loadRanges]);

  useEffect(() => {
    if (!pingRanges.some((range) => range.value === pingHours)) {
      setPingHours(
        pingRanges.find((range) => range.value === DEFAULT_PING_HOURS)?.value ??
          pingRanges[0]?.value ??
          DEFAULT_PING_HOURS,
      );
    }
  }, [pingHours, pingRanges]);

  useEffect(() => {
    if (!showPingChart && chartType === "ping") {
      setChartType("load");
    }
  }, [chartType, showPingChart]);

  if (!uuid) return null;

  if (!meta) {
    const message = storeStatus.hydrated
      ? t("instance.notFoundBody")
      : storeStatus.nodeInfoError
        ? t("instance.loadFailedBody")
        : null;
    return (
      <div className="flex flex-col gap-5 py-2">
        <Link to="/" className="instance-page-back">
          <ChevronLeft size={14} />
          {t("common.back")}
        </Link>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          {message ? (
            <>
              <div className="text-[15px] font-semibold text-[var(--text-primary)]">
                {storeStatus.hydrated ? t("instance.notFound") : t("instance.loadFailed")}
              </div>
              <p className="text-[13px] text-[var(--text-secondary)]">{message}</p>
            </>
          ) : (
            <Spinner size={24} label={t("instance.loading")} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-2">
      <Link
        to="/"
        className="instance-page-back"
      >
        <ChevronLeft size={14} />
        {t("common.back")}
      </Link>
      <InstanceDetails uuid={uuid} onNodeReady={alignCharts} />
      <div ref={chartControlsRef} className="instance-chart-controls">
        <div className="instance-segmented">
          <button
            type="button"
            data-active={chartType === "load" ? "true" : "false"}
            aria-pressed={chartType === "load"}
            onClick={() => {
              startTransition(() => setChartType("load"));
            }}
          >
            {t("instance.tabLoad")}
          </button>
          {showPingChart && (
            <button
              type="button"
              data-active={chartType === "ping" ? "true" : "false"}
              aria-pressed={chartType === "ping"}
              onClick={() => {
                startTransition(() => setChartType("ping"));
              }}
            >
              Ping
            </button>
          )}
        </div>
        {chartType === "load" && (
          <RangeSelector
            ranges={loadRanges}
            value={loadHours}
            onChange={(value) => startTransition(() => setLoadHours(value))}
          />
        )}
        {chartType === "ping" && showPingChart && (
          <RangeSelector
            ranges={pingRanges}
            value={pingHours}
            onChange={(value) => startTransition(() => setPingHours(value))}
          />
        )}
      </div>
      <div className="instance-chart-stage">
        <div
          className="instance-chart-view"
          hidden={chartType !== "load"}
          aria-hidden={chartType !== "load"}
        >
          <LoadChart uuid={uuid} hours={loadHours} active={chartType === "load"} />
        </div>
        <div
          className="instance-chart-view"
          hidden={chartType !== "ping"}
          aria-hidden={chartType !== "ping"}
        >
          {showPingChart ? (
            <PingChart
              uuid={uuid}
              hours={pingHours}
              active={chartType === "ping"}
            />
          ) : null}
        </div>
      </div>
      <FamilyPathPanel id={uuid} />
    </div>
  );
}
