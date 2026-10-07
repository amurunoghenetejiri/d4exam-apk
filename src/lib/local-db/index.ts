/**
 * D4EXAM local database foundation (Step 2 + Step 3 mirror).
 *
 * UI → repositories → local SQLite (native) / memory (web)
 * Remote Supabase remains the source of truth (sync engine = later step).
 */

export { LOCAL_DB_NAME, LOCAL_DB_VERSION, LOCAL_SCHEMA_SQL } from "./schema";
export type { SyncStatus } from "./schema";
export type { LocalDbCapability, LocalSessionRow, OutboxRow, OutboxOperation } from "./types";
export {
  initLocalDb,
  getLocalDb,
  getLocalDbCapability,
  __resetLocalDbForTests,
} from "./connection";
export type { LocalDbExecutor, SqlResult } from "./connection";

export { saveLocalSession, getLocalSession,
  getLocalSessionByEmail,
  getMostRecentLocalSession, clearLocalSession } from "./repositories/sessionRepo";
export {
  upsertLocalEntity,
  getLocalEntityById,
  listLocalByUser,
} from "./repositories/entityRepo";
export {
  enqueueOutbox,
  listPendingOutbox,
  markOutboxStatus,
  setSyncCursor,
  getSyncCursor,
} from "./repositories/outboxRepo";

export {
  mirrorOfflineBlob,
  readOfflineBlob,
  mirrorSessionUser,
  mirrorExaminations,
  mirrorNotifications,
  mirrorResults,
  mirrorByOfflineKey,
} from "./mirror";
