import { useEffect, useState, useCallback, useRef } from "react";
import {
  applyArchiveDefaults,
  formatTierAgeRange,
  insertTier,
  removeTier,
  setTierGranularity,
  tierAgeToMs,
  type RecoverySettings,
  type RetentionGranularity,
  type TierAgeUnit,
  type TierDestinationConfig,
  type StorageDestination,
} from "@pennivo/core";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { getPlatform } from "../../platform";
import "./RecoverySection.css";

interface RecoverySectionProps {
  /** Initial recovery settings — caller hands us a fully-populated shape. */
  initial: RecoverySettings;
  /** Persist a partial update; caller merges + writes through `settings:set`. */
  onChange: (update: Partial<RecoverySettings>) => void;
  /**
   * Surface a transient toast (e.g. "Snapshots cleared", or an error). Same
   * channel SettingsPanel exposes.
   */
  onShowToast?: (message: string, isError?: boolean) => void;
  /**
   * When a parent prop set asks the section to highlight retention rules
   * (from a "Change rules" deep-link), pass `true`. The section animates a
   * highlight class on the retention table for ~1.5s then auto-clears.
   */
  highlightRetention?: boolean;
}

const STORAGE_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: "50 MB", value: 50 * 1024 * 1024 },
  { label: "200 MB", value: 200 * 1024 * 1024 },
  { label: "500 MB", value: 500 * 1024 * 1024 },
  { label: "1 GB", value: 1024 * 1024 * 1024 },
  { label: "Unlimited", value: null },
];

const TRASH_RETENTION_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "365 days", value: 365 },
  // -1 marks "Forever" — the trash store treats anything < 0 the same as
  // "never expire". The literal value we encode here is the canonical sentinel.
  { label: "Forever", value: -1 },
];

const GRANULARITY_OPTIONS: Array<{
  label: string;
  value: RetentionGranularity;
}> = [
  { label: "Every save", value: "every" },
  { label: "Hourly", value: "hourly" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Yearly", value: "yearly" },
  { label: "Keep forever", value: "forever" },
  { label: "Off", value: "off" },
];

const AGE_UNIT_OPTIONS: TierAgeUnit[] = [
  "hours",
  "days",
  "weeks",
  "months",
  "years",
];

/**
 * `RecoverySection` — Settings → Recovery body. See
 * docs/file-recovery-ui-design.md §2.5.
 */
export function RecoverySection({
  initial,
  onChange,
  onShowToast,
  highlightRetention,
}: RecoverySectionProps) {
  const platform = getPlatform();
  const [settings, setSettings] = useState<RecoverySettings>(initial);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [showAddTier, setShowAddTier] = useState(false);
  const [pendingClearAll, setPendingClearAll] = useState(false);
  const [highlightOn, setHighlightOn] = useState(false);
  const retentionTableRef = useRef<HTMLDivElement>(null);

  // Whenever the parent hands a fresh `initial` (e.g. dialog reopened), sync.
  useEffect(() => {
    setSettings(initial);
  }, [initial]);

  // Pull current local-store usage on mount + after Clear-all.
  const refreshUsage = useCallback(async () => {
    try {
      const res = await platform.snapshot.getStorageUsage();
      setStorageBytes(res?.bytes ?? 0);
    } catch {
      setStorageBytes(0);
    }
  }, [platform]);
  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  // Highlight retention rules when the deep-link prop flips on.
  useEffect(() => {
    if (!highlightRetention) return;
    setHighlightOn(true);
    // Scroll the table into view first.
    retentionTableRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    const id = setTimeout(() => setHighlightOn(false), 1500);
    return () => clearTimeout(id);
  }, [highlightRetention]);

  // Helper: persist any partial update.
  const update = useCallback(
    (patch: Partial<RecoverySettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      onChange(patch);
    },
    [settings, onChange],
  );

  // ----- Retention tier editor helpers -----

  const handleGranularityChange = useCallback(
    (tierIndex: number, granularity: RetentionGranularity) => {
      const policy = setTierGranularity(
        settings.retentionPolicy,
        tierIndex,
        granularity,
      );
      update({ retentionPolicy: policy });
    },
    [settings.retentionPolicy, update],
  );

  const handleRemoveTier = useCallback(
    (tierIndex: number) => {
      const { policy, destinations } = removeTier(
        settings.retentionPolicy,
        settings.tierDestinations,
        tierIndex,
      );
      update({ retentionPolicy: policy, tierDestinations: destinations });
    },
    [settings.retentionPolicy, settings.tierDestinations, update],
  );

  const handleAddTier = useCallback(
    (count: number, unit: TierAgeUnit, granularity: RetentionGranularity) => {
      const { policy, destinations } = insertTier(
        settings.retentionPolicy,
        settings.tierDestinations,
        { maxAgeMs: tierAgeToMs(count, unit), granularity },
      );
      update({ retentionPolicy: policy, tierDestinations: destinations });
      setShowAddTier(false);
    },
    [settings.retentionPolicy, settings.tierDestinations, update],
  );

  // ----- Per-tier routing helpers -----

  const handleDestinationChange = useCallback(
    (tierIndex: number, dest: "local" | "archive" | "both") => {
      const next: TierDestinationConfig[] = settings.tierDestinations.map(
        (t) => {
          if (t.tierIndex !== tierIndex) return t;
          let destinations: StorageDestination[];
          if (dest === "local") destinations = ["local"];
          else if (dest === "archive") destinations = ["archive"];
          else destinations = ["local", "archive"];
          return { ...t, destinations };
        },
      );
      update({ tierDestinations: next });
    },
    [settings.tierDestinations, update],
  );

  // ----- Archive folder picker -----

  const handlePickArchiveFolder = useCallback(async () => {
    const chosen = await platform.openFolderDialog();
    if (!chosen) return;
    // Apply daily-and-older defaults when the folder is set for the first time.
    const wasUnset = !settings.archiveFolder;
    const next: RecoverySettings = { ...settings, archiveFolder: chosen };
    if (wasUnset) {
      next.tierDestinations = applyArchiveDefaults(next);
    }
    setSettings(next);
    onChange({
      archiveFolder: chosen,
      tierDestinations: next.tierDestinations,
    });
  }, [platform, settings, onChange]);

  const handleRemoveArchiveFolder = useCallback(() => {
    const next: RecoverySettings = { ...settings, archiveFolder: undefined };
    setSettings(next);
    onChange({ archiveFolder: undefined });
  }, [settings, onChange]);

  // ----- Storage / device / open / clear -----

  const handleOpenSnapshotFolder = useCallback(async () => {
    try {
      const ok = await platform.snapshot.openFolder();
      if (!ok) onShowToast?.("Could not open snapshot folder.", true);
    } catch {
      onShowToast?.("Could not open snapshot folder.", true);
    }
  }, [platform, onShowToast]);

  const confirmClearAll = useCallback(async () => {
    setPendingClearAll(false);
    try {
      const ok = await platform.snapshot.clearAll();
      if (ok) {
        onShowToast?.("All snapshots cleared.");
        await refreshUsage();
      } else {
        onShowToast?.("Could not clear snapshots.", true);
      }
    } catch {
      onShowToast?.("Could not clear snapshots.", true);
    }
  }, [platform, onShowToast, refreshUsage]);

  const policyTiers = settings.retentionPolicy.tiers;
  const hasArchive = !!settings.archiveFolder;

  return (
    <div className="settings-section recovery-section">
      <div className="settings-section-title">Recovery</div>

      {/* 1. Snapshot history toggle */}
      <div className="settings-row">
        <div className="settings-label">
          Snapshot history
          <span className="settings-label-desc">
            Capture a versioned copy on every save.
          </span>
        </div>
        <button
          className={`settings-toggle${settings.enabled ? " settings-toggle--on" : ""}`}
          onClick={() => update({ enabled: !settings.enabled })}
          role="switch"
          aria-checked={settings.enabled}
          aria-label="Snapshot history"
        >
          <span className="settings-toggle-knob" />
        </button>
      </div>

      {/* 2. Retention tiers */}
      <div
        className={`recovery-subpanel${highlightOn ? " recovery-subpanel--highlight" : ""}`}
        ref={retentionTableRef}
      >
        <div className="recovery-subpanel-title">Retention tiers</div>
        <div className="recovery-tier-table" role="table">
          <div className="recovery-tier-row recovery-tier-row--head" role="row">
            <span role="columnheader">Age range</span>
            <span role="columnheader">Keep</span>
            <span aria-hidden="true" />
          </div>
          {policyTiers.map((tier, i) => {
            const prevMax = i === 0 ? 0 : policyTiers[i - 1].maxAgeMs;
            const isLast = i === policyTiers.length - 1;
            return (
              <div
                key={`${tier.maxAgeMs}-${i}`}
                className="recovery-tier-row"
                role="row"
              >
                <span className="recovery-tier-pill" role="cell">
                  {formatTierAgeRange(tier, prevMax, isLast)}
                </span>
                <select
                  className="settings-select recovery-tier-select"
                  value={tier.granularity}
                  onChange={(e) =>
                    handleGranularityChange(
                      i,
                      e.target.value as RetentionGranularity,
                    )
                  }
                  aria-label={`Granularity for tier ${i + 1}`}
                >
                  {GRANULARITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="recovery-tier-remove"
                  onClick={() => handleRemoveTier(i)}
                  aria-label={`Remove tier ${i + 1}`}
                  title="Remove tier"
                >
                  ×
                </button>
              </div>
            );
          })}
          {!showAddTier && (
            <button
              type="button"
              className="recovery-add-tier"
              onClick={() => setShowAddTier(true)}
            >
              + Add tier
            </button>
          )}
          {showAddTier && (
            <AddTierForm
              onCancel={() => setShowAddTier(false)}
              onAdd={handleAddTier}
            />
          )}
        </div>
        <div className="recovery-subpanel-desc">
          Older snapshots are pruned per these rules.
        </div>
      </div>

      {/* 3. Maximum storage */}
      <div className="settings-row">
        <div className="settings-label">
          Maximum storage (local)
          <span className="settings-label-desc">
            {storageBytes === null
              ? "Calculating usage…"
              : formatStorageSubLabel(storageBytes, settings.maxStorageBytes)}
          </span>
        </div>
        <select
          className="settings-select"
          value={
            settings.maxStorageBytes === null
              ? "unlimited"
              : String(settings.maxStorageBytes)
          }
          onChange={(e) => {
            const v = e.target.value;
            update({
              maxStorageBytes: v === "unlimited" ? null : Number(v),
            });
          }}
          aria-label="Maximum storage"
        >
          {STORAGE_OPTIONS.map((opt) => (
            <option
              key={opt.label}
              value={opt.value === null ? "unlimited" : String(opt.value)}
            >
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 4. Where snapshots are stored */}
      <div className="recovery-subpanel">
        <div className="recovery-subpanel-title">
          Where snapshots are stored
        </div>
        <div className="recovery-subpanel-desc">
          Today’s frequent saves can stay local; older daily/weekly snapshots
          can route to a backed-up folder.
        </div>

        <div className="settings-row">
          <div className="settings-label">Archive folder</div>
          {hasArchive ? (
            <div className="recovery-archive-row">
              <span
                className="recovery-archive-path"
                title={settings.archiveFolder}
              >
                {abbreviatePath(settings.archiveFolder!)}
              </span>
              <button
                type="button"
                className="recovery-archive-btn"
                onClick={handlePickArchiveFolder}
              >
                Change
              </button>
              <button
                type="button"
                className="recovery-archive-btn recovery-archive-btn--ghost"
                onClick={handleRemoveArchiveFolder}
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="recovery-archive-btn"
              onClick={handlePickArchiveFolder}
            >
              Choose folder…
            </button>
          )}
        </div>

        {hasArchive && (
          <div
            className="recovery-routing-matrix"
            role="table"
            aria-label="Per-tier routing"
          >
            <div
              className="recovery-routing-row recovery-routing-row--head"
              role="row"
            >
              <span role="columnheader">Tier</span>
              <span role="columnheader">Local only</span>
              <span role="columnheader">Archive only</span>
              <span role="columnheader">Both</span>
            </div>
            {policyTiers.map((tier, i) => {
              const prevMax = i === 0 ? 0 : policyTiers[i - 1].maxAgeMs;
              const isLast = i === policyTiers.length - 1;
              const dest = settings.tierDestinations.find(
                (d) => d.tierIndex === i,
              )?.destinations ?? ["local"];
              const current = currentDestKind(dest);
              return (
                <div
                  key={`route-${i}`}
                  className="recovery-routing-row"
                  role="row"
                >
                  <span role="cell" className="recovery-routing-cell">
                    {formatTierAgeRange(tier, prevMax, isLast)}
                  </span>
                  {(["local", "archive", "both"] as const).map((kind) => (
                    <span
                      key={kind}
                      role="cell"
                      className="recovery-routing-cell"
                    >
                      <input
                        type="radio"
                        name={`tier-route-${i}`}
                        value={kind}
                        checked={current === kind}
                        onChange={() => handleDestinationChange(i, kind)}
                        aria-label={`Tier ${i + 1} ${kind}`}
                      />
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Trash retention */}
      <div className="settings-row">
        <div className="settings-label">Trash retention</div>
        <select
          className="settings-select"
          value={String(settings.trashRetentionDays)}
          onChange={(e) =>
            update({ trashRetentionDays: Number(e.target.value) })
          }
          aria-label="Trash retention"
        >
          {TRASH_RETENTION_OPTIONS.map((opt) => (
            <option key={opt.label} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 6. Device name */}
      <div className="settings-row">
        <div className="settings-label">
          This device is called
          <span className="settings-label-desc">
            Shown on snapshot timeline so you can tell devices apart.
          </span>
        </div>
        <input
          type="text"
          className="settings-text-input"
          value={settings.deviceName ?? ""}
          placeholder="hostname"
          onChange={(e) => update({ deviceName: e.target.value || undefined })}
          aria-label="Device name"
        />
      </div>

      {/* 7. Open snapshot folder */}
      <div className="settings-row">
        <div className="settings-label">Snapshot folder</div>
        <button
          type="button"
          className="recovery-secondary-btn"
          onClick={handleOpenSnapshotFolder}
        >
          Open snapshot folder
        </button>
      </div>

      {/* 8. Clear all snapshots */}
      <div className="settings-row">
        <div className="settings-label">Clear all snapshots</div>
        <button
          type="button"
          className="recovery-danger-btn"
          onClick={() => setPendingClearAll(true)}
        >
          Clear all snapshots
        </button>
      </div>

      <ConfirmDialog
        open={pendingClearAll}
        title="Clear all snapshots?"
        message="Permanently delete all snapshots for every file? This cannot be undone."
        confirmLabel="Clear all"
        cancelLabel="Cancel"
        danger
        onConfirm={confirmClearAll}
        onCancel={() => setPendingClearAll(false)}
      />
    </div>
  );
}

// ───────────────────────── helpers ─────────────────────────

function currentDestKind(
  destinations: readonly StorageDestination[],
): "local" | "archive" | "both" {
  const set = new Set(destinations);
  if (set.has("local") && set.has("archive")) return "both";
  if (set.has("archive")) return "archive";
  return "local";
}

function abbreviatePath(p: string): string {
  // Best-effort home-tilde for display. We don't ask the platform for HOME
  // here — keep it dependency-free; the renderer just wants a shorter
  // string. Show the last 2-3 segments.
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 3) return parts.join("/");
  return ".../" + parts.slice(-3).join("/");
}

function formatStorageSubLabel(used: number, cap: number | null): string {
  const usedLabel = formatBytes(used);
  if (cap === null) return `${usedLabel} used.`;
  return `${usedLabel} of ${formatBytes(cap)} used.`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface AddTierFormProps {
  onCancel: () => void;
  onAdd: (
    count: number,
    unit: TierAgeUnit,
    granularity: RetentionGranularity,
  ) => void;
}

function AddTierForm({ onCancel, onAdd }: AddTierFormProps) {
  const [count, setCount] = useState<number>(1);
  const [unit, setUnit] = useState<TierAgeUnit>("days");
  const [granularity, setGranularity] = useState<RetentionGranularity>("daily");
  const submit = () => {
    if (!Number.isFinite(count) || count <= 0) return;
    onAdd(count, unit, granularity);
  };
  return (
    <div className="recovery-add-tier-form" role="group" aria-label="Add tier">
      <span className="recovery-add-tier-label">Up to</span>
      <input
        type="number"
        min={1}
        step={1}
        value={count}
        onChange={(e) => setCount(Number(e.target.value))}
        className="recovery-add-tier-count"
        aria-label="Tier max-age count"
      />
      <select
        value={unit}
        onChange={(e) => setUnit(e.target.value as TierAgeUnit)}
        className="settings-select recovery-add-tier-unit"
        aria-label="Tier max-age unit"
      >
        {AGE_UNIT_OPTIONS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <span className="recovery-add-tier-label">keep</span>
      <select
        value={granularity}
        onChange={(e) => setGranularity(e.target.value as RetentionGranularity)}
        className="settings-select recovery-add-tier-granularity"
        aria-label="Tier granularity"
      >
        {GRANULARITY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button type="button" className="recovery-add-tier-btn" onClick={submit}>
        Add
      </button>
      <button
        type="button"
        className="recovery-add-tier-btn recovery-add-tier-btn--ghost"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

// (No additional exports — keep this file component-only so React Fast
// Refresh stays effective.)
