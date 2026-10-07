import { getLocalDb, initLocalDb } from "../connection";
import type { LocalSessionRow } from "../types";

/** Persist non-secret session snapshot for offline shell. Never stores passwords. */
export async function saveLocalSession(input: {
  userId: string;
  profileId?: string | null;
  email?: string | null;
  fullName?: string | null;
  status?: string | null;
  schoolId?: string | null;
  schoolName?: string | null;
  roles?: string[];
  primaryRole?: string | null;
  accessTokenExpiresAt?: string | null;
  hasRefreshSession?: boolean;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  const db = (await initLocalDb())!;
  const rolesJson = JSON.stringify(input.roles ?? []);
  const payloadJson = input.payload ? JSON.stringify(input.payload) : null;
  await db.execute(
    `INSERT OR REPLACE INTO local_session (
      user_id, profile_id, email, full_name, status, school_id, school_name,
      roles_json, primary_role, access_token_expires_at, has_refresh_session,
      last_validated_at, payload_json, created_at, updated_at, sync_status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),'synced')`,
    [
      input.userId,
      input.profileId ?? null,
      input.email ?? null,
      input.fullName ?? null,
      input.status ?? null,
      input.schoolId ?? null,
      input.schoolName ?? null,
      rolesJson,
      input.primaryRole ?? null,
      input.accessTokenExpiresAt ?? null,
      input.hasRefreshSession ? 1 : 0,
      new Date().toISOString(),
      payloadJson,
    ],
  );
}

export async function getLocalSession(userId: string): Promise<LocalSessionRow | null> {
  const db = getLocalDb() || (await initLocalDb());
  if (!db) return null;
  const res = await db.execute(`SELECT * FROM local_session WHERE user_id = ?`, [userId]);
  return (res.rows[0] as LocalSessionRow) ?? null;
}

export async function clearLocalSession(userId?: string): Promise<void> {
  const db = getLocalDb() || (await initLocalDb());
  if (!db) return;
  if (userId) await db.execute(`DELETE FROM local_session WHERE user_id = ?`, [userId]);
  else await db.execute(`DELETE FROM local_session`);
}

export async function getLocalSessionByEmail(email: string): Promise<LocalSessionRow | null> {
  const db = getLocalDb() || (await initLocalDb());
  if (!db) return null;
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  const res = await db.execute(
    `SELECT * FROM local_session WHERE lower(coalesce(email,'')) = ? ORDER BY updated_at DESC LIMIT 1`,
    [e],
  );
  return (res.rows[0] as LocalSessionRow) ?? null;
}

export async function getMostRecentLocalSession(): Promise<LocalSessionRow | null> {
  const db = getLocalDb() || (await initLocalDb());
  if (!db) return null;
  const res = await db.execute(
    `SELECT * FROM local_session ORDER BY updated_at DESC LIMIT 1`,
  );
  return (res.rows[0] as LocalSessionRow) ?? null;
}
