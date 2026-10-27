/**
 * The dashboard table. Default order is oldest offline first; every header
 * sorts. Each row carries its Snooze / Unsnooze action.
 */

import { Button } from "@geotab/zenith";
import type { HealthRow } from "../types";
import { DIAGNOSIS_HINT, DIAGNOSIS_LABEL, SNOOZE_REASON_LABEL, partnerLabel, type SortCol, type SortState } from "../utils/health";
import { formatDateTime, formatOffline, formatUntil, humanizeCode } from "../utils/format";

interface Props {
  rows: HealthRow[];
  sort: SortState;
  onSort: (col: SortCol) => void;
  now: Date;
  busy: boolean;
  myGeotabBase: string;
  onSnooze: (row: HealthRow) => void;
  onUnsnooze: (row: HealthRow) => void;
  emptyText: string;
}

const DIAG_CLASS: Record<HealthRow["diagnosis"], string> = {
  camera: "vch-pill vch-pill-bad",
  go: "vch-pill vch-pill-bad",
  both: "vch-pill vch-pill-warn",
  "no-go": "vch-pill vch-pill-warn",
  "no-camera": "vch-pill vch-pill-muted",
  ok: "vch-pill vch-pill-ok",
};

function Th({ col, label, sort, onSort, className }: { col: SortCol; label: string; sort: SortState; onSort: (c: SortCol) => void; className?: string }) {
  const active = sort.col === col;
  return (
    <th
      className={`${className ?? ""}${active ? " vch-sorted" : ""}`}
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      onClick={() => onSort(col)}
      title={`Sort by ${label.toLowerCase()}`}
    >
      {label}
      <span className="vch-sort-arrow" aria-hidden>
        {active ? (sort.dir === 1 ? "▲" : "▼") : "⇅"}
      </span>
    </th>
  );
}

function OfflineCell({ days, iso, missing, now }: { days: number | null; iso: string | null; missing: string; now: Date }) {
  void now;
  if (days == null) return <td className="vch-num vch-muted">{missing}</td>;
  const cls = !Number.isFinite(days) ? "vch-off-never" : days >= 14 ? "vch-off-bad" : days >= 1 ? "vch-off-warn" : "vch-off-ok";
  return (
    <td className={`vch-num ${cls}`} title={formatDateTime(iso)}>
      {formatOffline(days)}
    </td>
  );
}

export function HealthTable({ rows, sort, onSort, now, busy, myGeotabBase, onSnooze, onUnsnooze, emptyText }: Props) {
  return (
    <div className={`vch-table-wrap${busy ? " vch-busy" : ""}`}>
      <table className="vch-table">
        <thead>
          <tr>
            <Th col="offline" label="Offline" sort={sort} onSort={onSort} className="vch-num" />
            <Th col="vehicle" label="Vehicle" sort={sort} onSort={onSort} />
            <Th col="site" label="Site" sort={sort} onSort={onSort} />
            <Th col="diagnosis" label="Diagnosis" sort={sort} onSort={onSort} />
            <Th col="camera" label="Camera offline" sort={sort} onSort={onSort} className="vch-num" />
            <Th col="go" label="GO offline" sort={sort} onSort={onSort} className="vch-num" />
            <Th col="partner" label="Camera" sort={sort} onSort={onSort} />
            <th>Health errors</th>
            <Th col="snooze" label="Snooze" sort={sort} onSort={onSort} />
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={10} className="vch-empty-cell">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className={`vch-row vch-row-${r.diagnosis}${r.snoozeState === "active" ? " vch-row-snoozed" : ""}`}>
                <td className={`vch-num vch-worst ${!Number.isFinite(r.worstOfflineDays) ? "vch-off-never" : r.worstOfflineDays >= 14 ? "vch-off-bad" : r.worstOfflineDays >= 1 ? "vch-off-warn" : "vch-off-ok"}`}>
                  {formatOffline(r.worstOfflineDays)}
                </td>
                <td className="vch-asset">
                  {r.vehicleId && myGeotabBase && !r.vehicleArchived ? (
                    <a href={`${myGeotabBase}#device,id:${r.vehicleId}`} target="_blank" rel="noreferrer" title="Open in MyGeotab">
                      {r.vehicleName}
                    </a>
                  ) : (
                    <span>{r.vehicleName}</span>
                  )}
                  {r.goSerial ? <span className="vch-sub">{r.goSerial}</span> : null}
                </td>
                <td className="vch-site" title={r.groupNames.join(", ")}>
                  {r.site}
                </td>
                <td>
                  <span className={DIAG_CLASS[r.diagnosis]} title={DIAGNOSIS_HINT[r.diagnosis]}>
                    {DIAGNOSIS_LABEL[r.diagnosis]}
                  </span>
                  {r.diagnosis === "camera" && r.goActive ? (
                    <span className="vch-pill vch-pill-small vch-pill-ok" title="The GO device communicated recently — the vehicle is clearly in service.">
                      GO active
                    </span>
                  ) : null}
                </td>
                <OfflineCell days={r.cameraOfflineDays} iso={r.cameraLastOnline} missing="no camera" now={now} />
                <OfflineCell days={r.goOfflineDays} iso={r.goLastComm} missing="no GO" now={now} />
                <td className="vch-camera">
                  {r.cameraId ? (
                    <>
                      <span>{partnerLabel(r.partner)}</span>
                      <span className="vch-sub" title={r.cameraStatus ? `Status: ${r.cameraStatus}` : undefined}>
                        {r.cameraId}
                      </span>
                    </>
                  ) : (
                    <span className="vch-muted">—</span>
                  )}
                </td>
                <td className="vch-errors">
                  {r.healthErrors.length === 0 ? (
                    <span className="vch-muted">{r.cameraHealthStatus ?? "—"}</span>
                  ) : (
                    r.healthErrors.map((e) => (
                      <span key={e} className="vch-pill vch-pill-muted vch-pill-err" title={e}>
                        {humanizeCode(e)}
                      </span>
                    ))
                  )}
                </td>
                <td className="vch-snooze">
                  {r.snooze && r.snoozeState !== "none" ? (
                    <span
                      className={`vch-pill ${r.snoozeState === "active" ? "vch-pill-info" : r.snoozeState === "overridden" ? "vch-pill-bad" : "vch-pill-muted"}`}
                      title={`${SNOOZE_REASON_LABEL[r.snooze.reason]}${r.snooze.note ? ` — ${r.snooze.note}` : ""}\nBy ${r.snooze.by || "?"} on ${formatDateTime(r.snooze.at)}\nUntil ${formatDateTime(r.snooze.until)}`}
                    >
                      {r.snoozeState === "active"
                        ? `${SNOOZE_REASON_LABEL[r.snooze.reason]} · ${formatUntil(r.snooze.until, now)}`
                        : r.snoozeState === "overridden"
                          ? "Snooze overridden"
                          : "Snooze expired"}
                    </span>
                  ) : (
                    <span className="vch-muted">—</span>
                  )}
                </td>
                <td className="vch-actions">
                  {r.snoozeState === "active" ? (
                    <Button type="tertiary" onClick={() => onUnsnooze(r)} title="Remove the snooze so this row shows under Issues again">
                      Unsnooze
                    </Button>
                  ) : r.isIssue || r.diagnosis === "no-camera" ? (
                    <Button type="secondary" onClick={() => onSnooze(r)} title="Hide this vehicle from Issues for a while">
                      {r.snoozeState === "overridden" ? "Re-snooze" : "Snooze"}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
