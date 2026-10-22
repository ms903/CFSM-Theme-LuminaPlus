// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyPathProvider, useFamilyPaths } from "../FamilyPathProvider";
import { FamilyPathSummary, availableFamilies, bandwidthOld, latencyText } from "../FamilyPathSummary";
import { formatMbps, pathChartPoints, type FamilyPath } from "@/services/familyPath";

const mocks = vi.hoisted(() => ({ get: vi.fn(), trigger: vi.fn(), bases: vi.fn(), owner: vi.fn() }));
vi.mock("@/services/familyPath", async importOriginal => ({ ...await importOriginal<typeof import("@/services/familyPath")>(), getFamilyPaths: mocks.get, triggerFamilyTest: mocks.trigger }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ data: { logged_in: true } }) }));
vi.mock("@/hooks/useNode", () => ({ useNodeMeta: () => ({ name: "Node A", ipv4: "192.0.2.1", ipv6: "2001:db8::1" }) }));
vi.mock("@/services/cfsm/config", () => ({ getApiBases: mocks.bases }));
vi.mock("@/services/api", () => ({ getServerApiBase: mocks.owner, ApiRequestError: class extends Error {} }));
const now = Date.now();
const path: FamilyPath = {
  server_id: "a", server_name: "Node A", family: "ipv4", ip_address: "192.0.2.1",
  latency_status: "ok", latency_at: now, rtt_median_ms: 22, rtt_p95_ms: 24, loss_percent: 0, jitter_ms: 1, latency_error: "",
  bandwidth_status: "ok", bandwidth_at: now, bandwidth_requested_at: 0, bandwidth_started_at: 0,
  vps_to_home_mbps: 123.45, home_to_vps_mbps: 67.89, bandwidth_error: "", sparkline: [],
};
let root: Root; let container: HTMLDivElement; let client: QueryClient;
let context: ReturnType<typeof useFamilyPaths>;
function Observer() { context = useFamilyPaths(); return null; }
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(10); }); }
async function mount() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null,
    createElement(FamilyPathProvider, null, createElement(Observer), createElement(FamilyPathSummary, { id: "a" }), createElement(FamilyPathSummary, { id: "a", density: "compact" }))))));
  await flush();
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mocks.get.mockReset().mockImplementation(async () => ({ can_trigger: true, bandwidth_interval_hours: 6, paths: [{ ...path }] }));
  mocks.trigger.mockReset();
  mocks.bases.mockReset().mockReturnValue(["https://a.test"]);
  mocks.owner.mockReset().mockReturnValue("https://a.test");
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.useRealTimers(); });

describe("native family-path integration", () => {
  it("shares a single batch between cards and shows a configured family awaiting its first sample", async () => {
    await mount();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0].slice(0, 2)).toEqual(["https://a.test", true]);
    expect(container.querySelectorAll('[data-family="ipv6"]')).toHaveLength(2);
    expect(container.querySelector('[data-family="ipv6"]')?.textContent).toContain("待采集");
    expect(container.querySelector('[data-family="ipv6"] a')?.getAttribute("href")).toContain("family=ipv6");
    expect(container.textContent).toContain("123");
  });
  it("polls idle data at 60 seconds without reloading history, and stops when hidden", async () => {
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get.mock.calls[1][1]).toBe(false);
    await act(async () => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it("deduplicates a pending submission and synchronizes queued state across consumers", async () => {
    await mount();
    let resolve!: (value: { requested_at: number; queued: number; success: boolean }) => void;
    mocks.trigger.mockImplementation(() => new Promise(r => { resolve = r; }));
    await act(async () => { void context.trigger("https://a.test", "a", "ipv4"); void context.trigger("https://a.test", "a", "ipv4"); });
    expect(mocks.trigger).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
    mocks.get.mockResolvedValue({ can_trigger: true, bandwidth_interval_hours: 6, paths: [{ ...path, bandwidth_status: "queued" }] });
    await act(async () => resolve({ requested_at: now, queued: 1, success: true })); await flush();
    expect(container.textContent?.match(/排队中/g)?.length).toBeGreaterThanOrEqual(2);
    const calls = mocks.get.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(mocks.get.mock.calls.length).toBe(calls + 1);
  });
  it("routes a multi-backend card to its owning site and obeys can_trigger", async () => {
    mocks.bases.mockReturnValue(["https://a.test", "https://b.test"]);
    mocks.owner.mockReturnValue("https://b.test");
    mocks.get.mockImplementation(async (base: string) => ({ can_trigger: base !== "https://b.test", bandwidth_interval_hours: 6, paths: [{ ...path, vps_to_home_mbps: base === "https://b.test" ? 88 : 11 }] }));
    await mount();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("88.0");
    expect(container.textContent).not.toContain("11.0");
    expect([...container.querySelectorAll("button")].every(b => b.disabled)).toBe(true);
  });
  it("refreshes sparkline on a failed result discovered after returning to the page", async () => {
    await mount();
    mocks.get.mockResolvedValue({ can_trigger: true, bandwidth_interval_hours: 6, paths: [{ ...path, bandwidth_status: "error", bandwidth_started_at: now + 1, bandwidth_error: "timeout" }] });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.get.mock.calls.at(-1)?.[1]).toBe(true);
  });
  it("keeps successful speed after failure, but never presents failed latency as a fresh success", () => {
    const failed = { ...path, bandwidth_status: "error", latency_status: "error" };
    expect(bandwidthOld(failed, now)).toBe(true);
    expect(formatMbps(failed.vps_to_home_mbps)).toBe("123");
    expect(latencyText(failed)).toBe("超时 / 不可达");
    expect(formatMbps(null)).toBe("—");
    expect(availableFamilies([path], { ipv4: "192.0.2.1", ipv6: "" })).toEqual(["ipv4"]);
  });
  it("keeps IPv4 and IPv6 failures as null gaps, including a missed scheduled window", () => {
    const point = (at: number, status = "ok") => ({ observed_at: at, status, vps_to_home_mbps: status === "ok" ? 10 : 0, home_to_vps_mbps: status === "ok" ? 20 : 0 });
    const points = pathChartPoints([point(2), point(1), point(3, "error"), point(13 * 3_600_000)]);
    expect(points.map(p => p.observed_at)).toEqual([1, 2, 3, 3 + 6 * 3_600_000, 13 * 3_600_000]);
    expect(points[2].vps_to_home_mbps).toBeNull(); expect(points[2].home_to_vps_mbps).toBeNull();
    expect(points[3].status).toBe("missing"); expect(points[3].vps_to_home_mbps).toBeNull();
  });
});
