import { z } from "zod";
import { cfsmGet, cfsmPost, type RequestOptions } from "./cfsm/http";

export const IP_FAMILIES = ["ipv4", "ipv6"] as const;
export type IpFamily = typeof IP_FAMILIES[number];
const rate = z.number().nullable();
export const PathPointSchema = z.object({
  observed_at: z.number(), vps_to_home_mbps: rate, home_to_vps_mbps: rate,
  status: z.string(), error: z.string().optional(),
});
export type PathPoint = z.infer<typeof PathPointSchema>;
export const FamilyPathSchema = z.object({
  server_id: z.string(), server_name: z.string(), family: z.enum(IP_FAMILIES), ip_address: z.string(),
  latency_status: z.string(), latency_at: z.number(), rtt_median_ms: rate, rtt_p95_ms: rate,
  loss_percent: rate, jitter_ms: rate, latency_error: z.string(),
  bandwidth_status: z.string(), bandwidth_requested_at: z.number(), bandwidth_started_at: z.number(),
  bandwidth_at: z.number(), vps_to_home_mbps: rate, home_to_vps_mbps: rate, bandwidth_error: z.string(),
  sparkline: z.array(PathPointSchema).optional(),
});
export type FamilyPath = z.infer<typeof FamilyPathSchema>;
export const FamilySnapshotSchema = z.object({
  can_trigger: z.boolean(), bandwidth_interval_hours: z.number(), paths: z.array(FamilyPathSchema),
});
export type FamilySnapshot = z.infer<typeof FamilySnapshotSchema>;
export type FamilySite = FamilySnapshot & { base: string; sparklineAt: number; error?: string; unsupported?: boolean };
export function getFamilyPaths(base: string, withHistory: boolean, signal?: AbortSignal) {
  return cfsmGet(`/api/family-path${withHistory ? "?include_sparkline=1" : ""}`, FamilySnapshotSchema, { base, signal });
}
export function getFamilyHistory(serverId: string, family: IpFamily, hours: number, options: RequestOptions) {
  return cfsmGet(`/api/family-path/history?server_id=${encodeURIComponent(serverId)}&family=${family}&hours=${hours}`,
    z.object({ points: z.array(PathPointSchema) }), options);
}
export function triggerFamilyTest(base: string, serverId?: string, family?: IpFamily) {
  return cfsmPost("/api/family-path/trigger", { server_id: serverId, family },
    z.object({ success: z.boolean(), requested_at: z.number(), queued: z.number() }), { base });
}
export const pathKey = (base: string, id: string, family?: IpFamily) => JSON.stringify([base, id, family ?? "all"]);
export const isPathActive = (path: FamilyPath) => ["queued", "testing"].includes(path.bandwidth_status);
export function formatMbps(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 0.01) return "<0.01";
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
}
/** Real samples only; explicit failures and missed (>2 scheduled intervals) tests break both lines. */
export function pathChartPoints(points: PathPoint[]): PathPoint[] {
  const result: PathPoint[] = [];
  for (const point of [...points].sort((a, b) => a.observed_at - b.observed_at)) {
    const previous = result.at(-1);
    if (previous && point.observed_at - previous.observed_at > 12 * 3_600_000) {
      result.push({ observed_at: previous.observed_at + 6 * 3_600_000, status: "missing", vps_to_home_mbps: null, home_to_vps_mbps: null });
    }
    result.push(point.status === "ok" ? point : { ...point, vps_to_home_mbps: null, home_to_vps_mbps: null });
  }
  return result;
}
