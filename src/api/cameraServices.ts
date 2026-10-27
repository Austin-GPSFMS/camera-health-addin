/**
 * Geotab Camera-Services (media-services.geotab.com) client — DeviceMappings only.
 *
 * Auth is the MyGeotab session: four X-MyGeotab-* headers, no token. Classic
 * MyGeotab add-ins are injected into the my.geotab.com page, so these calls
 * are same-origin with the built-in Cameras view and pass CORS. From a
 * localhost dev server they will be blocked — use the standalone demo there.
 *
 * `GET /DeviceMappings` (role: ListAssets) returns one DeviceMappingResponse
 * per camera pairing across every partner (Surfsight, SmarterAI/GO Focus,
 * Sensata) with `partnerDeviceLastOnlineAt`, `deviceStatus` and the
 * health-error list — everything this dashboard needs in one call. The
 * response shape is handled defensively (array vs {items|data|results}) and
 * the raw first record is kept for the debug panel so the field names can be
 * confirmed on the first live run.
 */

import type { CameraMapping, GeotabSession } from "../types";

export const CAMERA_SERVICES_BASE = "https://media-services.geotab.com";

export interface CameraServicesDebug {
  url: string;
  status: number | null;
  count: number;
  sample: unknown;
  error: string | null;
  tookMs: number;
}

export function sessionHeaders(session: GeotabSession): Record<string, string> {
  const host = String(session.server || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "") || window.location.host;
  return {
    "X-MyGeotab-Database": session.database,
    "X-MyGeotab-Path": host,
    "X-MyGeotab-SessionId": session.sessionId,
    "X-MyGeotab-Username": session.userName,
    Accept: "application/json",
  };
}

function unwrap(d: unknown): unknown[] {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== "object") return [];
  const o = d as Record<string, unknown>;
  for (const k of ["items", "data", "results", "deviceMappings", "mappings", "value"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [d];
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
}

/** ISO string from an ISO string or a unix-ms number (SmarterAI style). */
function toIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(v);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeMapping(raw: unknown): CameraMapping | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const partnerDeviceId = str(pick(o, "partnerDeviceId", "cameraId", "serialNumber"));
  if (!partnerDeviceId) return null;
  const errs = pick(o, "partnerDeviceHealthErrors", "healthErrors");
  return {
    mappingId: str(pick(o, "deviceMappingId", "id", "mappingId")) ?? partnerDeviceId,
    partnerDeviceId,
    goSerial: str(pick(o, "associatedDeviceSerialNumber", "goDeviceSerialNumber", "deviceSerialNumber")) ?? "",
    partnerId: (str(pick(o, "partnerId", "partner")) ?? "").toLowerCase(),
    isOnboarded: typeof o.isOnboarded === "boolean" ? o.isOnboarded : null,
    deviceStatus: str(pick(o, "deviceStatus", "status")),
    deviceStatusLastUpdatedAt: toIso(pick(o, "deviceStatusLastUpdatedAt")),
    lastOnlineAt: toIso(pick(o, "partnerDeviceLastOnlineAt", "lastOnlineAt", "lastOnlineTime", "lastConnectedAt")),
    healthStatus: str(pick(o, "partnerDeviceHealthStatus", "healthStatus")),
    healthErrors: Array.isArray(errs) ? errs.map((e) => String(e)) : [],
    healthLastUpdated: toIso(pick(o, "partnerDeviceHealthLastUpdated", "healthLastUpdated")),
  };
}

export class CameraServicesError extends Error {
  constructor(message: string, public status: number | null) {
    super(message);
    this.name = "CameraServicesError";
  }
}

export async function fetchDeviceMappings(
  session: GeotabSession
): Promise<{ mappings: CameraMapping[]; debug: CameraServicesDebug }> {
  const url = `${CAMERA_SERVICES_BASE}/DeviceMappings`;
  const t0 = performance.now();
  const debug: CameraServicesDebug = { url, status: null, count: 0, sample: null, error: null, tookMs: 0 };
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: sessionHeaders(session), credentials: "omit" });
  } catch (e) {
    debug.tookMs = performance.now() - t0;
    debug.error = `media-services unreachable (${(e as Error).message}). If this is a localhost dev host it is CORS — load the add-in inside MyGeotab.`;
    throw new CameraServicesError(debug.error, null);
  }
  debug.status = res.status;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  debug.tookMs = performance.now() - t0;
  if (!res.ok) {
    const errs = data && typeof data === "object" && Array.isArray((data as { errors?: unknown }).errors)
      ? ` — ${((data as { errors: unknown[] }).errors).join("; ")}`
      : "";
    debug.error =
      res.status === 401
        ? "media-services returned 401 — the MyGeotab session was not accepted (expired, or headers incomplete). Refresh the page."
        : res.status === 403
          ? "media-services returned 403 — this user lacks the ListAssets camera role."
          : `media-services returned ${res.status}${errs}`;
    throw new CameraServicesError(debug.error, res.status);
  }
  const list = unwrap(data);
  debug.sample = list[0] ?? data;
  const mappings = list.map(normalizeMapping).filter((m): m is CameraMapping => m != null);
  debug.count = mappings.length;
  return { mappings, debug };
}
