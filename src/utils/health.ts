/**
 * Pure health rules — no DOM, no API. Exercised by test/run.mjs.
 *
 * Inputs: MyGeotab vehicles (+ GO last communication) and camera-services
 * device mappings (+ camera last online). Output: one HealthRow per vehicle
 * or orphan camera, diagnosed against the settings and the snooze list.
 *
 * Visibility rule (the "snooze" feature):
 *   • A row is an ISSUE when the camera or the GO has been offline for at
 *     least `viewThresholdDays`, when a camera has no GO, or (optionally)
 *     when a vehicle has no camera.
 *   • A snooze hides an issue row until `until` passes…
 *   • …unless either device has been offline for `hardLimitDays` or more —
 *     then the snooze is OVERRIDDEN and the row shows anyway. A spare that is
 *     sitting is expected to go quiet; one that has been dark for six weeks
 *     is something to go look at. A device that has NEVER reported has no
 *     measurable duration, so it honours its snooze until it expires.
 *   • Snoozing is keyed to the vehicle (GO device id), so one snooze covers
 *     both devices on that truck. Orphan cameras are keyed by camera id.
 */

import type {
  CameraMapping,
  Diagnosis,
  HealthRow,
  Settings,
  SnoozeRecord,
  SnoozeState,
  VehicleInfo,
} from "../types";

export const DEFAULT_SETTINGS: Settings = {
  viewThresholdDays: 14,
  hardLimitDays: 45,
  goActiveHours: 24,
  noCameraIsIssue: false,
};

export const SNOOZE_PRESET_DAYS = [7, 14, 30] as const;

export const DIAGNOSIS_LABEL: Record<Diagnosis, string> = {
  camera: "Camera issue",
  go: "GO issue",
  both: "Both silent",
  "no-go": "No GO paired",
  "no-camera": "No camera paired",
  ok: "OK",
};

export const DIAGNOSIS_HINT: Record<Diagnosis, string> = {
  camera: "Camera silent past the threshold while the GO device is still reporting — check camera power, SIM, mount or SD card.",
  go: "GO device silent past the threshold while the camera is still reporting — check the GO install / harness.",
  both: "Neither device has reported — usually a parked, powered-down or battery-cutoff vehicle, not a hardware fault.",
  "no-go": "Camera pairing exists in camera-services but no active GO device matches its serial — swapped or retired unit, re-pair it.",
  "no-camera": "Active vehicle with no camera pairing in camera-services.",
  ok: "Both devices reported within the threshold.",
};

export const DIAGNOSIS_ORDER: Record<Diagnosis, number> = {
  camera: 0,
  go: 1,
  both: 2,
  "no-go": 3,
  "no-camera": 4,
  ok: 5,
};

export const SNOOZE_REASON_LABEL: Record<SnoozeRecord["reason"], string> = {
  spare: "Spare",
  "battery-cutoff": "Battery cutoff",
  "in-shop": "In shop",
  seasonal: "Seasonal / parked",
  other: "Other",
};

export function vehicleKey(deviceId: string): string {
  return `go:${deviceId}`;
}
export function cameraKey(partnerDeviceId: string): string {
  return `cam:${partnerDeviceId}`;
}

/** Days between an ISO timestamp and `now`; Infinity when missing/unparseable (never reported). */
export function daysSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - t) / 86_400_000);
}

/** Site/district group: Waste Pro-style "912 - Citrus County Landfill L011"
 *  (numeric division code + name). Falls back to "—" so other databases simply
 *  get a single bucket. Same rule as the VisionTrack Watchdog. */
const SITE_RE = /^\d{2,4}\s*[-–]\s*\S/;
export const NO_SITE = "—";
export function siteOf(groupNames: string[]): string {
  return groupNames.find((n) => SITE_RE.test(n.trim())) ?? NO_SITE;
}

export function normalizePartner(p: string | null | undefined): string | null {
  if (!p) return null;
  const s = String(p).trim().toLowerCase();
  return s || null;
}

export const PARTNER_LABEL: Record<string, string> = {
  surfsight: "Surfsight",
  smarterai: "GO Focus",
  sensata: "Sensata",
};
export function partnerLabel(p: string | null): string {
  if (!p) return "—";
  return PARTNER_LABEL[p] ?? p;
}

function diagnose(
  cameraDays: number | null,
  goDays: number | null,
  thresholdDays: number
): Diagnosis {
  if (cameraDays == null && goDays == null) return "ok"; // cannot happen, defensive
  if (cameraDays == null) return "no-camera";
  if (goDays == null) return "no-go";
  const camStale = cameraDays >= thresholdDays;
  const goStale = goDays >= thresholdDays;
  if (camStale && goStale) return "both";
  if (camStale) return "camera";
  if (goStale) return "go";
  return "ok";
}

function evalSnooze(
  snooze: SnoozeRecord | null,
  cameraDays: number | null,
  goDays: number | null,
  settings: Settings,
  now: Date
): { state: SnoozeState; hidden: boolean } {
  if (!snooze) return { state: "none", hidden: false };
  const untilT = new Date(snooze.until).getTime();
  if (Number.isNaN(untilT) || untilT <= now.getTime()) return { state: "expired", hidden: false };
  // Only a KNOWN offline duration can trip the hard limit. "Never reported"
  // (Infinity) has no start date — a brand-new or shelved camera — so it
  // honours its snooze until expiry instead of punching through immediately.
  const past = (d: number | null) => d != null && Number.isFinite(d) && d >= settings.hardLimitDays;
  const pastLimit = past(cameraDays) || past(goDays);
  if (pastLimit) return { state: "overridden", hidden: false };
  return { state: "active", hidden: true };
}

export interface BuildInput {
  vehicles: VehicleInfo[];
  mappings: CameraMapping[];
  snoozes: SnoozeRecord[];
  settings: Settings;
  now: Date;
}

/** Build every row: one per active vehicle (with or without a camera) plus one per orphan camera. */
export function buildRows({ vehicles, mappings, snoozes, settings, now }: BuildInput): HealthRow[] {
  const bySerial = new Map<string, VehicleInfo>();
  for (const v of vehicles) {
    const s = v.serialNumber.trim().toUpperCase();
    if (!s) continue;
    // Prefer an active device when a serial appears on both an archived and a live record.
    const existing = bySerial.get(s);
    if (!existing || (existing.archived && !v.archived)) bySerial.set(s, v);
  }
  const snoozeByKey = new Map<string, SnoozeRecord>();
  for (const s of snoozes) {
    // Keep the latest snooze per key if duplicates slipped in.
    const prev = snoozeByKey.get(s.key);
    if (!prev || s.at > prev.at) snoozeByKey.set(s.key, s);
  }

  const rows: HealthRow[] = [];
  const pairedVehicleIds = new Set<string>();

  const push = (partial: Omit<HealthRow, "worstOfflineDays" | "goActive" | "diagnosis" | "isIssue" | "snooze" | "snoozeState" | "hiddenBySnooze">) => {
    const cam = partial.cameraOfflineDays;
    const go = partial.goOfflineDays;
    const worst = Math.max(cam ?? Number.NEGATIVE_INFINITY, go ?? Number.NEGATIVE_INFINITY);
    const diagnosis = diagnose(cam, go, settings.viewThresholdDays);
    const isIssue = diagnosis === "no-camera" ? settings.noCameraIsIssue : diagnosis !== "ok";
    const snooze = snoozeByKey.get(partial.key) ?? null;
    const { state, hidden } = evalSnooze(snooze, cam, go, settings, now);
    rows.push({
      ...partial,
      worstOfflineDays: Number.isFinite(worst) || worst === Number.POSITIVE_INFINITY ? worst : 0,
      goActive: go != null && go * 24 < settings.goActiveHours,
      diagnosis,
      isIssue,
      snooze,
      snoozeState: state,
      hiddenBySnooze: isIssue && hidden,
    });
  };

  // 1. Camera mappings → vehicle rows (or orphan-camera rows).
  for (const m of mappings) {
    const serial = m.goSerial.trim().toUpperCase();
    const v = serial ? bySerial.get(serial) : undefined;
    const camDays = daysSince(m.lastOnlineAt, now);
    if (v && !v.archived) {
      pairedVehicleIds.add(v.id);
      push({
        key: vehicleKey(v.id),
        vehicleId: v.id,
        vehicleName: v.name,
        goSerial: v.serialNumber,
        groupIds: v.groupIds,
        groupNames: v.groupNames,
        site: siteOf(v.groupNames),
        vehicleArchived: false,
        cameraId: m.partnerDeviceId,
        partner: normalizePartner(m.partnerId),
        cameraStatus: m.deviceStatus,
        cameraHealthStatus: m.healthStatus,
        healthErrors: m.healthErrors,
        cameraLastOnline: m.lastOnlineAt,
        goLastComm: v.lastComm,
        cameraOfflineDays: camDays,
        goOfflineDays: daysSince(v.lastComm, now),
      });
    } else {
      // Orphan: no GO serial, serial not in this database, or paired to an archived unit.
      push({
        key: cameraKey(m.partnerDeviceId),
        vehicleId: v?.id ?? null,
        vehicleName: v ? `${v.name} (archived)` : serial ? `Unknown GO ${serial}` : "No GO on pairing",
        goSerial: serial || null,
        groupIds: v?.groupIds ?? [],
        groupNames: v?.groupNames ?? [],
        site: v ? siteOf(v.groupNames) : NO_SITE,
        vehicleArchived: !!v,
        cameraId: m.partnerDeviceId,
        partner: normalizePartner(m.partnerId),
        cameraStatus: m.deviceStatus,
        cameraHealthStatus: m.healthStatus,
        healthErrors: m.healthErrors,
        cameraLastOnline: m.lastOnlineAt,
        goLastComm: null,
        cameraOfflineDays: camDays,
        goOfflineDays: null,
      });
    }
  }

  // 2. Active vehicles with no camera pairing.
  for (const v of vehicles) {
    if (v.archived || pairedVehicleIds.has(v.id)) continue;
    push({
      key: vehicleKey(v.id),
      vehicleId: v.id,
      vehicleName: v.name,
      goSerial: v.serialNumber || null,
      groupIds: v.groupIds,
      groupNames: v.groupNames,
      site: siteOf(v.groupNames),
      vehicleArchived: false,
      cameraId: null,
      partner: null,
      cameraStatus: null,
      cameraHealthStatus: null,
      healthErrors: [],
      cameraLastOnline: null,
      goLastComm: v.lastComm,
      cameraOfflineDays: null,
      goOfflineDays: daysSince(v.lastComm, now),
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Filtering + sorting
// ---------------------------------------------------------------------------

export type ViewFilter = "issues" | "snoozed" | "all" | Diagnosis;

export function matchesView(r: HealthRow, view: ViewFilter): boolean {
  switch (view) {
    case "issues":
      return r.isIssue && !r.hiddenBySnooze;
    case "snoozed":
      return r.snoozeState === "active";
    case "all":
      return true;
    case "no-camera":
      return r.diagnosis === "no-camera";
    default:
      return r.diagnosis === view && !r.hiddenBySnooze;
  }
}

export function matchesPartner(r: HealthRow, partner: string): boolean {
  if (partner === "all") return true;
  if (partner === "none") return r.partner == null;
  return r.partner === partner;
}

export function matchesSearch(r: HealthRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    r.vehicleName.toLowerCase().includes(s) ||
    (r.goSerial ?? "").toLowerCase().includes(s) ||
    (r.cameraId ?? "").toLowerCase().includes(s) ||
    r.groupNames.some((g) => g.toLowerCase().includes(s)) ||
    r.healthErrors.some((e) => e.toLowerCase().includes(s))
  );
}

/** Expand selected group ids to include every descendant (so a parent selection matches child-group vehicles). */
export function expandGroupIds(
  selected: string[],
  groups: Map<string, { id: string; children?: Array<{ id: string }> }>
): Set<string> {
  const out = new Set<string>();
  const stack = [...selected];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    const g = groups.get(id);
    if (g?.children) for (const c of g.children) stack.push(c.id);
  }
  return out;
}

export function matchesGroups(r: HealthRow, expanded: Set<string> | null): boolean {
  if (!expanded || expanded.size === 0 || expanded.has("GroupCompanyId")) return true;
  // Orphan cameras with no vehicle have no groups: keep them visible under any filter
  // (they're a pairing problem, not a scoped asset).
  if (r.groupIds.length === 0) return r.vehicleId == null;
  return r.groupIds.some((g) => expanded.has(g));
}

export type SortCol = "offline" | "vehicle" | "site" | "camera" | "go" | "diagnosis" | "partner" | "snooze";
export interface SortState {
  col: SortCol;
  dir: 1 | -1;
}
export const DEFAULT_SORT: SortState = { col: "offline", dir: -1 }; // oldest offline first

function cmpNum(a: number | null, b: number | null): number {
  // null (no device) sinks below everything, including "never" (Infinity).
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function compareRows(a: HealthRow, b: HealthRow, sort: SortState): number {
  const byVehicle = () => a.vehicleName.localeCompare(b.vehicleName, undefined, { numeric: true });
  let c = 0;
  switch (sort.col) {
    case "offline":
      c = cmpNum(a.worstOfflineDays, b.worstOfflineDays);
      break;
    case "vehicle":
      c = byVehicle();
      break;
    case "site":
      if (a.site === NO_SITE && b.site !== NO_SITE) return 1;
      if (b.site === NO_SITE && a.site !== NO_SITE) return -1;
      c = a.site.localeCompare(b.site, undefined, { numeric: true });
      break;
    case "camera":
      c = cmpNum(a.cameraOfflineDays, b.cameraOfflineDays);
      break;
    case "go":
      c = cmpNum(a.goOfflineDays, b.goOfflineDays);
      break;
    case "diagnosis":
      c = DIAGNOSIS_ORDER[a.diagnosis] - DIAGNOSIS_ORDER[b.diagnosis];
      break;
    case "partner":
      c = (a.partner ?? "~").localeCompare(b.partner ?? "~");
      break;
    case "snooze":
      c = (a.snooze?.until ?? "~").localeCompare(b.snooze?.until ?? "~");
      break;
  }
  if (c === 0 && sort.col !== "vehicle") c = byVehicle();
  return c * sort.dir;
}

export interface Counts {
  issues: number;
  camera: number;
  go: number;
  both: number;
  noGo: number;
  noCamera: number;
  snoozed: number;
  overridden: number;
  ok: number;
  all: number;
}

export function countRows(rows: HealthRow[]): Counts {
  const c: Counts = { issues: 0, camera: 0, go: 0, both: 0, noGo: 0, noCamera: 0, snoozed: 0, overridden: 0, ok: 0, all: rows.length };
  for (const r of rows) {
    if (r.isIssue && !r.hiddenBySnooze) c.issues++;
    if (r.snoozeState === "active") c.snoozed++;
    if (r.snoozeState === "overridden") c.overridden++;
    if (r.hiddenBySnooze) continue;
    switch (r.diagnosis) {
      case "camera": c.camera++; break;
      case "go": c.go++; break;
      case "both": c.both++; break;
      case "no-go": c.noGo++; break;
      case "no-camera": c.noCamera++; break;
      case "ok": c.ok++; break;
    }
  }
  return c;
}

/** ISO expiry for a snooze of `days` from `now`. */
export function snoozeUntil(days: number, now: Date): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

export function clampSettings(s: Partial<Settings>): Settings {
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const viewThresholdDays = num(s.viewThresholdDays, DEFAULT_SETTINGS.viewThresholdDays, 0, 365);
  return {
    viewThresholdDays,
    hardLimitDays: Math.max(viewThresholdDays, num(s.hardLimitDays, DEFAULT_SETTINGS.hardLimitDays, 1, 730)),
    goActiveHours: num(s.goActiveHours, DEFAULT_SETTINGS.goActiveHours, 1, 24 * 30),
    noCameraIsIssue: typeof s.noCameraIsIssue === "boolean" ? s.noCameraIsIssue : DEFAULT_SETTINGS.noCameraIsIssue,
  };
}
