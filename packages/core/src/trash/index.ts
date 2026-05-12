// Trash module — pure helpers for Pennivo Phase 13a soft-delete trash.
// No fs, no IPC, no React, no Electron. The desktop main process composes
// these helpers with disk I/O in trashStore.ts.

export type { TrashEntry } from "./types";
export { trashEntryDirName } from "./path";
export { computeExpiresAtMs, findExpired } from "./expiry";
export { pickRestorePath, type PickRestorePathOptions } from "./restore";
export { formatTrashExpiry } from "./display";
export {
  computeNextSelection,
  type MultiSelectInput,
} from "./multiSelect";
