/**
 * Pure helpers for the per-user default view. Resolution order on load:
 *   1. an admin-assigned UserDefaultRecord for the signed-in user
 *   2. MyGeotab's own header group filter (state.getGroupFilter)
 *   3. the whole company
 */

import type { UserDefaultRecord } from "../types";

export interface InitialFilter {
  groupIds: string[];
  partner: string | null;
  view: string | null;
  source: "user-default" | "mygeotab-filter" | "company";
}

export function normalizeUserName(u: string | null | undefined): string {
  return (u ?? "").trim().toLowerCase();
}

export function findUserDefault(defaults: UserDefaultRecord[], userName: string | null | undefined): UserDefaultRecord | null {
  const u = normalizeUserName(userName);
  if (!u) return null;
  let best: UserDefaultRecord | null = null;
  for (const d of defaults) {
    if (normalizeUserName(d.userName) !== u) continue;
    if (!best || d.at > best.at) best = d;
  }
  return best;
}

/** Group ids out of whatever shape MyGeotab's group filter hands back. */
export function groupIdsFromPageFilter(raw: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (!v) return;
    if (typeof v === "string") {
      out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.id === "string") out.push(o.id);
      if (Array.isArray(o.groups)) walk(o.groups);
      if (Array.isArray(o.items)) walk(o.items);
    }
  };
  walk(raw);
  const ids = [...new Set(out)];
  // A filter that is just the company root is the same as no filter.
  return ids.length === 1 && ids[0] === "GroupCompanyId" ? [] : ids;
}

export function resolveInitialFilter(
  defaults: UserDefaultRecord[],
  userName: string | null | undefined,
  pageFilter: unknown,
  knownGroupIds: Set<string>
): InitialFilter {
  const d = findUserDefault(defaults, userName);
  if (d) {
    const ids = d.groupIds.filter((g) => knownGroupIds.has(g));
    if (ids.length > 0 || d.partner || d.view) {
      return { groupIds: ids, partner: d.partner ?? null, view: d.view ?? null, source: "user-default" };
    }
  }
  const fromPage = groupIdsFromPageFilter(pageFilter).filter((g) => knownGroupIds.has(g));
  if (fromPage.length > 0) return { groupIds: fromPage, partner: null, view: null, source: "mygeotab-filter" };
  return { groupIds: [], partner: null, view: null, source: "company" };
}
