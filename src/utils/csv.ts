/** CSV export of the rows currently shown (same column order as the table). */

import type { HealthRow } from "../types";
import { DIAGNOSIS_LABEL, SNOOZE_REASON_LABEL, partnerLabel } from "./health";

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function days(n: number | null): string {
  if (n == null) return "";
  if (!Number.isFinite(n)) return "never";
  return (Math.round(n * 10) / 10).toString();
}

export function rowsToCsv(rows: HealthRow[]): string {
  const header = [
    "Vehicle",
    "Site",
    "Groups",
    "GO serial",
    "Camera id",
    "Camera partner",
    "Diagnosis",
    "Worst offline (days)",
    "Camera offline (days)",
    "Camera last online (UTC)",
    "GO offline (days)",
    "GO last communication (UTC)",
    "Camera status",
    "Camera health",
    "Health errors",
    "Snooze state",
    "Snooze reason",
    "Snooze until (UTC)",
    "Snoozed by",
    "Snooze note",
  ];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.vehicleName,
        r.site,
        r.groupNames.join("; "),
        r.goSerial ?? "",
        r.cameraId ?? "",
        partnerLabel(r.partner),
        DIAGNOSIS_LABEL[r.diagnosis],
        days(r.worstOfflineDays),
        days(r.cameraOfflineDays),
        r.cameraLastOnline ?? "",
        days(r.goOfflineDays),
        r.goLastComm ?? "",
        r.cameraStatus ?? "",
        r.cameraHealthStatus ?? "",
        r.healthErrors.join("; "),
        r.snoozeState,
        r.snooze ? SNOOZE_REASON_LABEL[r.snooze.reason] : "",
        r.snooze?.until ?? "",
        r.snooze?.by ?? "",
        r.snooze?.note ?? "",
      ]
        .map(cell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
