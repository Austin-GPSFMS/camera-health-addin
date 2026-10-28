/**
 * Offline rules check: bundles the pure health/csv/demo utilities with esbuild
 * and asserts the diagnosis, snooze and sort behaviour on known inputs.
 *   npm test
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, ".build");
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, "rules.mjs");
await build({
  entryPoints: [resolve(here, "rules-entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
  logLevel: "silent",
});
const m = await import(pathToFileURL(outFile).href);

const now = new Date("2026-10-27T18:00:00Z");
const iso = (daysAgo) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
const S = { ...m.DEFAULT_SETTINGS }; // 14 d view, 45 d hard limit, 24 h GO active

const vehicle = (id, serial, lastCommDays, extra = {}) => ({
  id, name: `Truck ${id}`, serialNumber: serial, groupIds: ["g1"], groupNames: ["912 - Citrus County Landfill L011"],
  vin: "", deviceType: "GO9", cameraCapable: true, archived: false, lastComm: lastCommDays == null ? null : iso(lastCommDays), isCommunicating: lastCommDays != null && lastCommDays < 0.5, ...extra,
});
const mapping = (cam, serial, lastOnlineDays, partner = "surfsight", extra = {}) => ({
  mappingId: `m-${cam}`, partnerDeviceId: cam, goSerial: serial, partnerId: partner, isOnboarded: true,
  deviceStatus: "Offline", deviceStatusLastUpdatedAt: null, lastOnlineAt: lastOnlineDays == null ? null : iso(lastOnlineDays),
  healthStatus: null, healthErrors: [], healthLastUpdated: null, ...extra,
});
const snooze = (key, untilDays, extra = {}) => ({ kind: "snooze", key, label: key, reason: "spare", note: "", by: "t@gpsfms.com", at: iso(1), until: iso(-untilDays), ...extra });
const one = (rows, key) => rows.find((r) => r.key === key);

let n = 0;
const check = (name, fn) => { fn(); n += 1; console.log("  ✓", name); };

// 1. Diagnosis matrix against the 14-day threshold.
check("diagnosis: camera / go / both / ok", () => {
  const rows = m.buildRows({
    vehicles: [vehicle("a", "GA", 0.1), vehicle("b", "GB", 20), vehicle("c", "GC", 20), vehicle("d", "GD", 0.2)],
    mappings: [mapping("c1", "GA", 21), mapping("c2", "GB", 0.1), mapping("c3", "GC", 21), mapping("c4", "GD", 0.3)],
    snoozes: [], settings: S, now,
  });
  assert.equal(one(rows, "go:a").diagnosis, "camera");
  assert.equal(one(rows, "go:a").goActive, true);
  assert.equal(one(rows, "go:b").diagnosis, "go");
  assert.equal(one(rows, "go:c").diagnosis, "both");
  assert.equal(one(rows, "go:d").diagnosis, "ok");
  assert.equal(one(rows, "go:d").isIssue, false);
  assert.equal(rows.length, 4);
});

// 2. Exactly-at-threshold counts as stale; just under does not.
check("threshold boundary (>= 14 d)", () => {
  const rows = m.buildRows({ vehicles: [vehicle("a", "GA", 0.1), vehicle("b", "GB", 0.1)], mappings: [mapping("c1", "GA", 14), mapping("c2", "GB", 13.9)], snoozes: [], settings: S, now });
  assert.equal(one(rows, "go:a").diagnosis, "camera");
  assert.equal(one(rows, "go:b").diagnosis, "ok");
});

// 3. No camera paired → "no-camera", not an issue unless the setting says so.
check("no camera paired: flag + setting", () => {
  const base = { vehicles: [vehicle("a", "GA", 0.1)], mappings: [], snoozes: [], now };
  const r1 = m.buildRows({ ...base, settings: S })[0];
  assert.equal(r1.diagnosis, "no-camera");
  assert.equal(r1.isIssue, false);
  assert.equal(r1.cameraOfflineDays, null);
  const r2 = m.buildRows({ ...base, settings: { ...S, noCameraIsIssue: true } })[0];
  assert.equal(r2.isIssue, true);
  assert.equal(m.matchesView(r1, "issues"), false);
  assert.equal(m.matchesView(r1, "no-camera"), true);
});

// 4. Orphan cameras: unknown GO serial, empty serial, archived vehicle.
check("orphan cameras → no-go rows keyed by camera id", () => {
  const rows = m.buildRows({
    vehicles: [vehicle("old", "GOLD", 100, { archived: true })],
    mappings: [mapping("c1", "GNOPE", 0.1), mapping("c2", "", null), mapping("c3", "GOLD", 90)],
    snoozes: [], settings: S, now,
  });
  assert.equal(rows.length, 3); // archived vehicle itself does not get a no-camera row
  const c1 = one(rows, "cam:c1"), c2 = one(rows, "cam:c2"), c3 = one(rows, "cam:c3");
  assert.equal(c1.diagnosis, "no-go"); assert.match(c1.vehicleName, /Unknown GO GNOPE/);
  assert.equal(c2.diagnosis, "no-go"); assert.equal(c2.vehicleName, "No GO on pairing"); assert.equal(c2.cameraOfflineDays, Infinity);
  assert.equal(c3.diagnosis, "no-go"); assert.match(c3.vehicleName, /archived/); assert.equal(c3.vehicleArchived, true);
  assert.ok(rows.every((r) => r.isIssue));
});

// 5. Snooze hides, expiry un-hides, hard limit overrides.
check("snooze: active / expired / overridden", () => {
  const rows = m.buildRows({
    vehicles: [vehicle("a", "GA", 20), vehicle("b", "GB", 20), vehicle("c", "GC", 50), vehicle("d", "GD", 0.1)],
    mappings: [mapping("c1", "GA", 20), mapping("c2", "GB", 20), mapping("c3", "GC", 50), mapping("c4", "GD", 46)],
    snoozes: [snooze("go:a", 5), snooze("go:b", -1), snooze("go:c", 5), snooze("go:d", 5)],
    settings: S, now,
  });
  const a = one(rows, "go:a"), b = one(rows, "go:b"), c = one(rows, "go:c"), d = one(rows, "go:d");
  assert.equal(a.snoozeState, "active"); assert.equal(a.hiddenBySnooze, true);
  assert.equal(b.snoozeState, "expired"); assert.equal(b.hiddenBySnooze, false);
  assert.equal(c.snoozeState, "overridden"); assert.equal(c.hiddenBySnooze, false);
  // d: camera alone past the hard limit on a live truck → override fires on one side.
  assert.equal(d.diagnosis, "camera"); assert.equal(d.snoozeState, "overridden"); assert.equal(d.hiddenBySnooze, false);
  assert.equal(m.matchesView(a, "issues"), false);
  assert.equal(m.matchesView(a, "snoozed"), true);
  assert.equal(m.matchesView(c, "issues"), true);
  assert.equal(m.matchesView(c, "snoozed"), false);
  const counts = m.countRows(rows);
  assert.equal(counts.snoozed, 1); assert.equal(counts.overridden, 2); assert.equal(counts.issues, 3);
});

// 5b. "Never reported" has no duration → a snooze on it is honoured, not overridden.
check("snooze on a never-online camera is honoured until expiry", () => {
  const rows = m.buildRows({ vehicles: [vehicle("a", "GA", 0.1)], mappings: [mapping("c1", "GA", null)], snoozes: [snooze("go:a", 5)], settings: S, now });
  assert.equal(rows[0].diagnosis, "camera");
  assert.equal(rows[0].cameraOfflineDays, Infinity);
  assert.equal(rows[0].snoozeState, "active");
  assert.equal(rows[0].hiddenBySnooze, true);
});

// 6. A snooze on a healthy row is harmless (not hidden because nothing to hide) and shows as active.
check("snooze on an OK row", () => {
  const rows = m.buildRows({ vehicles: [vehicle("a", "GA", 0.1)], mappings: [mapping("c1", "GA", 0.1)], snoozes: [snooze("go:a", 5)], settings: S, now });
  assert.equal(rows[0].snoozeState, "active");
  assert.equal(rows[0].hiddenBySnooze, false);
});

// 7. Latest snooze wins when duplicates exist for a key.
check("duplicate snoozes → newest wins", () => {
  const rows = m.buildRows({
    vehicles: [vehicle("a", "GA", 20)], mappings: [mapping("c1", "GA", 20)],
    snoozes: [snooze("go:a", -3, { at: iso(10), note: "old" }), snooze("go:a", 9, { at: iso(1), note: "new" })],
    settings: S, now,
  });
  assert.equal(rows[0].snooze.note, "new");
  assert.equal(rows[0].snoozeState, "active");
});

// 8. Default sort: oldest offline first, "never" above everything, no-device rows below.
check("sort: oldest offline first", () => {
  const rows = m.buildRows({
    vehicles: [vehicle("a", "GA", 0.1), vehicle("b", "GB", 0.1), vehicle("c", "GC", 0.1), vehicle("d", "GD", 30)],
    mappings: [mapping("c1", "GA", 5), mapping("c2", "GB", null), mapping("c3", "GC", 40)],
    snoozes: [], settings: S, now,
  });
  const sorted = [...rows].sort((x, y) => m.compareRows(x, y, m.DEFAULT_SORT));
  assert.deepEqual(sorted.map((r) => r.key), ["go:b", "go:c", "go:d", "go:a"]);
  const byCam = [...rows].sort((x, y) => m.compareRows(x, y, { col: "camera", dir: -1 }));
  assert.deepEqual(byCam.map((r) => r.key), ["go:b", "go:c", "go:a", "go:d"]); // d has no camera → last
});

// 9. Partner / group / search filters.
check("filters: partner, groups (with descendants), search", () => {
  const groups = new Map([
    ["GroupCompanyId", { id: "GroupCompanyId", children: [{ id: "g1" }] }],
    ["g1", { id: "g1", children: [{ id: "g1a" }] }],
    ["g1a", { id: "g1a" }],
    ["g2", { id: "g2" }],
  ]);
  const rows = m.buildRows({
    vehicles: [vehicle("a", "GA", 0.1, { groupIds: ["g1a"] }), vehicle("b", "GB", 0.1, { groupIds: ["g2"] })],
    mappings: [mapping("c1", "GA", 20, "surfsight"), mapping("c2", "GB", 20, "smarterai"), mapping("orph", "GX", 1, "sensata")],
    snoozes: [], settings: S, now,
  });
  assert.equal(rows.filter((r) => m.matchesPartner(r, "surfsight")).length, 1);
  assert.equal(rows.filter((r) => m.matchesPartner(r, "all")).length, 3);
  const g1 = m.expandGroupIds(["g1"], groups);
  assert.deepEqual([...g1].sort(), ["g1", "g1a"]);
  const inG1 = rows.filter((r) => m.matchesGroups(r, g1)).map((r) => r.key).sort();
  assert.deepEqual(inG1, ["cam:orph", "go:a"]); // orphan (no groups) stays visible; b (g2) drops
  assert.equal(rows.filter((r) => m.matchesGroups(r, m.expandGroupIds(["GroupCompanyId"], groups))).length, 3);
  assert.equal(rows.filter((r) => m.matchesSearch(r, "truck b")).length, 1);
  assert.equal(rows.filter((r) => m.matchesSearch(r, "GX")).length, 1);
});

// 10. Settings clamp: hard limit never below the view threshold.
check("clampSettings", () => {
  const s = m.clampSettings({ viewThresholdDays: 30, hardLimitDays: 10, goActiveHours: "48", noCameraIsIssue: "yes" });
  assert.equal(s.viewThresholdDays, 30);
  assert.equal(s.hardLimitDays, 30);
  assert.equal(s.goActiveHours, 48);
  assert.equal(s.noCameraIsIssue, false);
  assert.deepEqual(m.clampSettings({}), m.DEFAULT_SETTINGS);
});

// 11. media-services normalisation: documented field names + unix-ms fallback.
check("normalizeMapping handles DeviceMappingResponse", () => {
  const r = m.normalizeMapping({
    deviceMappingId: "dm1", partnerDeviceId: "352099001761481", associatedDeviceSerialNumber: "G9ABC", partnerId: "Surfsight",
    isOnboarded: true, deviceStatus: "Offline", deviceStatusLastUpdatedAt: "2026-10-20T00:00:00Z",
    partnerDeviceLastOnlineAt: "2026-10-01T12:00:00Z", partnerDeviceHealthStatus: "Unhealthy",
    partnerDeviceHealthErrors: ["CameraNeverCameOnline"], partnerDeviceHealthLastUpdated: 1792000000000,
  });
  assert.equal(r.partnerId, "surfsight");
  assert.equal(r.goSerial, "G9ABC");
  assert.equal(r.lastOnlineAt, "2026-10-01T12:00:00.000Z");
  assert.deepEqual(r.healthErrors, ["CameraNeverCameOnline"]);
  assert.match(r.healthLastUpdated, /^2026-10-1[45]T/);
  assert.equal(m.normalizeMapping({ partnerId: "x" }), null);
});

// 11b. Untracked assets and serial-less devices never reach the rules.
check("untracked assets are excluded before the join", () => {
  const devices = [
    { id: "b1", name: "Truck 1", serialNumber: "G9AAA", deviceType: "GO9", groups: [{ id: "g1" }] },
    { id: "b2", name: "Trailer (untracked)", serialNumber: "", deviceType: "None", groups: [{ id: "g1" }] },
    { id: "b3", name: "Loader (untracked, zero serial)", serialNumber: "000000000000", deviceType: "None" },
    { id: "b4", name: "No serial but typed", serialNumber: "", deviceType: "GO9" },
    { id: "b5", name: "Custom device", serialNumber: "C1XYZ", deviceType: "CustomDevice" },
  ];
  assert.deepEqual(devices.map(m.isTrackableDevice), [true, false, false, false, true]);
  const join = m.toVehicleInfo(devices, new Map(), new Map([["g1", { id: "g1", name: "Site" }]]), now);
  assert.equal(join.excluded, 3);
  assert.deepEqual(join.vehicles.map((v) => v.id), ["b1", "b5"]);
  const rows = m.buildRows({ vehicles: join.vehicles, mappings: [], snoozes: [], settings: S, now });
  // The custom device is joined (a camera mapped to it would show) but is not a "No camera paired" finding.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].vehicleId, "b1");
  assert.ok(rows.every((r) => r.diagnosis === "no-camera"));
});

// 11c. Only GO vehicle devices are listed as "No camera paired"; third-party / GO Anywhere / GoDrive are skipped
// unless a camera is actually mapped to them.
check("non-GO devices are never 'No camera paired' rows", () => {
  assert.deepEqual(
    [
      { deviceType: "GO9", serialNumber: "G9AAA" },
      { deviceType: "GO9B", serialNumber: "G9BBB" },
      { deviceType: "GO7", serialNumber: "G7CCC" },
      { deviceType: "CustomVehicleDevice", serialNumber: "CNB82164AF45" },
      { deviceType: "CustomDevice", serialNumber: "C1XYZ" },
      { deviceType: "GoAnywhere", serialNumber: "GAxxx" },
      { deviceType: "GoDriveDevice", serialNumber: "GDxxx" },
      { deviceType: "", serialNumber: "G9DDD" },
      { deviceType: "", serialNumber: "CNB1" },
    ].map(m.isCameraCapableGo),
    [true, true, true, false, false, false, false, true, false]
  );
  const devices = [
    { id: "v1", name: "GO truck", serialNumber: "G9AAA", deviceType: "GO9" },
    { id: "v2", name: "Third-party", serialNumber: "CNB82164AF45", deviceType: "CustomVehicleDevice" },
    { id: "v3", name: "Third-party with camera", serialNumber: "CNB99999AA11", deviceType: "CustomVehicleDevice" },
    { id: "v4", name: "GO Anywhere", serialNumber: "GAQQQ", deviceType: "GoAnywhere" },
  ];
  const join = m.toVehicleInfo(devices, new Map(), new Map(), now);
  const mappings = [m.normalizeMapping({ partnerDeviceId: "cam-3", partnerId: "surfsight", associatedDeviceSerialNumber: "CNB99999AA11", deviceStatus: "online", partnerDeviceLastOnlineAt: now.toISOString() })].filter(Boolean);
  assert.equal(mappings.length, 1, "fixture mapping should normalize");
  const rows = m.buildRows({ vehicles: join.vehicles, mappings, snoozes: [], settings: S, now });
  assert.deepEqual(rows.map((r) => [r.vehicleId, r.diagnosis]).sort(), [["v1", "no-camera"], ["v3", "go"]]); // v3 shows (camera mapped) — GO side has no status → "go"
  assert.equal(m.countNonGoWithoutCamera(join.vehicles, mappings), 2);
});

// 12. Demo data end-to-end + CSV.
check("demo fleet builds rows with every diagnosis and CSV round-trips", () => {
  const demo = m.makeDemo(now);
  const rows = m.buildRows({ ...demo, settings: S, now });
  const diags = new Set(rows.map((r) => r.diagnosis));
  for (const d of ["camera", "go", "both", "no-go", "no-camera", "ok"]) assert.ok(diags.has(d), `missing ${d}`);
  const states = new Set(rows.map((r) => r.snoozeState));
  for (const s of ["none", "active", "expired", "overridden"]) assert.ok(states.has(s), `missing snooze state ${s}`);
  const csv = m.rowsToCsv(rows);
  assert.equal(csv.split("\r\n").length, rows.length + 1);
  assert.ok(csv.includes("Camera issue"));
  const c = m.countRows(rows);
  console.log("    demo counts:", c);
});

console.log(`${n} checks passed`);
