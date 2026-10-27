/** Display helpers. */

export function formatInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

/** "never", "42 min", "6 h", "3 d", "45 d" from a day count (Infinity = never). */
export function formatOffline(days: number | null | undefined): string {
  if (days == null) return "—";
  if (!Number.isFinite(days)) return "never";
  const h = days * 24;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(days)} d`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Never reported";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "in 3 d" / "expired" from an ISO expiry. */
export function formatUntil(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const days = (t - now.getTime()) / 86_400_000;
  if (days <= 0) return "expired";
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h left`;
  return `${Math.round(days)} d left`;
}

/** Split a CamelCase health-error code into words: CameraSdCardNotMounted → "Camera Sd Card Not Mounted". */
export function humanizeCode(code: string): string {
  return code
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2");
}
