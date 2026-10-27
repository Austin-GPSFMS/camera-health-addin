/** Settings — shared per database (AddInData). Threshold, hard limit, GO-active window, no-camera policy. */

import { useEffect, useState } from "react";
import { Button } from "@geotab/zenith";
import type { Settings } from "../types";
import { DEFAULT_SETTINGS, clampSettings } from "../utils/health";

interface Props {
  settings: Settings;
  savedBy: string | null;
  busy: boolean;
  shared: boolean;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export function SettingsPanel({ settings, savedBy, busy, shared, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  useEffect(() => setDraft(settings), [settings]);

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }));
  const clamped = clampSettings(draft);
  const limitRaised = clamped.hardLimitDays !== draft.hardLimitDays;

  return (
    <div className="vch-settings">
      <div className="vch-settings-head">
        <h3>Settings</h3>
        <span className="vch-muted">
          {shared ? "Shared with everyone on this database" : "Saved in this browser only (AddInData unavailable)"}
          {savedBy ? ` · last saved by ${savedBy}` : ""}
        </span>
      </div>
      <div className="vch-settings-grid">
        <div className="vch-field">
          <label className="vch-field-label" htmlFor="vch-s-threshold">
            Offline threshold (days)
          </label>
          <input id="vch-s-threshold" className="vch-input" type="number" min={0} max={365} value={draft.viewThresholdDays} onChange={num("viewThresholdDays")} />
          <span className="vch-field-hint">A camera or GO silent for at least this long is an issue. Default 14.</span>
        </div>
        <div className="vch-field">
          <label className="vch-field-label" htmlFor="vch-s-limit">
            Hard limit (days)
          </label>
          <input id="vch-s-limit" className="vch-input" type="number" min={1} max={730} value={draft.hardLimitDays} onChange={num("hardLimitDays")} />
          <span className="vch-field-hint">
            A snoozed vehicle shows anyway once either device has been offline this long. Default 45.
            {limitRaised ? ` Will be saved as ${clamped.hardLimitDays} (cannot be below the threshold).` : ""}
          </span>
        </div>
        <div className="vch-field">
          <label className="vch-field-label" htmlFor="vch-s-active">
            GO counts as active within (hours)
          </label>
          <input id="vch-s-active" className="vch-input" type="number" min={1} max={720} value={draft.goActiveHours} onChange={num("goActiveHours")} />
          <span className="vch-field-hint">Marks "Camera issue" rows with a GO active badge when the truck is clearly in service. Default 24.</span>
        </div>
        <div className="vch-field">
          <label className="vch-toggle">
            <input type="checkbox" checked={draft.noCameraIsIssue} onChange={(e) => setDraft((d) => ({ ...d, noCameraIsIssue: e.target.checked }))} />
            Count vehicles with no camera paired as issues
          </label>
          <span className="vch-field-hint">On for an all-camera fleet; off for mixed fleets where most trucks have no camera.</span>
        </div>
      </div>
      <div className="vch-settings-foot">
        <Button type="tertiary" onClick={() => setDraft(DEFAULT_SETTINGS)} disabled={busy}>
          Reset to defaults
        </Button>
        <span className="vch-spacer" />
        <Button type="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="primary" onClick={() => onSave(clamped)} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
