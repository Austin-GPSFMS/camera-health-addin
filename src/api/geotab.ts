/**
 * Promise-based wrappers around the MyGeotab Add-In `api.call` interface,
 * plus the AddInData store for shared snoozes and settings.
 *
 * Mirrors recall-harness-swap-addin / vehicle-replacement-planner-addin:
 * every call goes through `apiCall` so there is one place to pace requests
 * and surface typed errors. The page makes a handful of calls per load
 * (Device, DeviceStatusInfo, Group, AddInData) — well inside the quota.
 */

import type {
  GeotabAddInData,
  GeotabApi,
  GeotabDevice,
  GeotabDeviceStatusInfo,
  GeotabGroup,
  GeotabPageState,
  GeotabSession,
  GeotabUser,
  Settings,
  SettingsRecord,
  SnoozeRecord,
  UserDefaultRecord,
  VehicleInfo,
} from "../types";
import { clampSettings } from "../utils/health";

const INTER_CALL_DELAY_MS = 40;
const RESULTS_LIMIT = 50000;

/**
 * Fixed add-in id for this add-in's AddInData records — an encoded GUID in
 * the Geotab "a" + base64url format (like the SDK sample a2C4ABQuLFkepPVf6-4OKAQ).
 * Unique to Vehicle & Camera Health; do not reuse across add-ins.
 */
export const ADDIN_DATA_ID = "aFSRQx5srR4q-Dd-Ptv1cZg";

const DEVICE_FIELDS = [
  "id",
  "name",
  "serialNumber",
  "deviceType",
  "activeFrom",
  "activeTo",
  "groups",
  "vehicleIdentificationNumber",
];

// ---------------------------------------------------------------------------
// Low-level call helpers
// ---------------------------------------------------------------------------

export function apiCall<T = unknown>(api: GeotabApi, method: string, params: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      api.call(
        method,
        params,
        (result) => setTimeout(() => resolve(result as T), INTER_CALL_DELAY_MS),
        (err) => reject(err)
      );
    } catch (err) {
      reject(err);
    }
  });
}

export function apiMultiCall<T = unknown>(api: GeotabApi, calls: Array<[string, unknown]>): Promise<T[]> {
  if (typeof api.multiCall !== "function") {
    return calls.reduce<Promise<T[]>>(
      (p, c) => p.then((acc) => apiCall<T>(api, c[0], c[1]).then((r) => [...acc, r])),
      Promise.resolve([])
    );
  }
  return new Promise((resolve, reject) => {
    try {
      api.multiCall!(
        calls,
        (result) => setTimeout(() => resolve(result as T[]), INTER_CALL_DELAY_MS),
        (err) => reject(err)
      );
    } catch (err) {
      reject(err);
    }
  });
}

export function friendlyError(err: unknown): string {
  if (err == null) return "Unknown error.";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as { name?: string; message?: string };
    if (e.name === "InvalidUserException" || /InvalidUser/i.test(String(err))) {
      return "Session expired — refresh the MyGeotab page to re-authenticate.";
    }
    if (/quota/i.test(e.message ?? "")) {
      return `${e.message} — wait a minute and try again.`;
    }
    if (/PermissionException|not have permission|SecurityClearance/i.test(`${e.name} ${e.message}`)) {
      return `${e.message ?? "Permission denied"} — this user's security clearance doesn't allow that.`;
    }
    if (e.message) return e.message;
  }
  return String(err);
}

export function fetchSession(api: GeotabApi): Promise<GeotabSession | null> {
  return new Promise((resolve) => {
    if (typeof api.getSession !== "function") {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (s: GeotabSession | null) => {
      if (settled) return;
      settled = true;
      resolve(s);
    };
    setTimeout(() => done(null), 3000);
    try {
      api.getSession((credentials, server) => {
        if (!credentials?.sessionId) {
          done(null);
          return;
        }
        done({
          server: server || credentials.path || "my.geotab.com",
          database: credentials.database,
          userName: credentials.userName,
          sessionId: credentials.sessionId,
        });
      });
    } catch {
      done(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export async function fetchGroups(api: GeotabApi): Promise<Map<string, GeotabGroup>> {
  const groups = await apiCall<GeotabGroup[]>(api, "Get", { typeName: "Group", resultsLimit: 10000 });
  return new Map(groups.map((g) => [g.id, g]));
}

/**
 * Every device (active AND archived) so an orphan camera can be labelled
 * "paired to archived vehicle X" instead of "unknown GO". The rules treat
 * activeTo < now as archived.
 */
export async function fetchAllDevices(api: GeotabApi): Promise<GeotabDevice[]> {
  let devices: GeotabDevice[];
  try {
    devices = await apiCall<GeotabDevice[]>(api, "Get", {
      typeName: "Device",
      resultsLimit: RESULTS_LIMIT,
      propertySelector: { fields: DEVICE_FIELDS, isIncluded: true },
    });
  } catch {
    // Older databases reject propertySelector — fall back to the full entity.
    devices = await apiCall<GeotabDevice[]>(api, "Get", { typeName: "Device", resultsLimit: RESULTS_LIMIT });
  }
  return devices.filter((d) => d.id !== "NoDeviceId");
}

export async function fetchDeviceStatus(api: GeotabApi): Promise<Map<string, GeotabDeviceStatusInfo>> {
  const rows = await apiCall<GeotabDeviceStatusInfo[]>(api, "Get", {
    typeName: "DeviceStatusInfo",
    resultsLimit: RESULTS_LIMIT,
  });
  const out = new Map<string, GeotabDeviceStatusInfo>();
  for (const r of rows) if (r.device?.id) out.set(r.device.id, r);
  return out;
}

/**
 * Untracked assets (MyGeotab "Untracked asset" = Device with deviceType
 * "None" and no hardware) and any device without a serial number can never
 * report or carry a camera pairing, so they are dropped before the join —
 * otherwise each would be a permanent "No camera / GO never" row.
 */
export function isTrackableDevice(d: GeotabDevice): boolean {
  if ((d.deviceType ?? "").toLowerCase() === "none") return false;
  const serial = (d.serialNumber ?? "").trim();
  return serial.length > 0 && !/^0+$/.test(serial);
}

/**
 * Only Geotab GO vehicle devices (GO4 … GO9 / GO9B — DeviceType "GOn…")
 * can carry a camera pairing. Third-party devices (CustomDevice /
 * CustomVehicleDevice, serials like CNB…), GO Anywhere / Gemini asset
 * trackers and GoDrive phones are still joined (a camera mapped to one
 * still shows), but they never become a "No camera paired" row.
 * A device with no deviceType falls back to the GO serial prefix ("G").
 */
export function isCameraCapableGo(d: Pick<GeotabDevice, "deviceType" | "serialNumber">): boolean {
  const type = (d.deviceType ?? "").trim();
  if (type) return /^GO\d/i.test(type);
  return /^G/i.test((d.serialNumber ?? "").trim());
}

export interface VehicleJoin {
  vehicles: VehicleInfo[];
  /** Devices dropped as untracked / serial-less. */
  excluded: number;
}

/** Join Device + DeviceStatusInfo + Group names into the rules' VehicleInfo. */
export function toVehicleInfo(
  devices: GeotabDevice[],
  status: Map<string, GeotabDeviceStatusInfo>,
  groups: Map<string, GeotabGroup>,
  now: Date
): VehicleJoin {
  const nowT = now.getTime();
  const trackable = devices.filter(isTrackableDevice);
  const vehicles = trackable.map((d) => {
    const st = status.get(d.id);
    const activeTo = d.activeTo ? new Date(d.activeTo).getTime() : Number.POSITIVE_INFINITY;
    const groupIds = (d.groups ?? []).map((g) => g.id);
    return {
      id: d.id,
      name: d.name?.trim() || d.serialNumber || d.id,
      serialNumber: (d.serialNumber ?? "").trim(),
      groupIds,
      groupNames: groupIds.map((id) => groups.get(id)?.name ?? "").filter(Boolean),
      vin: d.vehicleIdentificationNumber ?? "",
      deviceType: (d.deviceType ?? "").trim(),
      cameraCapable: isCameraCapableGo(d),
      archived: Number.isFinite(activeTo) && activeTo < nowT,
      lastComm: st?.dateTime ?? null,
      isCommunicating: st?.isDeviceCommunicating ?? null,
    };
  });
  return { vehicles, excluded: devices.length - trackable.length };
}

// ---------------------------------------------------------------------------
// AddInData — shared snoozes + settings. One record per snooze (details.kind
// = "snooze") and one settings record (details.kind = "settings").
// ---------------------------------------------------------------------------

export interface StoreContents {
  snoozes: SnoozeRecord[];
  settings: SettingsRecord | null;
  userDefaults: UserDefaultRecord[];
}

function parseDetails(r: GeotabAddInData): Record<string, unknown> | null {
  try {
    const d = typeof r.details === "string" ? (JSON.parse(r.details) as unknown) : r.details;
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function fetchStore(api: GeotabApi): Promise<StoreContents> {
  const rows = await apiCall<GeotabAddInData[]>(api, "Get", {
    typeName: "AddInData",
    search: { addInId: ADDIN_DATA_ID },
    resultsLimit: 10000,
  });
  return parseStoreRows(rows);
}

/** Turn raw AddInData rows (from Get or a multiCall) into snoozes + the newest settings record. */
export function parseStoreRows(rows: GeotabAddInData[]): StoreContents {
  const snoozes: SnoozeRecord[] = [];
  const userDefaults: UserDefaultRecord[] = [];
  let settings: SettingsRecord | null = null;
  for (const r of rows) {
    const d = parseDetails(r);
    if (!d) continue;
    if (d.kind === "snooze" && typeof d.key === "string" && typeof d.until === "string") {
      snoozes.push({
        id: r.id,
        kind: "snooze",
        key: d.key,
        label: typeof d.label === "string" ? d.label : "",
        reason: (typeof d.reason === "string" ? d.reason : "other") as SnoozeRecord["reason"],
        note: typeof d.note === "string" ? d.note : "",
        by: typeof d.by === "string" ? d.by : "",
        at: typeof d.at === "string" ? d.at : "",
        until: d.until,
      });
    } else if (d.kind === "settings") {
      const rec: SettingsRecord = {
        id: r.id,
        kind: "settings",
        by: typeof d.by === "string" ? d.by : "",
        at: typeof d.at === "string" ? d.at : "",
        ...clampSettings(d as Partial<Settings>),
      };
      // Keep the newest if several exist.
      if (!settings || rec.at > settings.at) settings = rec;
    } else if (d.kind === "userDefault" && typeof d.userName === "string") {
      userDefaults.push({
        id: r.id,
        kind: "userDefault",
        userName: d.userName.trim().toLowerCase(),
        groupIds: Array.isArray(d.groupIds) ? d.groupIds.map(String) : [],
        partner: typeof d.partner === "string" && d.partner ? d.partner : undefined,
        view: typeof d.view === "string" && d.view ? d.view : undefined,
        by: typeof d.by === "string" ? d.by : "",
        at: typeof d.at === "string" ? d.at : "",
      });
    }
  }
  return { snoozes, settings, userDefaults };
}

export async function addUserDefault(api: GeotabApi, rec: UserDefaultRecord): Promise<string> {
  const { id: _id, ...details } = rec;
  const entity: GeotabAddInData = { addInId: ADDIN_DATA_ID, details, groups: [{ id: "GroupCompanyId" }] };
  return apiCall<string>(api, "Add", { typeName: "AddInData", entity });
}

/**
 * Users for the Settings → User defaults picker. Drivers are kept (a site
 * lead is often flagged as a driver too) but sorted after plain users.
 */
export async function fetchUsers(api: GeotabApi): Promise<GeotabUser[]> {
  let users: GeotabUser[];
  try {
    users = await apiCall<GeotabUser[]>(api, "Get", {
      typeName: "User",
      resultsLimit: 10000,
      propertySelector: { fields: ["id", "name", "firstName", "lastName", "isDriver", "companyGroups"], isIncluded: true },
    });
  } catch {
    users = await apiCall<GeotabUser[]>(api, "Get", { typeName: "User", resultsLimit: 10000 });
  }
  return users
    .filter((u) => typeof u.name === "string" && u.name.trim())
    .sort((a, b) => Number(!!a.isDriver) - Number(!!b.isDriver) || a.name.localeCompare(b.name));
}

/** MyGeotab's header group filter, whatever shape this build returns it in (sync or callback). */
export function readPageGroupFilter(state: GeotabPageState | null): Promise<unknown> {
  return new Promise((resolve) => {
    if (!state || typeof state.getGroupFilter !== "function") {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (v: unknown) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    setTimeout(() => done(null), 1500);
    try {
      const sync = state.getGroupFilter((v: unknown) => done(v));
      if (sync !== undefined) done(sync);
    } catch {
      done(null);
    }
  });
}

export async function addSnooze(api: GeotabApi, rec: SnoozeRecord): Promise<string> {
  const { id: _id, ...details } = rec;
  const entity: GeotabAddInData = { addInId: ADDIN_DATA_ID, details, groups: [{ id: "GroupCompanyId" }] };
  return apiCall<string>(api, "Add", { typeName: "AddInData", entity });
}

export async function removeAddInData(api: GeotabApi, id: string): Promise<void> {
  await apiCall(api, "Remove", { typeName: "AddInData", entity: { id, addInId: ADDIN_DATA_ID } });
}

export async function saveSettings(api: GeotabApi, rec: SettingsRecord): Promise<string> {
  const { id, ...details } = rec;
  const entity: GeotabAddInData = { addInId: ADDIN_DATA_ID, details, groups: [{ id: "GroupCompanyId" }] };
  if (id) {
    await apiCall(api, "Set", { typeName: "AddInData", entity: { ...entity, id } });
    return id;
  }
  return apiCall<string>(api, "Add", { typeName: "AddInData", entity });
}
