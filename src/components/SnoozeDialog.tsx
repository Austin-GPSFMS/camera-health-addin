/** Snooze dialog — preset durations (7/14/30 d) or a custom number of days, a reason and a note. */

import { useEffect, useState } from "react";
import { Modal } from "@geotab/zenith";
import type { HealthRow, Settings, SnoozeReason } from "../types";
import { SNOOZE_PRESET_DAYS, SNOOZE_REASON_LABEL } from "../utils/health";
import { formatOffline } from "../utils/format";

export interface SnoozeChoice {
  days: number;
  reason: SnoozeReason;
  note: string;
}

interface Props {
  row: HealthRow | null;
  settings: Settings;
  busy: boolean;
  onConfirm: (choice: SnoozeChoice) => void;
  onClose: () => void;
}

export function SnoozeDialog({ row, settings, busy, onConfirm, onClose }: Props) {
  const [days, setDays] = useState<number>(7);
  const [custom, setCustom] = useState<string>("");
  const [useCustom, setUseCustom] = useState(false);
  const [reason, setReason] = useState<SnoozeReason>("spare");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (row) {
      setDays(7);
      setCustom("");
      setUseCustom(false);
      setReason(row.diagnosis === "no-go" ? "other" : "spare");
      setNote("");
    }
  }, [row]);

  const effectiveDays = useCustom ? Number(custom) : days;
  const valid = Number.isFinite(effectiveDays) && effectiveDays >= 1 && effectiveDays <= 365;

  const worst = row ? row.worstOfflineDays : 0;
  const willOverride = row != null && Number.isFinite(worst) && worst >= settings.hardLimitDays;
  const daysUntilLimit = row != null && Number.isFinite(worst) ? Math.max(0, settings.hardLimitDays - worst) : null;
  const limitBeforeExpiry = daysUntilLimit != null && valid && daysUntilLimit < effectiveDays;

  return (
    <Modal isOpen={row != null} onClose={onClose} title={row ? `Snooze ${row.vehicleName}` : "Snooze"} maxWidth="520px" closeOnClickOutside={false}>
      <Modal.Content>
        {row ? (
          <div className="vch-dialog">
            <p className="vch-muted">
              Hides this {row.cameraId && row.vehicleId ? "vehicle (camera and GO together)" : row.cameraId ? "camera" : "vehicle"} from Issues
              for everyone on this database. It comes back when the snooze expires, or sooner if either device passes the{" "}
              <strong>{settings.hardLimitDays}-day</strong> hard limit. Currently offline: <strong>{formatOffline(worst)}</strong>.
            </p>

            <div className="vch-field">
              <span className="vch-field-label">Duration</span>
              <div className="vch-seg">
                {SNOOZE_PRESET_DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`vch-seg-btn${!useCustom && days === d ? " vch-seg-btn--on" : ""}`}
                    onClick={() => {
                      setUseCustom(false);
                      setDays(d);
                    }}
                  >
                    {d} days
                  </button>
                ))}
                <button type="button" className={`vch-seg-btn${useCustom ? " vch-seg-btn--on" : ""}`} onClick={() => setUseCustom(true)}>
                  Custom
                </button>
                {useCustom ? (
                  <input
                    className="vch-input vch-input-sm"
                    type="number"
                    min={1}
                    max={365}
                    value={custom}
                    placeholder="days"
                    autoFocus
                    onChange={(e) => setCustom(e.target.value)}
                  />
                ) : null}
              </div>
            </div>

            <div className="vch-field">
              <label className="vch-field-label" htmlFor="vch-snooze-reason">
                Reason
              </label>
              <select id="vch-snooze-reason" className="vch-input" value={reason} onChange={(e) => setReason(e.target.value as SnoozeReason)}>
                {(Object.keys(SNOOZE_REASON_LABEL) as SnoozeReason[]).map((k) => (
                  <option key={k} value={k}>
                    {SNOOZE_REASON_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>

            <div className="vch-field">
              <label className="vch-field-label" htmlFor="vch-snooze-note">
                Note (optional)
              </label>
              <input id="vch-snooze-note" className="vch-input" value={note} maxLength={200} placeholder="e.g. spare at Citrus yard until the new truck lands" onChange={(e) => setNote(e.target.value)} />
            </div>

            {willOverride ? (
              <p className="vch-note vch-note-warn">
                This one is already past the {settings.hardLimitDays}-day hard limit, so snoozing won't hide it. Raise the hard limit in Settings if it really should be quiet.
              </p>
            ) : limitBeforeExpiry ? (
              <p className="vch-note">
                Heads-up: it reaches the {settings.hardLimitDays}-day hard limit in about {Math.ceil(daysUntilLimit!)} day{Math.ceil(daysUntilLimit!) === 1 ? "" : "s"} and will reappear then, before this snooze expires.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal.Content>
      <Modal.SecondaryButton onClick={onClose} disabled={busy}>
        Cancel
      </Modal.SecondaryButton>
      <Modal.PrimaryButton onClick={() => valid && onConfirm({ days: effectiveDays, reason, note: note.trim() })} disabled={!valid || busy}>
        {busy ? "Saving…" : `Snooze ${valid ? `${effectiveDays} d` : ""}`}
      </Modal.PrimaryButton>
    </Modal>
  );
}
