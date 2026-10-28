/**
 * Vehicle & Camera Health — main app.
 *
 *   Header:   title · group picker · Settings · Export CSV · Refresh
 *   Tiles:    Issues / Camera issue / GO issue / Both silent / No GO / No camera / Snoozed / OK / All
 *   Toolbar:  partner chips · search · row count · last refreshed
 *   Table:    oldest offline first, Snooze / Unsnooze per row
 *
 * Data: one MyGeotab multiCall (Device, DeviceStatusInfo, Group, AddInData)
 * plus one camera-services call (GET /DeviceMappings). Everything after that
 * — threshold, filters, sort, snooze evaluation — is local and instant.
 * Snoozes and settings live in AddInData so every user on the database sees
 * the same board. Same Zenith vocabulary as the other GPSFMS add-ins.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, Button, SearchInput } from "@geotab/zenith";
import type { GeotabApi, GeotabGroup, GeotabPageState, GeotabSession, HealthRow, Settings, SettingsRecord, SnoozeRecord, CameraMapping, VehicleInfo } from "./types";
import { addSnooze, apiMultiCall, fetchSession, parseStoreRows, friendlyError, removeAddInData, saveSettings as saveSettingsRemote, toVehicleInfo, ADDIN_DATA_ID } from "./api/geotab";
import type { GeotabAddInData, GeotabDevice, GeotabDeviceStatusInfo } from "./types";
import { fetchDeviceMappings, type CameraServicesDebug } from "./api/cameraServices";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SORT,
  buildRows,
  clampSettings,
  compareRows,
  countNonGoWithoutCamera,
  countRows,
  expandGroupIds,
  matchesGroups,
  matchesPartner,
  matchesSearch,
  matchesView,
  partnerLabel,
  snoozeUntil,
  type SortCol,
  type SortState,
  type ViewFilter,
} from "./utils/health";
import { downloadCsv, rowsToCsv } from "./utils/csv";
import { makeDemo } from "./utils/demo";
import { formatDateTime } from "./utils/format";
import { GroupFilterPicker } from "./components/GroupFilterPicker";
import { Summary } from "./components/Summary";
import { HealthTable } from "./components/HealthTable";
import { SnoozeDialog, type SnoozeChoice } from "./components/SnoozeDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";

interface AppProps {
  api: GeotabApi | null;
  pageState: GeotabPageState | null;
  /** Bumped by the add-in's focus() so a returning user gets fresh data. */
  focusNonce: number;
}

const LOCAL_SETTINGS_KEY = "gpsfms.vehicleCameraHealth.settings.v1";

function loadLocalSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
    return raw ? clampSettings(JSON.parse(raw) as Partial<Settings>) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function saveLocalSettings(s: Settings): void {
  try {
    window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

interface LoadedData {
  vehicles: VehicleInfo[];
  mappings: CameraMapping[];
  loadedAt: Date;
  /** Untracked assets / serial-less devices dropped before the join. */
  excluded: number;
}

export default function App({ api, pageState: _pageState, focusNonce }: AppProps) {
  const insideMyGeotab = api != null;

  const [session, setSession] = useState<GeotabSession | null>(null);
  const [groupsById, setGroupsById] = useState<Map<string, GeotabGroup>>(() => new Map());
  const [data, setData] = useState<LoadedData | null>(null);
  const [snoozes, setSnoozes] = useState<SnoozeRecord[]>([]);
  const [settings, setSettings] = useState<Settings>(() => loadLocalSettings());
  const [settingsRec, setSettingsRec] = useState<SettingsRecord | null>(null);
  const [storeShared, setStoreShared] = useState(true);

  const [loading, setLoading] = useState(false);
  const [geotabErr, setGeotabErr] = useState<string | null>(null);
  const [cameraErr, setCameraErr] = useState<string | null>(null);
  const [storeErr, setStoreErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [debug, setDebug] = useState<CameraServicesDebug | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);

  const [view, setView] = useState<ViewFilter>("issues");
  const [partner, setPartner] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [snoozeTarget, setSnoozeTarget] = useState<HealthRow | null>(null);

  const lastNonce = useRef(-1);
  const [now, setNow] = useState(() => new Date());

  // ---- Load -----------------------------------------------------------------

  const load = useCallback(async () => {
    const t = new Date();
    setNow(t);
    if (!api) {
      const demo = makeDemo(t);
      setData({ vehicles: demo.vehicles, mappings: demo.mappings, loadedAt: t, excluded: 3 });
      setSnoozes(demo.snoozes);
      setGroupsById(
        new Map([
          ["GroupCompanyId", { id: "GroupCompanyId", name: "Company", children: [{ id: "g0" }, { id: "g1" }, { id: "g2" }] }],
          ["g0", { id: "g0", name: "912 - Citrus County Landfill L011" }],
          ["g1", { id: "g1", name: "915 - Ocala Hauling H004" }],
          ["g2", { id: "g2", name: "921 - Jacksonville Hauling H012" }],
        ])
      );
      setStoreShared(false);
      return;
    }
    setLoading(true);
    setGeotabErr(null);
    setCameraErr(null);
    setStoreErr(null);
    setActionErr(null);
    try {
      const s = session ?? (await fetchSession(api));
      if (!s) throw new Error("Could not read the MyGeotab session (api.getSession returned nothing).");
      setSession(s);

      // MyGeotab side — one multiCall.
      const [devicesRaw, statusRaw, groupsRaw, storeRaw] = await apiMultiCall<unknown>(api, [
        ["Get", { typeName: "Device", resultsLimit: 50000 }],
        ["Get", { typeName: "DeviceStatusInfo", resultsLimit: 50000 }],
        ["Get", { typeName: "Group", resultsLimit: 10000 }],
        ["Get", { typeName: "AddInData", search: { addInId: ADDIN_DATA_ID }, resultsLimit: 10000 }],
      ]);
      const devices = (devicesRaw as GeotabDevice[]).filter((d) => d.id !== "NoDeviceId");
      const status = new Map<string, GeotabDeviceStatusInfo>();
      for (const r of statusRaw as GeotabDeviceStatusInfo[]) if (r.device?.id) status.set(r.device.id, r);
      const groups = new Map((groupsRaw as GeotabGroup[]).map((g) => [g.id, g]));
      setGroupsById(groups);
      const { vehicles, excluded } = toVehicleInfo(devices, status, groups, t);

      // AddInData → snoozes + settings (parse via the same path as fetchStore).
      try {
        const store = parseStoreRows(storeRaw as GeotabAddInData[]);
        setSnoozes(store.snoozes);
        setStoreShared(true);
        if (store.settings) {
          setSettingsRec(store.settings);
          const { id: _i, kind: _k, by: _b, at: _a, ...s } = store.settings;
          setSettings(clampSettings(s));
          saveLocalSettings(clampSettings(s));
        }
      } catch (e) {
        setStoreShared(false);
        setStoreErr(`Shared snoozes/settings unavailable (${friendlyError(e)}) — using this browser's settings; snoozing is disabled.`);
      }

      // Camera side — camera-services.
      try {
        const { mappings, debug: dbg } = await fetchDeviceMappings(s);
        setDebug(dbg);
        setData({ vehicles, mappings, loadedAt: t, excluded });
      } catch (e) {
        const msg = friendlyError(e);
        setCameraErr(msg);
        setDebug((prev) => prev ?? { url: "", status: null, count: 0, sample: null, error: msg, tookMs: 0 });
        setData(null);
      }
    } catch (e) {
      setGeotabErr(friendlyError(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, session]);

  useEffect(() => {
    if (lastNonce.current === focusNonce) return;
    lastNonce.current = focusNonce;
    void load();
  }, [focusNonce, load]);

  // Keep "x d ago" fresh while the tab stays open.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // ---- Derived rows ---------------------------------------------------------

  const allRows = useMemo<HealthRow[]>(
    () => (data ? buildRows({ vehicles: data.vehicles, mappings: data.mappings, snoozes, settings, now }) : []),
    [data, snoozes, settings, now]
  );

  const nonGoSkipped = useMemo(() => (data ? countNonGoWithoutCamera(data.vehicles, data.mappings) : 0), [data]);

  const expandedGroups = useMemo(() => (groupIds.length ? expandGroupIds(groupIds, groupsById) : null), [groupIds, groupsById]);

  const scopedRows = useMemo(
    () => allRows.filter((r) => matchesGroups(r, expandedGroups) && matchesPartner(r, partner) && matchesSearch(r, search)),
    [allRows, expandedGroups, partner, search]
  );
  const counts = useMemo(() => countRows(scopedRows), [scopedRows]);
  const visibleRows = useMemo(() => scopedRows.filter((r) => matchesView(r, view)).sort((a, b) => compareRows(a, b, sort)), [scopedRows, view, sort]);

  const partners = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) if (r.partner) set.add(r.partner);
    return [...set].sort();
  }, [allRows]);

  const myGeotabBase = session ? `https://${session.server.replace(/^https?:\/\//, "").replace(/\/$/, "")}/${session.database}/` : "";

  const onSort = useCallback((col: SortCol) => {
    setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: col === "vehicle" || col === "site" || col === "partner" ? 1 : -1 }));
  }, []);

  // ---- Snooze actions -------------------------------------------------------

  const confirmSnooze = useCallback(
    async (choice: SnoozeChoice) => {
      const row = snoozeTarget;
      if (!row) return;
      const t = new Date();
      const rec: SnoozeRecord = {
        kind: "snooze",
        key: row.key,
        label: row.vehicleName,
        reason: choice.reason,
        note: choice.note,
        by: session?.userName ?? "demo",
        at: t.toISOString(),
        until: snoozeUntil(choice.days, t),
      };
      setSaving(true);
      setActionErr(null);
      try {
        if (api) {
          // Replace any previous record for this key so there is one row per vehicle.
          const old = snoozes.filter((s) => s.key === row.key && s.id);
          const id = await addSnooze(api, rec);
          rec.id = id;
          for (const o of old) {
            try {
              await removeAddInData(api, o.id!);
            } catch {
              /* stale duplicate — harmless, newest wins */
            }
          }
        } else {
          rec.id = `demo-${Date.now()}`;
        }
        setSnoozes((prev) => [...prev.filter((s) => s.key !== row.key), rec]);
        setSnoozeTarget(null);
      } catch (e) {
        setActionErr(`Could not save the snooze: ${friendlyError(e)}`);
      } finally {
        setSaving(false);
      }
    },
    [api, session, snoozeTarget, snoozes]
  );

  const unsnooze = useCallback(
    async (row: HealthRow) => {
      if (!row.snooze) return;
      setSaving(true);
      setActionErr(null);
      try {
        if (api && row.snooze.id) await removeAddInData(api, row.snooze.id);
        setSnoozes((prev) => prev.filter((s) => s.key !== row.key));
      } catch (e) {
        setActionErr(`Could not remove the snooze: ${friendlyError(e)}`);
      } finally {
        setSaving(false);
      }
    },
    [api]
  );

  const clearExpired = useCallback(async () => {
    const expired = allRows.filter((r) => r.snoozeState === "expired" && r.snooze?.id).map((r) => r.snooze!);
    if (expired.length === 0) return;
    setSaving(true);
    try {
      if (api) for (const s of expired) await removeAddInData(api, s.id!);
      const gone = new Set(expired.map((s) => s.key));
      setSnoozes((prev) => prev.filter((s) => !gone.has(s.key)));
    } catch (e) {
      setActionErr(`Could not clean up expired snoozes: ${friendlyError(e)}`);
    } finally {
      setSaving(false);
    }
  }, [allRows, api]);

  const onSaveSettings = useCallback(
    async (s: Settings) => {
      setSaving(true);
      setActionErr(null);
      try {
        setSettings(s);
        saveLocalSettings(s);
        if (api && storeShared) {
          const rec: SettingsRecord = { ...s, id: settingsRec?.id, kind: "settings", by: session?.userName ?? "", at: new Date().toISOString() };
          const id = await saveSettingsRemote(api, rec);
          setSettingsRec({ ...rec, id });
        }
        setShowSettings(false);
      } catch (e) {
        setActionErr(`Settings saved in this browser, but not shared: ${friendlyError(e)}`);
      } finally {
        setSaving(false);
      }
    },
    [api, session, settingsRec, storeShared]
  );

  const exportCsv = useCallback(() => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`vehicle-camera-health_${session?.database ?? "demo"}_${view}_${stamp}.csv`, rowsToCsv(visibleRows));
  }, [session, view, visibleRows]);

  const expiredCount = allRows.filter((r) => r.snoozeState === "expired").length;

  // ---- Render ---------------------------------------------------------------

  const emptyText =
    view === "issues"
      ? counts.snoozed > 0
        ? `Nothing needs attention — ${counts.snoozed} snoozed row${counts.snoozed === 1 ? "" : "s"} hidden.`
        : "Nothing needs attention."
      : view === "snoozed"
        ? "No active snoozes."
        : "No rows match.";

  return (
    <div className="vch-page">
      <div className="vch-page-header">
        <div>
          <h2>Vehicle &amp; Camera Health</h2>
          <p>
            Geotab-native cameras (Surfsight, GO Focus, Sensata) and their GO devices, oldest offline first. Snooze spares and battery-cutoff units; they come back when the snooze expires or once they pass the{" "}
            {settings.hardLimitDays}-day hard limit.
          </p>
        </div>
        <div className="vch-actions">
          {groupsById.size > 0 ? (
            <div className="vch-groups-picker">
              <GroupFilterPicker groupsById={groupsById} onChange={setGroupIds} />
            </div>
          ) : null}
          <Button type="secondary" onClick={() => setShowSettings((v) => !v)} disabled={loading}>
            Settings
          </Button>
          <Button type="secondary" onClick={exportCsv} disabled={visibleRows.length === 0}>
            Export CSV
          </Button>
          <Button type="primary" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="vch-banners">
        {!insideMyGeotab ? (
          <Banner type="info" header="Standalone preview">
            Open this page from the MyGeotab menu to see live data. Showing demo data; snoozes here are not saved.
          </Banner>
        ) : null}
        {geotabErr ? (
          <Banner type="error" header="MyGeotab request failed">
            {geotabErr}
          </Banner>
        ) : null}
        {cameraErr ? (
          <Banner type="error" header="Camera-services request failed">
            {cameraErr}
          </Banner>
        ) : null}
        {storeErr ? <Banner type="warning">{storeErr}</Banner> : null}
        {actionErr ? <Banner type="error">{actionErr}</Banner> : null}
      </div>

      {showSettings ? (
        <SettingsPanel settings={settings} savedBy={settingsRec?.by || null} busy={saving} shared={storeShared} onSave={onSaveSettings} onClose={() => setShowSettings(false)} />
      ) : null}

      {data ? (
        <ErrorBoundary label="summary">
          <Summary counts={counts} settings={settings} active={view} onPick={setView} />
        </ErrorBoundary>
      ) : null}

      {data ? (
        <div className="vch-toolbar">
          <div className="vch-seg" role="group" aria-label="Camera partner">
            <button type="button" className={`vch-seg-btn${partner === "all" ? " vch-seg-btn--on" : ""}`} onClick={() => setPartner("all")}>
              All cameras
            </button>
            {partners.map((p) => (
              <button key={p} type="button" className={`vch-seg-btn${partner === p ? " vch-seg-btn--on" : ""}`} onClick={() => setPartner(p)}>
                {partnerLabel(p)}
              </button>
            ))}
            {allRows.some((r) => r.partner == null) ? (
              <button type="button" className={`vch-seg-btn${partner === "none" ? " vch-seg-btn--on" : ""}`} onClick={() => setPartner("none")}>
                No camera
              </button>
            ) : null}
          </div>
          <div className="vch-search">
            <SearchInput value={search} onChange={setSearch} placeholder="Vehicle, serial, camera id, group, error…" ariaLabel="Search rows" />
          </div>
          <span className="vch-spacer" />
          <span className="vch-muted">
            {visibleRows.length.toLocaleString()} of {scopedRows.length.toLocaleString()} rows
            {expiredCount > 0 ? (
              <>
                {" · "}
                <button type="button" className="vch-link" onClick={() => void clearExpired()} disabled={saving}>
                  clear {expiredCount} expired snooze{expiredCount === 1 ? "" : "s"}
                </button>
              </>
            ) : null}
            {data.excluded > 0 ? (
              <span title="Untracked assets (no telematics device) and devices without a serial number are left out — they can never report or carry a camera pairing.">
                {" · "}
                {data.excluded.toLocaleString()} untracked asset{data.excluded === 1 ? "" : "s"} excluded
              </span>
            ) : null}
            {nonGoSkipped > 0 ? (
              <span title="Third-party devices (CustomDevice / CustomVehicleDevice), GO Anywhere and GoDrive units can't carry a camera, so they are not listed as 'No camera paired'. They still appear if a camera is mapped to them.">
                {" · "}
                {nonGoSkipped.toLocaleString()} non-GO device{nonGoSkipped === 1 ? "" : "s"} without a camera not listed
              </span>
            ) : null}
            {" · "}refreshed {formatDateTime(data.loadedAt.toISOString())}
          </span>
        </div>
      ) : null}

      {data ? (
        <ErrorBoundary label="table">
          <HealthTable rows={visibleRows} sort={sort} onSort={onSort} now={now} busy={loading || saving} myGeotabBase={myGeotabBase} onSnooze={setSnoozeTarget} onUnsnooze={(r) => void unsnooze(r)} emptyText={emptyText} />
        </ErrorBoundary>
      ) : loading ? (
        <div className="vch-empty">Loading vehicles, GO status and camera pairings…</div>
      ) : null}

      {debug ? (
        <details className="vch-debug">
          <summary>camera-services call log</summary>
          <pre>
            {JSON.stringify(
              { url: debug.url, status: debug.status, mappings: debug.count, tookMs: Math.round(debug.tookMs), error: debug.error, firstRecord: debug.sample },
              null,
              2
            )}
          </pre>
        </details>
      ) : null}

      <SnoozeDialog row={snoozeTarget} settings={settings} busy={saving} onConfirm={(c) => void confirmSnooze(c)} onClose={() => setSnoozeTarget(null)} />
    </div>
  );
}
