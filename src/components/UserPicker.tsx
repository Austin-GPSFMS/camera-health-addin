/**
 * Typeahead for a MyGeotab user. Replaces a native <datalist>, which Chrome
 * shows inconsistently inside the MyGeotab page and which gives no feedback
 * when nothing matches. Filters on email, first and last name; Enter / click
 * selects; Esc closes. The free-typed value is kept so an email that isn't
 * in the list (or a user the list call couldn't load) can still be saved.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeotabUser } from "../types";

interface Props {
  id: string;
  value: string;
  users: GeotabUser[] | null;
  usersError: string | null;
  onChange: (value: string) => void;
}

const MAX_SHOWN = 12;

function fullName(u: GeotabUser): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ");
}

export function matchUsers(users: GeotabUser[], query: string): GeotabUser[] {
  const q = query.trim().toLowerCase();
  if (!q) return users.slice(0, MAX_SHOWN);
  const terms = q.split(/\s+/);
  const hay = (u: GeotabUser) => `${u.name} ${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
  const scored = users
    .map((u) => {
      const h = hay(u);
      if (!terms.every((t) => h.includes(t))) return null;
      // Rank: email/last-name prefix matches first, then anything containing the terms.
      const first = terms[0];
      const score =
        u.name.toLowerCase().startsWith(first) || (u.lastName ?? "").toLowerCase().startsWith(first) || (u.firstName ?? "").toLowerCase().startsWith(first)
          ? 0
          : 1;
      return { u, score };
    })
    .filter((x): x is { u: GeotabUser; score: number } => x != null)
    .sort((a, b) => a.score - b.score || a.u.name.localeCompare(b.u.name));
  return scored.slice(0, MAX_SHOWN).map((x) => x.u);
}

export function UserPicker({ id, value, users, usersError, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => (users ? matchUsers(users, value) : []), [users, value]);

  useEffect(() => setActive(0), [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (u: GeotabUser) => {
    onChange(u.name);
    setOpen(false);
  };

  const hint = usersError
    ? `Could not list users (${usersError}) — type the MyGeotab user name (email) exactly.`
    : users == null
      ? "Loading users…"
      : users.length === 0
        ? "The user list came back empty — type the MyGeotab user name (email) exactly."
        : value.trim() && matches.length === 0
          ? `No match among ${users.length.toLocaleString()} users — the email can still be saved as typed.`
          : `${users.length.toLocaleString()} users loaded — search by name or email.`;

  return (
    <div className="vch-typeahead" ref={wrapRef}>
      <div className="vch-typeahead-anchor">
      <input
        id={id}
        className="vch-input"
        value={value}
        placeholder={users ? "Start typing a name or email…" : usersError ? "Type the user's email" : "Loading users…"}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) {
            if (e.key === "ArrowDown") setOpen(true);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(matches.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 ? (
        <ul className="vch-typeahead-list" id={`${id}-list`} role="listbox">
          {matches.map((u, i) => (
            <li
              key={u.id}
              role="option"
              aria-selected={i === active}
              className={`vch-typeahead-item${i === active ? " vch-typeahead-item--active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(u)}
            >
              <span className="vch-typeahead-name">{fullName(u) || u.name}</span>
              <span className="vch-typeahead-email">
                {u.name}
                {u.isDriver ? <span className="vch-pill vch-pill-small vch-pill-muted">driver</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      </div>
      <span className="vch-field-hint">{hint}</span>
    </div>
  );
}
