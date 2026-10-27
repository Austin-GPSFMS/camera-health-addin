/** KPI strip — Zenith SummaryTiles that double as the view filter. */

import { SummaryTile, SummaryTileBar, SummaryTileType } from "@geotab/zenith";
import type { Settings } from "../types";
import type { Counts, ViewFilter } from "../utils/health";
import { formatInt } from "../utils/format";

interface SummaryProps {
  counts: Counts;
  settings: Settings;
  active: ViewFilter;
  onPick: (v: ViewFilter) => void;
}

export function Summary({ counts, settings, active, onPick }: SummaryProps) {
  const tile = (v: ViewFilter) => (active === v ? SummaryTileType.Active : SummaryTileType.Default);
  const T = settings.viewThresholdDays;
  return (
    <div className="vch-summary">
      <SummaryTileBar aria-label="Health summary">
        <SummaryTile
          title={`Issues (≥ ${T} d)`}
          tileType={tile("issues")}
          onClick={() => onPick("issues")}
          tooltipText={`Everything needing attention, minus active snoozes. Snoozes past the ${settings.hardLimitDays}-day hard limit are included.`}
        >
          <span className="vch-tile-value vch-tile-bad">{formatInt(counts.issues)}</span>
        </SummaryTile>
        <SummaryTile title="Camera issue" tileType={tile("camera")} onClick={() => onPick("camera")} tooltipText="Camera silent, GO device still reporting.">
          <span className="vch-tile-value vch-tile-bad">{formatInt(counts.camera)}</span>
        </SummaryTile>
        <SummaryTile title="GO issue" tileType={tile("go")} onClick={() => onPick("go")} tooltipText="GO device silent, camera still reporting.">
          <span className="vch-tile-value vch-tile-bad">{formatInt(counts.go)}</span>
        </SummaryTile>
        <SummaryTile title="Both silent" tileType={tile("both")} onClick={() => onPick("both")} tooltipText="Neither device has reported — usually parked / powered down.">
          <span className="vch-tile-value vch-tile-warn">{formatInt(counts.both)}</span>
        </SummaryTile>
        <SummaryTile title="No GO paired" tileType={tile("no-go")} onClick={() => onPick("no-go")} tooltipText="Camera pairing with no matching active GO device.">
          <span className="vch-tile-value vch-tile-warn">{formatInt(counts.noGo)}</span>
        </SummaryTile>
        <SummaryTile
          title="No camera paired"
          tileType={tile("no-camera")}
          onClick={() => onPick("no-camera")}
          tooltipText={settings.noCameraIsIssue ? "Active vehicles with no camera pairing (counted as issues)." : "Active vehicles with no camera pairing (not counted as issues — change in Settings)."}
        >
          <span className="vch-tile-value vch-tile-muted">{formatInt(counts.noCamera)}</span>
        </SummaryTile>
        <SummaryTile
          title="Snoozed"
          tileType={tile("snoozed")}
          onClick={() => onPick("snoozed")}
          tooltipText={counts.overridden > 0 ? `${counts.overridden} more snooze${counts.overridden === 1 ? "" : "s"} overridden by the ${settings.hardLimitDays}-day hard limit — shown under Issues.` : "Hidden from Issues until the snooze expires."}
        >
          <span className="vch-tile-value vch-tile-info">{formatInt(counts.snoozed)}</span>
        </SummaryTile>
        <SummaryTile title="OK" tileType={tile("ok")} onClick={() => onPick("ok")}>
          <span className="vch-tile-value vch-tile-ok">{formatInt(counts.ok)}</span>
        </SummaryTile>
        <SummaryTile title="All" tileType={tile("all")} onClick={() => onPick("all")}>
          <span className="vch-tile-value">{formatInt(counts.all)}</span>
        </SummaryTile>
      </SummaryTileBar>
    </div>
  );
}
