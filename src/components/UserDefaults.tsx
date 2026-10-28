/**
 * Settings → User defaults. Admin picks a user, the group(s) the dashboard
 * should open to for them, and optionally a partner chip and starting tile.
 * One record per user (saving again replaces). Lives in AddInData.
 */

import { useMemo, useState } from "react";
import { Button } from "@geotab/zenith";
import type { GeotabGroup, GeotabUser, UserDefaultRecord } from "../types";
import { GroupFilterPicker } from "./GroupFilterPicker";
import { DIAGNOSIS_LABEL, partnerLabel } from "../utils/health";
import { formatDate } from "../utils/format";
import { normalizeUserName } from "../utils/defaults";

const VIEW_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Issues (default)" },
  { value: "camera", label: DIAGNOSIS_LABEL.camera },
  { value: "go", label: DIAGNOSIS_LABEL.go },
  { value: "both", label: DIAGNOSIS_LABEL.both },
  { value: "no-go", label: DIAGNOSIS_LABEL["no-go"] },
  { value: "no-camera", label: DIAGNOSIS_LABEL["no-camera"] },
  { value: "snoozed", label: "Snoozed" },
  { value: "all", label: "All" },
];

interface Props {
  groupsById: Map<string, GeotabGroup>;
  users: GeotabUser[] | null;
  usersError: string | null;
  partners: string[];
  defaults: UserDefaultRecord[];
  busy: boolean;
  canWrite: boolean;
  onSave: (rec: Omit<UserDefaultRecord, "id" | "kind" | "by" | "at">) => void;
  onRemove: (rec: UserDefaultRecord) => void;
}

export function UserDefaults({ groupsById, users, usersError, partners, defaults, busy, canWrite, onSave, onRemove }: Props) {
  const [userName, setUserName] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [partner, setPartner] = useState("");
  const [view, setView] = useState("");

  const groupName = (id: string) => groupsById.get(id)?.name ?? id;
  const u = normalizeUserName(userName);
  const known = users?.find((x) => normalizeUserName(x.name) === u) ?? null;
  const realGroups = groupIds.filter((g) => g !== "GroupCompanyId");
  const valid = u.includes("@") || known != null;
  const existing = defaults.find((d) => d.userName === u) ?? null;

  const sorted = useMemo(() => [...defaults].sort((a, b) => a.userName.localeCompare(b.userName)), [defaults]);

  const reset = () => {
    setUserName("");
    setGroupIds([]);
    setPartner("");
    setView("");
    setPickerKey((k) => k + 1);
  };

  const editRow = (d: UserDefaultRecord) => {
    setUserName(d.userName);
    setGroupIds(d.groupIds);
    setPartner(d.partner ?? "");
    setView(d.view ?? "");
    setPickerKey((k) => k + 1);
  };

  return (
    <div className="vch-userdefaults">
      <div className="vch-settings-head">
        <h3>User defaults</h3>
        <span className="vch-muted">What the dashboard opens to for a given user. Users can still change the filters after it loads.</span>
      </div>

      {!canWrite ? <p className="vch-note vch-note-warn">AddInData is not writable for this user, so defaults can't be saved from here.</p> : null}

      <div className="vch-ud-form">
        <div className="vch-field vch-ud-user">
          <label className="vch-field-label" htmlFor="vch-ud-username">
            User
          </label>
          <input
            id="vch-ud-username"
            className="vch-input"
            list="vch-ud-users"
            value={userName}
            placeholder={users ? "Start typing a name or email…" : usersError ? "Type the user's email" : "Loading users…"}
            onChange={(e) => setUserName(e.target.value)}
            autoComplete="off"
          />
          <datalist id="vch-ud-users">
            {(users ?? []).map((x) => (
              <option key={x.id} value={x.name}>
                {[x.firstName, x.lastName].filter(Boolean).join(" ")}
              </option>
            ))}
          </datalist>
          <span className="vch-field-hint">
            {known ? `${[known.firstName, known.lastName].filter(Boolean).join(" ") || known.name}${existing ? " — already has a default; saving replaces it" : ""}` : usersError ? `Could not list users (${usersError}) — enter the MyGeotab user name exactly.` : "MyGeotab user name (email)."}
          </span>
        </div>
        <div className="vch-field vch-ud-groups">
          <span className="vch-field-label">Open to group(s)</span>
          <div className="vch-groups-picker">
            <GroupFilterPicker key={pickerKey} groupsById={groupsById} initialGroupIds={groupIds.length ? groupIds : undefined} onChange={setGroupIds} />
          </div>
          <span className="vch-field-hint">{realGroups.length ? realGroups.map(groupName).join(", ") : "Whole company (use this to clear a group default but keep a partner/tile)."}</span>
        </div>
        <div className="vch-field">
          <label className="vch-field-label" htmlFor="vch-ud-partner">
            Camera chip
          </label>
          <select id="vch-ud-partner" className="vch-input" value={partner} onChange={(e) => setPartner(e.target.value)}>
            <option value="">All cameras</option>
            {partners.map((p) => (
              <option key={p} value={p}>
                {partnerLabel(p)}
              </option>
            ))}
            <option value="none">No camera</option>
          </select>
        </div>
        <div className="vch-field">
          <label className="vch-field-label" htmlFor="vch-ud-view">
            Starting tile
          </label>
          <select id="vch-ud-view" className="vch-input" value={view} onChange={(e) => setView(e.target.value)}>
            {VIEW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="vch-ud-actions">
          <Button type="tertiary" onClick={reset} disabled={busy}>
            Clear form
          </Button>
          <Button
            type="primary"
            disabled={!valid || !canWrite || busy || (realGroups.length === 0 && !partner && !view)}
            onClick={() => {
              onSave({ userName: u, groupIds: realGroups, partner: partner || undefined, view: view || undefined });
              reset();
            }}
          >
            {existing ? "Replace default" : "Save default"}
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="vch-muted">No user defaults yet.</p>
      ) : (
        <div className="vch-table-wrap">
          <table className="vch-table vch-ud-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Opens to</th>
                <th>Camera chip</th>
                <th>Tile</th>
                <th>Set by</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.id ?? d.userName}>
                  <td className="vch-asset">{d.userName}</td>
                  <td>{d.groupIds.length ? d.groupIds.map(groupName).join(", ") : <span className="vch-muted">Whole company</span>}</td>
                  <td>{d.partner ? (d.partner === "none" ? "No camera" : partnerLabel(d.partner)) : <span className="vch-muted">All</span>}</td>
                  <td>{VIEW_OPTIONS.find((o) => o.value === (d.view ?? ""))?.label ?? d.view}</td>
                  <td className="vch-muted">
                    {d.by || "—"}
                    <span className="vch-sub">{formatDate(d.at)}</span>
                  </td>
                  <td className="vch-actions">
                    <Button type="tertiary" onClick={() => editRow(d)} disabled={busy}>
                      Edit
                    </Button>
                    <Button type="tertiary-destructive" onClick={() => onRemove(d)} disabled={busy || !canWrite}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
