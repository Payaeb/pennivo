// Pure data shapes for the soft-delete trash module (Phase 13a).
//
// Trash entries live on disk under <userData>/trash/<id>/ where the id is the
// trash directory name itself. Keeping the id == directory name means the
// only source of truth for "what trash entries exist" is the filesystem; we
// don't need a separate index file that could drift.

/**
 * One soft-deleted file in the trash. The on-disk representation is:
 *
 *   <userData>/trash/<id>/
 *     content.md          -- the file's bytes at the moment of delete
 *     meta.json           -- this shape (sans `id` — the dir name carries it)
 *     assets/             -- optional, present when hasAssets === true
 *       <assetFolderName>/  -- one per moved *-md-images folder
 *         ...image files...
 */
export interface TrashEntry {
  /** The trash directory name: `<sha1(absPath)>-<deletedAtMs>`. */
  id: string;
  /** Original absolute path the file lived at when it was deleted. */
  absolutePath: string;
  /** Original file basename (e.g. `notes.md`). Cached for cheap UI listing. */
  fileBasename: string;
  /** Wall-clock ms when the soft-delete happened. */
  deletedAtMs: number;
  /**
   * Wall-clock ms after which the entry is eligible for permanent removal,
   * or `null` for "Forever" retention.
   */
  expiresAtMs: number | null;
  /** Whether the entry carries one or more asset folders under `assets/`. */
  hasAssets: boolean;
  /** Names of the asset folders preserved (one entry per `*-md-images`). */
  assetFolderNames: string[];
  /** Stable id of the device that performed the delete. */
  deletedByDeviceId?: string;
  /** Display name of the device that performed the delete. */
  deletedByDeviceName?: string;
}
