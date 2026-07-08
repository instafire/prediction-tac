/** Local journal of user actions (demo + live). */

export interface TxEntry {
  id: string;
  t: number;
  kind: string;
  label: string;
  detail?: string;
  ok: boolean;
}

const KEY = "ptac-tx-journal";
const MAX = 80;

export function loadJournal(): TxEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function pushJournal(entry: Omit<TxEntry, "id" | "t"> & { t?: number }): TxEntry[] {
  const full: TxEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    t: entry.t ?? Math.floor(Date.now() / 1000),
    kind: entry.kind,
    label: entry.label,
    detail: entry.detail,
    ok: entry.ok,
  };
  const next = [full, ...loadJournal()].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* noop */ }
  return next;
}

export function clearJournal() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* noop */ }
}
