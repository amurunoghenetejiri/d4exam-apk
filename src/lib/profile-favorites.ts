/**
 * Account-specific favorites (local, offline-safe).
 * Keyed by current user id so favorites never leak across accounts.
 */

const prefix = "d4exam_favorites_v1:";

function key(myUserId: string) {
  return `${prefix}${myUserId}`;
}

function read(myUserId: string): string[] {
  if (typeof window === "undefined" || !myUserId) return [];
  try {
    const raw = window.localStorage.getItem(key(myUserId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function write(myUserId: string, ids: string[]) {
  if (typeof window === "undefined" || !myUserId) return;
  try {
    window.localStorage.setItem(key(myUserId), JSON.stringify([...new Set(ids)]));
  } catch {
    /* quota */
  }
}

export function isFavorite(myUserId: string, peerId: string): boolean {
  if (!myUserId || !peerId) return false;
  return read(myUserId).includes(peerId);
}

export function listFavorites(myUserId: string): string[] {
  return read(myUserId);
}

/** Returns the new favorite state after toggle. */
export function toggleFavorite(myUserId: string, peerId: string): boolean {
  if (!myUserId || !peerId) return false;
  const cur = read(myUserId);
  const has = cur.includes(peerId);
  if (has) {
    write(
      myUserId,
      cur.filter((id) => id !== peerId),
    );
    return false;
  }
  write(myUserId, [...cur, peerId]);
  return true;
}
