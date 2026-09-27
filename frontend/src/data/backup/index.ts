export { APP_VERSION } from "./appVersion";
export { BACKUP_FORMAT, CURRENT_BACKUP_VERSION, backupEnvelopeSchema } from "./schema";
export type { BackupData, BackupEnvelope, BackupSession } from "./schema";
export { collectLocalData, serializeBackup } from "./serialize";
export type { SerializeOptions } from "./serialize";
export { migrateEnvelope, prepareImport } from "./prepare";
export type {
  BackupMigration,
  MigrateResult,
  PrepareFailure,
  PrepareOptions,
  PrepareResult,
  RawEnvelope,
} from "./prepare";
export { planMerge, planReplace } from "./plan";
export type { ImportMode, ImportStats, PreparedImport } from "./plan";
