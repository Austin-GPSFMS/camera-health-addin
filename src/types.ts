/**
 * Domain types for Vehicle & Camera Health.
 *
 * The MyGeotab Add-In API is loosely typed; we narrow at the boundary in
 * api/geotab.ts and api/cameraServices.ts. Shapes mirror
 * vehicle-replacement-planner-addin/src/types.ts.
 */

// ---------------------------------------------------------------------------
// MyGeotab add-in API surface
// ---------------------------------------------------------------------------

export interface GeotabApi {
  call: (
    method: string,
    params: unknown,
    success: (result: unknown) => void,
    failure: (err: unknown) => void
  ) => void;
  multiCall?: (
    calls: Array<[string, unknown]>,
    success: (result: unknown[]) => void,
    failure: (err: unknown) => void
  ) => void;
  getSession?: (
    callback: (
      credentials: { database: string; userName: string; sessionId: string; path?: string },
      server: string
    ) => void
  ) => void;
}

export interface GeotabSession {
  server: string;
  database: string;
  userName: string;
  sessionId: string;
}

export interface GeotabPageState {
  getGroupFilter?: (cb: (groups: unknown) => void) => void;
  setGroupFilter?: (groups: unknown) => void;
  getState?: (cb: (state: unknown) => void) => void;
  setState?: (state: unknown) => void;
  translate?: (key: string) => string;
}

export interface GeotabGroup {
  id: string;
  name?: string;
  children?: Array<{ id: string }>;
}

export interface GeotabDevice {
  id: string;
  name?: string;
  serialNumber?: string;
  deviceType?: string;
  activeFrom?: string;
  activeTo?: string;
  groups?: Array<{ id: string }>;
  comment?: string;
  vehicleIdentificationNumber?: string;
}

export interface GeotabDeviceStatusInfo {
  device?: { id: string };
  dateTime?: string;
  isDeviceCommunicating?: boolean;
  isDriving?: boolean;
}

export interface GeotabAddInData {
  id?: string;
  addInId: string;
  details: unknown;
  groups?: Array<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Camera-services (media-services.geotab.com) — DeviceMappingResponse
// ---------------------------------------------------------------------------

export interface CameraMapping {
  mappingId: string;
  /** Camera hardware id: IMEI (Surfsight), serial (SmarterAI), recorderId (Sensata). */
  partnerDeviceId: string;
  /** Paired GO serial, or "" when the mapping carries none. */
  goSerial: string;
  /** surfsight | smarterai | sensata | … (lower-cased). */
  partnerId: string;
  isOnboarded: boolean | null;
  deviceStatus: string | null;
  deviceStatusLastUpdatedAt: string | null;
  /** ISO timestamp of the camera's last check-in, or null when never/unknown. */
  lastOnlineAt: string | null;
  healthStatus: string | null;
  healthErrors: string[];
  healthLastUpdated: string | null;
}

// ---------------------------------------------------------------------------
// Vehicle (one row of inputs to the rules)
// ---------------------------------------------------------------------------

export interface VehicleInfo {
  id: string;
  name: string;
  serialNumber: string;
  groupIds: string[];
  groupNames: string[];
  vin: string;
  /** activeTo is in the past (archived / historical device). */
  archived: boolean;
  /** GO's last communication (DeviceStatusInfo.dateTime), or null if unknown. */
  lastComm: string | null;
  isCommunicating: boolean | null;
}

// ---------------------------------------------------------------------------
// Persisted state (AddInData)
// ---------------------------------------------------------------------------

export type SnoozeReason = "spare" | "battery-cutoff" | "in-shop" | "seasonal" | "other";

export interface SnoozeRecord {
  /** AddInData id (undefined until saved). */
  id?: string;
  kind: "snooze";
  /** Row key: "go:<deviceId>" for a vehicle, "cam:<partnerDeviceId>" for an orphan camera. */
  key: string;
  /** Human label at snooze time (vehicle name / camera id) — for the snoozed list + CSV. */
  label: string;
  reason: SnoozeReason;
  note: string;
  by: string;
  /** ISO when the snooze was set. */
  at: string;
  /** ISO expiry. */
  until: string;
}

export interface Settings {
  /** Rows show when the camera or the GO has been offline at least this long. */
  viewThresholdDays: number;
  /** A snoozed row punches through once either device has been offline this long. */
  hardLimitDays: number;
  /** The GO is called "active" (vehicle clearly alive) if it communicated within this many hours. */
  goActiveHours: number;
  /** Count vehicles with no paired camera as issues in the default view. */
  noCameraIsIssue: boolean;
}

export interface SettingsRecord extends Settings {
  id?: string;
  kind: "settings";
  by: string;
  at: string;
}

// ---------------------------------------------------------------------------
// Evaluated row
// ---------------------------------------------------------------------------

export type Diagnosis = "camera" | "go" | "both" | "no-go" | "no-camera" | "ok";
export type SnoozeState = "none" | "active" | "overridden" | "expired";

export interface HealthRow {
  key: string;
  vehicleId: string | null;
  vehicleName: string;
  goSerial: string | null;
  groupIds: string[];
  groupNames: string[];
  site: string;
  /** Vehicle is archived in MyGeotab (orphan-camera rows pointing at a retired unit). */
  vehicleArchived: boolean;

  cameraId: string | null;
  partner: string | null;
  cameraStatus: string | null;
  cameraHealthStatus: string | null;
  healthErrors: string[];

  cameraLastOnline: string | null;
  goLastComm: string | null;
  /** Days since the camera last reported; Infinity = never. null = no camera. */
  cameraOfflineDays: number | null;
  /** Days since the GO last communicated; Infinity = never. null = no GO. */
  goOfflineDays: number | null;
  /** The larger of the two (sort key — oldest offline first). */
  worstOfflineDays: number;
  /** GO communicated within goActiveHours (vehicle clearly alive). */
  goActive: boolean;

  diagnosis: Diagnosis;
  /** True when the row is a problem (anything but "ok", honouring noCameraIsIssue). */
  isIssue: boolean;

  snooze: SnoozeRecord | null;
  snoozeState: SnoozeState;
  /** Hidden from the default view because of an active, non-overridden snooze. */
  hiddenBySnooze: boolean;
}
