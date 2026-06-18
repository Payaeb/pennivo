// Device identity — stable random UUID stored at <userData>/device.json,
// memoized after first read. The user-facing display name defaults to the
// OS hostname and is overridable via `recovery.deviceName` in settings.
//
// No telemetry, no MAC address, no machine fingerprint. The id is purely a
// local identifier so the snapshot timeline can label cross-device entries
// once Phase 13b ships.

import { randomUUID } from "node:crypto";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import type { RecoverySettings } from "@pennivo/core";

export interface DeviceRecord {
  deviceId: string;
  createdAt: number;
}

/**
 * Pure load-or-create — extracted so unit tests can swap the read/write
 * pair for in-memory mocks without touching the real fs. The host calls
 * `loadOrCreate(read, write, generate)` with bound implementations.
 *
 * - `read()` resolves to the existing record (if any), or `null` for "no file".
 *   May reject for other I/O errors; we treat any rejection as `null` and
 *   write a fresh record (consistent with how the rest of the app handles
 *   corrupt JSON files).
 * - `write(record)` persists the record.
 * - `generate()` returns a fresh `{ deviceId, createdAt }`.
 *
 * Returns the resolved record. Side-effects are confined to the supplied
 * callbacks.
 */
export async function loadOrCreateDeviceRecord(
  read: () => Promise<DeviceRecord | null>,
  write: (record: DeviceRecord) => Promise<void>,
  generate: () => DeviceRecord,
): Promise<DeviceRecord> {
  let existing: DeviceRecord | null;
  try {
    existing = await read();
  } catch {
    existing = null;
  }
  if (
    existing &&
    typeof existing.deviceId === "string" &&
    existing.deviceId.length > 0
  ) {
    return existing;
  }
  const fresh = generate();
  await write(fresh);
  return fresh;
}

let memoizedRecord: DeviceRecord | null = null;

/**
 * Resolve `<userData>/device.json` — load the existing device record or
 * generate one and persist it. Memoized after first call. Errors during the
 * persistence write are swallowed (logged) so an unwritable userData dir
 * doesn't block the entire app from loading.
 */
export async function getDeviceRecord(
  userDataDir: string,
): Promise<DeviceRecord> {
  if (memoizedRecord) return memoizedRecord;
  const filePath = path.join(userDataDir, "device.json");

  const read = async (): Promise<DeviceRecord | null> => {
    try {
      const data = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(data) as DeviceRecord;
      return parsed;
    } catch {
      return null;
    }
  };
  const write = async (rec: DeviceRecord): Promise<void> => {
    try {
      await fs.writeFile(filePath, JSON.stringify(rec, null, 2), "utf-8");
    } catch (err) {
      console.error("[deviceIdentity] failed to write device.json:", err);
    }
  };
  const generate = (): DeviceRecord => ({
    deviceId: randomUUID(),
    createdAt: Date.now(),
  });

  memoizedRecord = await loadOrCreateDeviceRecord(read, write, generate);
  return memoizedRecord;
}

/**
 * Synchronous accessor — returns the memoized id or empty string if
 * `getDeviceRecord` hasn't completed yet. Used by the snapshot writer in
 * synchronous code paths after `app.whenReady` (where the record is always
 * loaded).
 */
export function getDeviceIdSync(): string {
  return memoizedRecord?.deviceId ?? "";
}

/**
 * Display name = user override if set, else the OS hostname.
 */
export function getDeviceName(settings: { deviceName?: string }): string {
  if (settings.deviceName && settings.deviceName.trim().length > 0) {
    return settings.deviceName.trim();
  }
  return os.hostname();
}

/**
 * Test-only: clear the memo so independent tests can re-initialize. Not
 * exported through any public API surface.
 */
export function _resetDeviceIdentityForTests(): void {
  memoizedRecord = null;
}

/**
 * Convenience accessor for callers that have a `RecoverySettings`-shaped
 * object. Avoids leaking the full settings type into deviceIdentity's
 * surface — only `deviceName` matters here.
 */
export function deviceNameFromSettings(settings: RecoverySettings): string {
  return getDeviceName({ deviceName: settings.deviceName });
}
