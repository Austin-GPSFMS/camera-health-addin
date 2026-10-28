/**
 * Demo data for the standalone preview (dist/index.html opened outside
 * MyGeotab) and for the offline test. Deterministic — no Math.random — so
 * screenshots and assertions are stable.
 */

import type { CameraMapping, SnoozeRecord, VehicleInfo } from "../types";
import { snoozeUntil, vehicleKey, cameraKey } from "./health";

const SITES = ["912 - Citrus County Landfill L011", "915 - Ocala Hauling H004", "921 - Jacksonville Hauling H012"];
const PARTNERS = ["surfsight", "surfsight", "surfsight", "smarterai", "sensata"];

function iso(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
}

export interface DemoData {
  vehicles: VehicleInfo[];
  mappings: CameraMapping[];
  snoozes: SnoozeRecord[];
}

export function makeDemo(now: Date): DemoData {
  const vehicles: VehicleInfo[] = [];
  const mappings: CameraMapping[] = [];
  const snoozes: SnoozeRecord[] = [];

  // (camera days offline, go days offline, partner index, note) — null = device missing
  const spec: Array<[number | null, number | null, number, string]> = [
    [0.1, 0.05, 0, "healthy"],
    [0.4, 0.2, 0, "healthy"],
    [21, 0.3, 0, "camera issue, truck active"],
    [16, 3, 1, "camera issue, truck idle 3 d"],
    [0.2, 18, 0, "go issue"],
    [19, 19, 0, "both silent (parked)"],
    [60, 60, 0, "both silent, snoozed but past hard limit → overridden"],
    [20, 20, 2, "both silent, snoozed (spare)"],
    [25, 25, 3, "both silent, snooze expired"],
    [null, 0.1, 0, "no camera paired"],
    [null, 30, 0, "no camera, GO offline 30 d"],
    [Number.POSITIVE_INFINITY, 0.2, 0, "camera never online"],
    [0.3, 0.1, 4, "healthy sensata"],
    [9, 9, 0, "both quiet but under 14 d threshold"],
    [0.05, 0.02, 0, "healthy"],
    [2, 1, 1, "healthy-ish"],
  ];

  spec.forEach(([camDays, goDays, pIdx, note], i) => {
    const id = `b${(i + 1).toString(16).toUpperCase()}`;
    const serial = `G9DEMO${(1000 + i).toString(36).toUpperCase().padStart(5, "0")}`;
    const site = SITES[i % SITES.length];
    const v: VehicleInfo = {
      id,
      name: `WP-${site.slice(0, 3)}-${(i + 1).toString().padStart(2, "0")}`,
      serialNumber: serial,
      groupIds: [`g${i % SITES.length}`],
      groupNames: [site, "Waste Pro"],
      vin: `1FDUF5HT${(10000000 + i).toString()}`.slice(0, 17),
      archived: false,
      deviceType: "GO9",
      cameraCapable: true,
      lastComm: goDays == null ? null : Number.isFinite(goDays) ? iso(now, goDays) : null,
      isCommunicating: goDays != null && goDays < 0.5,
    };
    vehicles.push(v);
    if (camDays != null) {
      const partner = PARTNERS[pIdx];
      const camId = partner === "surfsight" ? `35${(1000000000000 + i * 7919).toString().slice(0, 13)}` : partner === "smarterai" ? `GEX${(i * 31).toString(36).toUpperCase().padStart(9, "K")}` : `SEN${1000 + i}`;
      mappings.push({
        mappingId: `m${i}`,
        partnerDeviceId: camId,
        goSerial: serial,
        partnerId: partner,
        isOnboarded: true,
        deviceStatus: camDays < 0.5 ? "Online" : "Offline",
        deviceStatusLastUpdatedAt: iso(now, 0.01),
        lastOnlineAt: Number.isFinite(camDays) ? iso(now, camDays) : null,
        healthStatus: camDays < 0.5 ? "Healthy" : "Unhealthy",
        healthErrors: camDays >= 14 ? ["CameraEventRecorderNoCommunication24Hours"] : camDays >= 0.5 ? ["CameraOnlineLessThanThreshold"] : [],
        healthLastUpdated: iso(now, 0.02),
      });
    }
    void note;
  });

  // Orphan camera: pairing points at a GO serial that is not in this database.
  mappings.push({
    mappingId: "m-orphan",
    partnerDeviceId: "352099001761481",
    goSerial: "G9NOTHERE01",
    partnerId: "surfsight",
    isOnboarded: true,
    deviceStatus: "Online",
    deviceStatusLastUpdatedAt: iso(now, 0.01),
    lastOnlineAt: iso(now, 0.1),
    healthStatus: "Healthy",
    healthErrors: [],
    healthLastUpdated: iso(now, 0.02),
  });
  // Orphan camera: pairing with no GO serial at all, never online.
  mappings.push({
    mappingId: "m-orphan2",
    partnerDeviceId: "352099001761499",
    goSerial: "",
    partnerId: "surfsight",
    isOnboarded: false,
    deviceStatus: "Offline",
    deviceStatusLastUpdatedAt: null,
    lastOnlineAt: null,
    healthStatus: null,
    healthErrors: ["CameraNeverCameOnline"],
    healthLastUpdated: null,
  });
  // Archived vehicle still carrying a pairing.
  vehicles.push({
    id: "bARCH",
    name: "WP-912-OLD-07",
    serialNumber: "G9DEMOARCH1",
    groupIds: ["g0"],
    groupNames: [SITES[0], "Waste Pro"],
    vin: "",
    archived: true,
    deviceType: "GO9",
    cameraCapable: true,
    lastComm: iso(now, 120),
    isCommunicating: false,
  });
  mappings.push({
    mappingId: "m-arch",
    partnerDeviceId: "352099001761500",
    goSerial: "G9DEMOARCH1",
    partnerId: "surfsight",
    isOnboarded: true,
    deviceStatus: "Offline",
    deviceStatusLastUpdatedAt: iso(now, 100),
    lastOnlineAt: iso(now, 118),
    healthStatus: "Unhealthy",
    healthErrors: ["ZeroUptime"],
    healthLastUpdated: iso(now, 1),
  });

  const by = "demo@gpsfms.com";
  snoozes.push(
    { kind: "snooze", key: vehicleKey(vehicles[6].id), label: vehicles[6].name, reason: "spare", note: "Spare at Citrus", by, at: iso(now, 10), until: snoozeUntil(20, now) },
    { kind: "snooze", key: vehicleKey(vehicles[7].id), label: vehicles[7].name, reason: "spare", note: "", by, at: iso(now, 2), until: snoozeUntil(5, now) },
    { kind: "snooze", key: vehicleKey(vehicles[8].id), label: vehicles[8].name, reason: "in-shop", note: "Transmission", by, at: iso(now, 30), until: iso(now, 2) },
    { kind: "snooze", key: cameraKey("352099001761499"), label: "No GO on pairing", reason: "other", note: "Camera in the parts bin", by, at: iso(now, 1), until: snoozeUntil(7, now) }
  );

  return { vehicles, mappings, snoozes };
}
