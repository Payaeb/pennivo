import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  lazy,
  Suspense,
} from "react";
import { MilkdownProvider, useInstance } from "@milkdown/react";
import { editorViewCtx } from "@milkdown/core";
import DOMPurify from "dompurify";
import { callCommand, replaceAll } from "@milkdown/utils";
import { lift } from "@milkdown/prose/commands";
import { wrapInList } from "@milkdown/prose/schema-list";
import type { EditorView } from "@milkdown/prose/view";
import type { NodeType } from "@milkdown/prose/model";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  toggleInlineCodeCommand,
  turnIntoTextCommand,
  liftListItemCommand,
} from "@milkdown/preset-commonmark";
import {
  toggleStrikethroughCommand,
  insertTableCommand,
  setAlignCommand,
  addRowBeforeCommand,
  addRowAfterCommand,
} from "@milkdown/preset-gfm";
import "./styles/tokens.css";
import "./styles/base.css";
import { AppShell } from "./components/AppShell/AppShell";
import { Editor } from "./components/Editor/Editor";
import { Toolbar } from "./components/Toolbar/Toolbar";
import {
  type ToolbarAction,
  type ConfigurableAction,
  DEFAULT_TOOLBAR_CONFIG,
} from "./components/Toolbar/Toolbar.constants";
import { LinkPopover } from "./components/LinkPopover/LinkPopover";
import { FindReplace } from "./components/FindReplace/FindReplace";
import type { SaveStatus } from "./components/Statusbar/Statusbar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import {
  RecoveryModal,
  HistoryView,
  TrashView,
  CapExceededBanner,
  CapExceededToast,
  CompareMergeView,
  ExternalChangeToast,
  RecoveryModalWidthMeasurer,
  type RecoveryModalMode,
  type CapWarning,
  type CompareMergeSelection,
} from "./components/RecoveryModal";
import {
  type SidebarSortKey,
  DEFAULT_SORT,
  isSidebarSortKey,
  sortTree,
} from "./utils/sortTree";
import type {
  MenuAction,
  RecentFileEntry,
} from "./components/Titlebar/TitlebarMenu";
import {
  CommandPalette,
  type CommandItem,
} from "./components/CommandPalette/CommandPalette";
import {
  OutlinePanel,
  type HeadingEntry,
} from "./components/OutlinePanel/OutlinePanel";
import { TableToolbar } from "./components/TableToolbar/TableToolbar";
import { TableSizePicker } from "./components/TableSizePicker/TableSizePicker";
import {
  executeTableAction,
  type TableAction,
} from "./components/Editor/tablePlugin";
import {
  parseMermaidGantt,
  ganttDataToMermaid,
  createDefaultGanttData,
  type GanttData,
  parseKanbanMarkdown,
  kanbanDataToMarkdown,
  createDefaultKanbanData,
  type KanbanData,
  suggestFilenameFromContent,
  shouldShowCapBanner,
  type WorkspacesState,
} from "@pennivo/core";
import { useTheme } from "./hooks/useTheme";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { resolveImagePaths, relativizeImagePaths } from "./utils/imagePaths";
import { extractFilename } from "./utils/paths";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  type DraftData,
} from "./utils/draftStorage";
import { getPlatform } from "./platform";

// Lazy-loaded components — deferred until first use to reduce startup bundle
const LazySourceEditor = lazy(() =>
  import("./components/SourceEditor/SourceEditor").then((m) => ({
    default: m.SourceEditor,
  })),
);
const LazyGanttEditorPanel = lazy(() =>
  import("./components/GanttEditor/GanttEditorPanel").then((m) => ({
    default: m.GanttEditorPanel,
  })),
);
const LazyKanbanEditorPanel = lazy(() =>
  import("./components/KanbanEditor/KanbanEditorPanel").then((m) => ({
    default: m.KanbanEditorPanel,
  })),
);
const LazyToolbarCustomizer = lazy(() =>
  import("./components/ToolbarCustomizer/ToolbarCustomizer").then((m) => ({
    default: m.ToolbarCustomizer,
  })),
);
const LazyAboutDialog = lazy(() =>
  import("./components/AboutDialog/AboutDialog").then((m) => ({
    default: m.AboutDialog,
  })),
);
const LazyShortcutsSheet = lazy(() =>
  import("./components/ShortcutsSheet/ShortcutsSheet").then((m) => ({
    default: m.ShortcutsSheet,
  })),
);
const LazySettingsPanel = lazy(() =>
  import("./components/SettingsPanel/SettingsPanel").then((m) => ({
    default: m.SettingsPanel,
  })),
);

const AUTO_SAVE_DELAY = 3000;
const DRAFT_SAVE_INTERVAL = 30_000;

const FILE_SIZE_WARN = 500_000; // 500 KB — warn, user chooses mode
const FILE_SIZE_SOURCE_DEFAULT = 1_000_000; // 1 MB — auto source mode, can switch back with warning
const FILE_SIZE_SOURCE_LOCKED = 1_500_000; // 1.5 MB — locked to source mode

/**
 * Wrap each block in the current selection in its own list item.
 *
 * Milkdown's `wrapInBulletListCommand` / `wrapInOrderedListCommand` use
 * ProseMirror's `wrapIn`, which puts the entire selection inside a SINGLE
 * list_item — so a 3-line selection becomes one bullet containing all 3
 * lines. We use `wrapInList` from prosemirror-schema-list instead, which
 * iterates across the selected blocks and produces one list_item per block.
 *
 * For task lists, after wrapping we walk the resulting list_items in the
 * selection range and set `checked:false` on each so they render as
 * checkboxes.
 */
function wrapSelectionAsList(
  view: EditorView,
  listTypeName: "bullet_list" | "ordered_list",
  asTaskList: boolean,
): void {
  const { state, dispatch } = view;
  const listType = state.schema.nodes[listTypeName] as NodeType | undefined;
  if (!listType) return;

  const wrapped = wrapInList(listType)(state, dispatch);
  if (!wrapped || !asTaskList) return;

  // After wrap, fetch the new state and mark every list_item in the
  // selection as a task item. We use a microtask so `dispatch` above has
  // committed and `view.state` reflects the new doc.
  queueMicrotask(() => {
    const s = view.state;
    const tr = s.tr;
    const { from, to } = s.selection;
    let changed = false;
    s.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === "list_item" && node.attrs["checked"] == null) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
        changed = true;
      }
    });
    if (changed) view.dispatch(tr);
  });
}

function getActiveFormats(view: EditorView): Set<ToolbarAction> {
  const active = new Set<ToolbarAction>();
  const state = view.state;
  const { from, to, empty } = state.selection;
  const { doc } = state;

  if (empty) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    for (const mark of marks) {
      if (mark.type.name === "strong") active.add("bold");
      if (mark.type.name === "emphasis") active.add("italic");
      if (mark.type.name === "strike_through") active.add("strikethrough");
    }
  } else {
    const schema = state.schema;
    if (
      schema.marks["strong"] &&
      doc.rangeHasMark(from, to, schema.marks["strong"])
    )
      active.add("bold");
    if (
      schema.marks["emphasis"] &&
      doc.rangeHasMark(from, to, schema.marks["emphasis"])
    )
      active.add("italic");
    if (
      schema.marks["strike_through"] &&
      doc.rangeHasMark(from, to, schema.marks["strike_through"])
    )
      active.add("strikethrough");
  }

  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type.name === "heading") {
    if (parent.attrs["level"] === 1) active.add("h1");
    if (parent.attrs["level"] === 2) active.add("h2");
  }
  if (parent.type.name === "code_block") active.add("code");

  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "bullet_list") {
      // Check if this is a task list (list items have checked attr)
      const listItem = d + 1 <= $from.depth ? $from.node(d + 1) : null;
      if (listItem && listItem.attrs["checked"] != null) {
        active.add("taskList");
      } else {
        active.add("bulletList");
      }
      break;
    }
    if (node.type.name === "ordered_list") {
      active.add("orderedList");
      break;
    }
    if (node.type.name === "blockquote") {
      active.add("blockquote");
      break;
    }
  }

  return active;
}

const DROPPABLE_EXTENSIONS = new Set(["md", "markdown", "txt"]);

function AppContent() {
  const platform = getPlatform();
  const { toggleTheme, colorScheme, cycleColorScheme, setColorScheme } =
    useTheme();
  const [loading, getInstance] = useInstance();
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [activeFormats, setActiveFormats] = useState<Set<ToolbarAction>>(
    new Set(),
  );
  const [focusMode, setFocusMode] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [sourceMode, setSourceModeRaw] = useState(false);
  const [sourceEverActivated, setSourceEverActivated] = useState(false); // defer CodeMirror mount until first use
  const setSourceMode = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setSourceModeRaw((prev) => {
        const next = typeof v === "function" ? v(prev) : v;
        if (next) setSourceEverActivated(true);
        return next;
      });
    },
    [],
  );
  const [sourceContent, setSourceContent] = useState("");
  const sourceModeRef = useRef(false);
  const cmViewRef = useRef<import("@codemirror/view").EditorView | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(false);
  const typewriterModeRef = useRef(false);
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [outlineMarkdown, setOutlineMarkdown] = useState("");

  // --- File state ---
  const [filePath, setFilePathState] = useState<string | null>(null);
  const [isDirty, setIsDirtyState] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  // Refs for stable access in callbacks (avoids stale closures)
  const filePathRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const markdownRef = useRef("");
  const savedMarkdownRef = useRef("");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const draftTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const fileSizeRef = useRef(0);
  const [draftRecovery, setDraftRecovery] = useState<DraftData | null>(null);

  // --- Auto-update banner state (set when main fires update:available) ---
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);

  // --- Recovery modal state (Phase 13a — first UI slice) ---
  // `recoveryModalOpen` toggles visibility; `recoveryModalMode` swaps between
  // History / Trash / Compare-merge bodies inside the same shell. Trash body
  // and Compare-merge body land in subsequent slices; this slice only wires
  // the History body for real.
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);
  const [recoveryModalMode, setRecoveryModalMode] =
    useState<RecoveryModalMode>("history");
  // Compare & merge selection — the two snapshot IDs picked in History.
  // Cleared when the modal closes; preserved when the user temporarily
  // backs out to History (so re-clicking Compare & merge re-uses the pair).
  const [compareMergeSelection, setCompareMergeSelection] =
    useState<CompareMergeSelection | null>(null);
  // Persisted layout settings for the History modal panes. Defaults match
  // `defaultRecoverySettings()` from @pennivo/core.
  const [recoveryHistoryLayout, setRecoveryHistoryLayout] = useState<{
    timelineWidth: number;
    timelineCollapsed: boolean;
    previewCollapsed: boolean;
  }>({
    timelineWidth: 340,
    timelineCollapsed: false,
    previewCollapsed: false,
  });
  // Live modal width (re-measured via ResizeObserver) so HistoryView can
  // auto-collapse the timeline below 800px without persisting the change.
  const [recoveryModalWidth, setRecoveryModalWidth] = useState(0);
  // Compare-merge body publishes its discard-confirm guard here so the
  // shell's × / overlay-click can route through it. Null when not in
  // compare-merge mode (or no progress yet); a callable when an interactive
  // close attempt should trigger the discard-confirm.
  const compareMergeCloseGuardRef = useRef<(() => void) | null>(null);

  // --- Cap-exceeded notification state (Phase 13a §2.6) ---
  // `capWarning` mirrors the most-recent `recovery:cap-exceeded` event payload
  // (or `null` when none has fired this session / cap is honored). The toast
  // is one-time-per-session; the banner inside the recovery modal persists
  // across opens until the user dismisses it for the current overage.
  const [capWarning, setCapWarning] = useState<CapWarning | null>(null);
  const [capToastVisible, setCapToastVisible] = useState(false);
  const capToastShownRef = useRef(false);
  const [capBannerDismissedAt, setCapBannerDismissedAt] = useState<
    number | null
  >(null);
  const [lastCapWarningOverageBytes, setLastCapWarningOverageBytes] = useState<
    number | null
  >(null);

  // --- Trash count state (drives sidebar Trash entry visibility) ---
  const [trashCount, setTrashCount] = useState(0);

  // --- External-change toast state (Phase 13a §2.7) ---
  // Renders bottom-right when `recovery:external-change-detected` fires. We
  // dedupe per-file with a 1s window so a single open doesn't spawn two
  // toasts (e.g. file:open + file:open-path firing back-to-back).
  const [externalChangeToast, setExternalChangeToast] = useState<{
    absolutePath: string;
    // `"external"` = informational (non-open file, or already in sync).
    // `"conflict"` = the OPEN file changed while it had unsaved edits.
    variant: "external" | "conflict";
    // Snapshot of the new on-disk content — used as the merge "right" side.
    snapshotId?: string;
  } | null>(null);
  // Last external-change snapshotId handled per file path. Dedupes duplicate
  // emits (e.g. the file:open + file:open-path race) by identity rather than a
  // time window — distinct real changes carry distinct snapshotIds, so a second
  // genuine change is never dropped (which a time window would do).
  const externalChangeLastSnapshotRef = useRef<Record<string, string>>({});
  // Forward-ref to the external-change handler. The subscription effect (which
  // runs before loadContent is declared) calls through this ref; it's populated
  // by an effect later, once loadContent + the reload funnel exist.
  const handleExternalChangeRef = useRef<
    ((payload: { absolutePath: string; snapshotId: string }) => void) | null
  >(null);
  // Timer that reverts the transient "Updated from disk" status back to "saved".
  const externalReloadStatusTimerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  // --- Archive-status state (Phase 13a §2.7) ---
  // The titlebar chip renders only when this is non-null and indicates a
  // problem (`unavailable` or queued > 0). `'ok'` clears the chip.
  const [archiveStatus, setArchiveStatus] = useState<{
    status: "ok" | "unavailable" | "queued";
    count: number;
  } | null>(null);

  // --- Settings panel deep-link state ---
  const [settingsScrollSection, setSettingsScrollSection] = useState<
    "recovery" | null
  >(null);
  const [highlightRecoveryRetention, setHighlightRecoveryRetention] =
    useState(false);

  // --- Sidebar state ---
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [sidebarFolder, setSidebarFolder] = useState<string | null>(null);
  const [sidebarTree, setSidebarTree] = useState<FileTreeEntry[]>([]);
  const [sidebarSort, setSidebarSort] = useState<SidebarSortKey>(DEFAULT_SORT);
  // Map of normalized file path → millisecond timestamp of last open in Pennivo.
  // Powers the "Recently opened" sort. Persisted via settings.
  const [fileOpenTimestamps, setFileOpenTimestamps] = useState<
    Record<string, number>
  >({});

  const normalizeFilePath = useCallback(
    (p: string) => p.replace(/\\/g, "/").toLowerCase(),
    [],
  );

  const hydrateOpenTimestamps = useCallback(
    (entries: FileTreeEntry[]): FileTreeEntry[] =>
      entries.map((e) => {
        const next: FileTreeEntry = { ...e };
        if (e.type === "file") {
          const ts = fileOpenTimestamps[normalizeFilePath(e.path)];
          if (ts !== undefined) next.lastOpenedMs = ts;
        }
        if (e.children) next.children = hydrateOpenTimestamps(e.children);
        return next;
      }),
    [fileOpenTimestamps, normalizeFilePath],
  );

  const sortedSidebarTree = useMemo(
    () => sortTree(hydrateOpenTimestamps(sidebarTree), sidebarSort),
    [sidebarTree, sidebarSort, hydrateOpenTimestamps],
  );

  const handleSidebarSortChange = useCallback((key: SidebarSortKey) => {
    setSidebarSort(key);
    platform.getSettings().then((saved) => {
      platform.setSettings({ ...saved, sidebarSort: key });
    });
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sidebar context-menu handlers — wired directly to platform.
  // Toast feedback is surfaced via the existing showToast helper (defined later
  // in this component) — accessed via ref to avoid a forward dependency.
  const handleSidebarShowInExplorer = useCallback((absPath: string) => {
    platform.showItemInFolder(absPath).catch((err) => {
      console.error("[showItemInFolder] failed:", err);
    });
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recordFileOpen = useCallback(
    (filePath: string) => {
      const key = normalizeFilePath(filePath);
      const now = Date.now();
      setFileOpenTimestamps((prev) => {
        const next = { ...prev, [key]: now };
        platform.getSettings().then((saved) => {
          platform.setSettings({ ...saved, fileOpenTimestamps: next });
        });
        return next;
      });
    },
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalizeFilePath],
  );

  // --- Toolbar config ---
  const [toolbarConfig, setToolbarConfig] = useState<ConfigurableAction[]>(
    DEFAULT_TOOLBAR_CONFIG,
  );
  const [toolbarCustomizerOpen, setToolbarCustomizerOpen] = useState(false);

  // --- Dialog state ---
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // --- Settings-backed UI state ---
  const [showWordCount, setShowWordCount] = useState(true);

  // Track whether the sidebar visibility has been hydrated from storage —
  // gates the persistence effect to skip the initial render.
  const sidebarVisibilityHydratedRef = useRef(false);

  // Load persisted settings on mount
  useEffect(() => {
    platform.getSettings().then((saved) => {
      if (saved && typeof saved.showWordCount === "boolean") {
        setShowWordCount(saved.showWordCount);
      }
      if (saved && isSidebarSortKey(saved.sidebarSort)) {
        setSidebarSort(saved.sidebarSort);
      }
      if (saved && typeof saved.sidebarVisible === "boolean") {
        setSidebarVisible(saved.sidebarVisible);
      }
      if (
        saved &&
        saved.fileOpenTimestamps &&
        typeof saved.fileOpenTimestamps === "object"
      ) {
        const raw = saved.fileOpenTimestamps as Record<string, unknown>;
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === "number" && Number.isFinite(v)) cleaned[k] = v;
        }
        setFileOpenTimestamps(cleaned);
      }
    });
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist sidebar visibility on every toggle. Skip the very first render
  // so we don't overwrite settings before they've had a chance to hydrate.
  useEffect(() => {
    if (!sidebarVisibilityHydratedRef.current) {
      sidebarVisibilityHydratedRef.current = true;
      return;
    }
    platform.getSettings().then((saved) => {
      platform.setSettings({ ...saved, sidebarVisible });
    });
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarVisible]);

  const handleSettingsChange = useCallback(
    (settings: Record<string, unknown>) => {
      if (typeof settings.showWordCount === "boolean") {
        setShowWordCount(settings.showWordCount);
      }
    },
    [],
  );

  // --- Recovery layout settings (Phase 13a, first UI slice) ---
  // One-shot load on mount. Defaults are already in state; we just merge
  // anything the user has previously persisted.
  const recoveryLayoutHydratedRef = useRef(false);
  useEffect(() => {
    platform.getSettings().then((saved) => {
      const recovery = (saved?.recovery ?? {}) as Record<string, unknown>;
      setRecoveryHistoryLayout((prev) => ({
        timelineWidth:
          typeof recovery.historyTimelineWidth === "number" &&
          recovery.historyTimelineWidth >= 200
            ? (recovery.historyTimelineWidth as number)
            : prev.timelineWidth,
        timelineCollapsed:
          typeof recovery.historyTimelineCollapsed === "boolean"
            ? (recovery.historyTimelineCollapsed as boolean)
            : prev.timelineCollapsed,
        previewCollapsed:
          typeof recovery.historyPreviewCollapsed === "boolean"
            ? (recovery.historyPreviewCollapsed as boolean)
            : prev.previewCollapsed,
      }));
      recoveryLayoutHydratedRef.current = true;
    });
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist recovery layout on change (skip the initial hydration tick).
  useEffect(() => {
    if (!recoveryLayoutHydratedRef.current) return;
    platform.getSettings().then((saved) => {
      const prevRecovery = (saved?.recovery ?? {}) as Record<string, unknown>;
      platform.setSettings({
        ...saved,
        recovery: {
          ...prevRecovery,
          historyTimelineWidth: recoveryHistoryLayout.timelineWidth,
          historyTimelineCollapsed: recoveryHistoryLayout.timelineCollapsed,
          historyPreviewCollapsed: recoveryHistoryLayout.previewCollapsed,
        },
      });
    });
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryHistoryLayout]);

  // Hydrate cap-banner dismissal state from persisted settings.
  // platform is a stable singleton — same convention as every other settings
  // load in this file. Suppress the dep-array nag on the array line itself.
  useEffect(() => {
    platform.getSettings().then((saved) => {
      const recovery = (saved?.recovery ?? {}) as Record<string, unknown>;
      if (typeof recovery.capBannerDismissedAt === "number") {
        setCapBannerDismissedAt(recovery.capBannerDismissedAt as number);
      }
      if (typeof recovery.lastCapWarningOverageBytes === "number") {
        setLastCapWarningOverageBytes(
          recovery.lastCapWarningOverageBytes as number,
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to cap-exceeded events. The toast fires once per session;
  // the in-modal banner re-appears whenever the overage grows past the
  // previously-dismissed value.
  useEffect(() => {
    // Pre-populate the warning if the engine has one cached from before the
    // renderer mounted (e.g. a save fired during hot reload).
    platform.snapshot.getCapStatus().then((status) => {
      if (status && typeof status === "object") {
        setCapWarning(status as CapWarning);
      }
    });
    const unsub = platform.snapshot.onCapExceeded((w) => {
      const warning = w as CapWarning;
      setCapWarning(warning);
      if (!capToastShownRef.current) {
        capToastShownRef.current = true;
        setCapToastVisible(true);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to external-change-detected events. Dedupe per-file by snapshotId
  // so duplicate emits (the file:open + file:open-path race) collapse while two
  // genuinely distinct changes both get handled. The actual handling lives
  // behind `handleExternalChangeRef` (populated after loadContent is declared)
  // so this subscription stays stable while the handler closes over the latest
  // reload helpers.
  useEffect(() => {
    const unsub = platform.snapshot.onExternalChangeDetected((payload) => {
      if (
        externalChangeLastSnapshotRef.current[payload.absolutePath] ===
        payload.snapshotId
      ) {
        return;
      }
      externalChangeLastSnapshotRef.current[payload.absolutePath] =
        payload.snapshotId;
      handleExternalChangeRef.current?.(payload);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to archive-status events. The titlebar chip renders based on
  // this state. We seed `null` and only show the chip when the engine has
  // told us something is wrong.
  useEffect(() => {
    const unsub = platform.snapshot.onArchiveStatus((status) => {
      if (status && typeof status === "object") {
        const s = status as { status?: string; count?: number };
        if (s.status === "ok") {
          setArchiveStatus({ status: "ok", count: 0 });
        } else if (s.status === "unavailable") {
          setArchiveStatus({
            status: "unavailable",
            count: typeof s.count === "number" ? s.count : 0,
          });
        } else if (s.status === "queued") {
          setArchiveStatus({
            status: "queued",
            count: typeof s.count === "number" ? s.count : 0,
          });
        }
      }
    });
    // Pull current state right after subscribing — the engine emits a
    // boot-time status before the renderer is wired up, so we'd otherwise
    // miss it until the next save. The probe re-emits the current state.
    platform.snapshot.probeArchiveStatus().catch(() => {});
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to trash-count changes (drives sidebar Trash entry visibility).
  useEffect(() => {
    let cancelled = false;
    platform.trash
      .list()
      .then((rows) => {
        if (!cancelled) setTrashCount(rows.length);
      })
      .catch(() => {});
    const unsub = platform.trash.onCountChanged?.((n) => {
      setTrashCount(n);
    });
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist cap-banner dismissal — caller passes the overage at dismissal
  // time so future warnings can decide whether to re-surface (overage grew →
  // banner returns; same overage → stays hidden).
  const persistCapBannerDismissal = useCallback(
    async (overageBytes: number) => {
      const dismissedAt = Date.now();
      setCapBannerDismissedAt(dismissedAt);
      setLastCapWarningOverageBytes(overageBytes);
      const saved = await platform.getSettings();
      const prevRecovery = (saved?.recovery ?? {}) as Record<string, unknown>;
      await platform.setSettings({
        ...saved,
        recovery: {
          ...prevRecovery,
          capBannerDismissedAt: dismissedAt,
          lastCapWarningOverageBytes: overageBytes,
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // --- Recent files ---
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);

  const loadRecentFiles = useCallback(async () => {
    const files = await platform.getRecentFiles();
    if (!files) return;
    setRecentFiles(
      files.map((fp: string) => {
        const parts = fp.replace(/\\/g, "/").split("/");
        const filename = parts.pop() || fp;
        const dir =
          parts.length > 2
            ? ".../" + parts.slice(-2).join("/")
            : parts.join("/");
        return { filePath: fp, filename, truncatedPath: dir };
      }),
    );
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load recent files on mount
  useEffect(() => {
    loadRecentFiles();
  }, [loadRecentFiles]);

  // --- Sidebar helpers ---
  const refreshSidebarTree = useCallback(async (folder: string | null) => {
    if (!folder) {
      setSidebarTree([]);
      return;
    }
    const tree = await platform.readDirectory(folder);
    if (tree) setSidebarTree(tree);
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChooseFolder = useCallback(async () => {
    const folder = await platform.chooseSidebarFolder();
    if (folder) {
      setSidebarFolder(folder);
      setSidebarVisible(true);
      refreshSidebarTree(folder);
    }
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSidebarTree]);

  // Forward-ref to the post-rename reload routine. Populated by an effect
  // later in the component (after loadContent + showToast are declared) —
  // lets handleSidebarRenameFile remain in this cluster of sidebar handlers
  // without TDZ errors against the later-declared deps.
  const reloadOpenFileRef = useRef<((newPath: string) => Promise<void>) | null>(
    null,
  );

  const handleSidebarRenameFile = useCallback(
    async (oldPath: string, newName: string): Promise<string | null> => {
      const wasOpen =
        !!filePath &&
        filePath.replace(/\\/g, "/").toLowerCase() ===
          oldPath.replace(/\\/g, "/").toLowerCase();
      const newPath = await platform.renameFile(oldPath, newName);
      if (newPath) {
        if (wasOpen) {
          setFilePath(newPath);
          // Main process may have normalized the on-disk content (consolidating
          // multiple *-md-images folders into the new convention name and
          // rewriting references). Re-read so the editor sees the canonical
          // version. Any unsaved changes at the moment of rename are lost —
          // this is the trade-off for keeping the file's asset state coherent.
          try {
            await reloadOpenFileRef.current?.(newPath);
          } catch (err) {
            console.error("[rename] reload after rename failed:", err);
          }
        }
        refreshSidebarTree(sidebarFolder);
      }
      return newPath;
    },
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filePath, sidebarFolder, refreshSidebarTree],
  );

  const handleSidebarDeleteFile = useCallback(
    async (path: string, includeAssets: boolean): Promise<boolean> => {
      const ok = await platform.deleteFile(path, includeAssets);
      if (ok) {
        // If the deleted file is currently open, detach it from the path —
        // user's content stays in the editor as unsaved (so they can save-as elsewhere).
        if (
          filePath &&
          filePath.replace(/\\/g, "/").toLowerCase() ===
            path.replace(/\\/g, "/").toLowerCase()
        ) {
          setFilePath(null);
          setIsDirty(true);
        }
        refreshSidebarTree(sidebarFolder);
      }
      return ok;
    },
    // platform is the project-wide stable singleton (getPlatform() returns the same instance); setIsDirty is a stable in-component helper that only touches refs + stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filePath, sidebarFolder, refreshSidebarTree],
  );

  const handleSidebarMoveFile = useCallback(
    async (
      srcPath: string,
      destDir: string,
      overwrite = false,
    ): Promise<{
      ok: boolean;
      newPath?: string;
      reason?: "collision" | "error";
    }> => {
      const result = await platform.moveFile(srcPath, destDir, overwrite);
      if (result.ok) {
        // If the moved file is currently open, remap to the new path so saves
        // continue to land in the right place (mirrors rename behavior).
        if (
          result.newPath &&
          filePath &&
          filePath.replace(/\\/g, "/").toLowerCase() ===
            srcPath.replace(/\\/g, "/").toLowerCase()
        ) {
          setFilePath(result.newPath);
        }
        refreshSidebarTree(sidebarFolder);
      }
      return result;
    },
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filePath, sidebarFolder, refreshSidebarTree],
  );

  // Load persisted sidebar folder on mount.
  // If a folder is configured but the user has never explicitly toggled
  // sidebar visibility (no `sidebarVisible` in settings), default to visible —
  // otherwise the sort dropdown and right-click menu live on a hidden surface
  // and the user thinks the features are missing.
  useEffect(() => {
    // Phase 2: resolve the initial folder from the active workspace's root
    // path. This is the exact same single-folder code path as before — only
    // the source of the folder string changed. When workspaces is empty (no
    // active workspace) we fall back to the legacy `getSidebarFolder()`, so a
    // failed/empty migration behaves identically to today (user picks a folder).
    Promise.all([
      platform.getWorkspaces(),
      platform.getSidebarFolder(),
      platform.getSettings(),
    ]).then(([rawWorkspaces, legacyFolder, saved]) => {
      const workspaces = rawWorkspaces as WorkspacesState | null | undefined;
      const active = workspaces?.workspaces.find(
        (w) => w.id === workspaces.activeWorkspaceId,
      );
      const folder = active?.rootPath ?? legacyFolder;
      if (folder) {
        setSidebarFolder(folder);
        refreshSidebarTree(folder);
        const explicitVisibility =
          saved && typeof saved.sidebarVisible === "boolean";
        if (!explicitVisibility) setSidebarVisible(true);
      }
    });
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSidebarTree]);

  // Load persisted toolbar config on mount
  useEffect(() => {
    platform.getToolbarConfig().then((saved) => {
      if (saved) setToolbarConfig(saved as ConfigurableAction[]);
    });
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToolbarConfigUpdate = useCallback(
    (config: ConfigurableAction[]) => {
      setToolbarConfig(config);
      platform.setToolbarConfig(config);
    },
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Listen for folder changes (file watcher)
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const cleanup = platform.onSidebarFolderChanged(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => refreshSidebarTree(sidebarFolder), 300);
    });
    return () => {
      clearTimeout(debounce);
      cleanup();
    };
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarFolder, refreshSidebarTree]);

  const setFilePath = (p: string | null) => {
    filePathRef.current = p;
    setFilePathState(p);
    // Report the open path so the main-process watcher can live-reload this
    // file on external change (Phase 12d-pre). No-op on hosts without a watcher.
    void platform.setOpenFile(p);
  };

  const setIsDirty = (dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirtyState(dirty);
    platform.setDirty(dirty);
  };

  const filename = filePath ? extractFilename(filePath) : "untitled.md";

  // --- Toast state ---
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const showToast = useCallback((message: string, deferred = false) => {
    const show = () => {
      setToast(message);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 5000);
    };
    if (deferred) {
      // Wait until the browser has painted so the toast starts after loading finishes
      requestAnimationFrame(() => requestAnimationFrame(show));
    } else {
      show();
    }
  }, []);

  // --- Save operations ---
  const doSave = useCallback(async (): Promise<boolean> => {
    const currentPath = filePathRef.current;
    const content = markdownRef.current;

    if (!currentPath) {
      return doSaveAs();
    }

    setSaveStatus("saving");
    try {
      // Relativize image paths before writing to disk
      const saveContent = relativizeImagePaths(content, currentPath);
      await platform.saveFile(currentPath, saveContent);
      savedMarkdownRef.current = content;
      setIsDirty(false);
      setSaveStatus("saved");
      clearDraft();
      return true;
    } catch {
      setSaveStatus("unsaved");
      return false;
    }
    // doSaveAs is intentionally not a dep — invoked through a stable wrapper; platform is the project-wide stable singleton (getPlatform() returns the same instance); setIsDirty is a stable in-component helper that only touches refs + stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSaveAs = useCallback(async (): Promise<boolean> => {
    const content = markdownRef.current;
    setSaveStatus("saving");
    try {
      // Build a default name:
      //   - If a file is already open: suggest "name (copy).md" alongside it.
      //   - If brand-new: derive from the doc's first line (heading or plain
      //     text), falling back to "Untitled" when the doc is empty.
      let defaultSavePath: string | undefined;
      const currentPath = filePathRef.current;
      if (currentPath) {
        const lastSep = Math.max(
          currentPath.lastIndexOf("/"),
          currentPath.lastIndexOf("\\"),
        );
        const dir = currentPath.slice(0, lastSep + 1);
        const base = currentPath.slice(lastSep + 1).replace(/\.md$/i, "");
        defaultSavePath = `${dir}${base} (copy).md`;
      } else {
        defaultSavePath = `${suggestFilenameFromContent(content)}.md`;
      }
      // Relativize image paths before writing to disk
      const saveContent = currentPath
        ? relativizeImagePaths(content, currentPath)
        : content;
      const newPath = await platform.saveFileAs(saveContent, defaultSavePath);
      if (newPath) {
        setFilePath(newPath);
        savedMarkdownRef.current = content;
        setIsDirty(false);
        setSaveStatus("saved");
        clearDraft();
        loadRecentFiles();
        return true;
      }
      setSaveStatus(isDirtyRef.current ? "unsaved" : "saved");
      return false;
    } catch {
      setSaveStatus("unsaved");
      return false;
    }
    // platform is the project-wide stable singleton (getPlatform() returns the same instance); setIsDirty is a stable in-component helper that only touches refs + stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRecentFiles]);

  // --- Load content into the active editor ---
  // Both editors stay mounted; update the visible one directly.
  //
  // Cold-start race: when Pennivo is launched by double-clicking a .md
  // in Explorer, the file IPC chain may resolve before Milkdown finishes
  // initializing. We always update markdownRef first so the deferred
  // effect below can drain it once the editor is ready, and we attempt
  // a direct apply if the editor is already ready by the time we get
  // here. We do NOT check `loading` — the deps would freeze its value
  // in the closure and the late callers from the cold-start effect
  // would always see loading=true and silently skip.
  const loadContent = useCallback(
    (content: string) => {
      markdownRef.current = content;
      setOutlineMarkdown(content);
      if (sourceModeRef.current) {
        // Source mode shows relative paths; content has resolved pennivo-file:// URLs
        const sourceMarkdown = filePathRef.current
          ? relativizeImagePaths(content, filePathRef.current)
          : content;
        setSourceContent(sourceMarkdown);
        return;
      }
      const editor = getInstance();
      if (!editor) {
        // Milkdown still initializing — content stays in markdownRef and
        // the effect below drains it once the editor is ready.
        return;
      }
      try {
        editor.action(replaceAll(content));
      } catch (err) {
        console.error(
          "[loadContent] Markdown parse failed, falling back to source mode:",
          err,
        );
        // Switch to source mode so the user can see and fix the raw content
        setSourceMode(true);
        sourceModeRef.current = true;
        const sourceMarkdown = filePathRef.current
          ? relativizeImagePaths(content, filePathRef.current)
          : content;
        setSourceContent(sourceMarkdown);
        showToast(
          "This file couldn\u2019t be parsed as markdown. Showing raw content.",
        );
      }
    },
    // setSourceMode is a useCallback with [] deps — its identity is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getInstance, showToast],
  );

  // Populate the forward-ref used by handleSidebarRenameFile to reload the
  // editor after a rename. We can only define this AFTER loadContent +
  // showToast are declared above. Updated whenever those refs change so the
  // closure stays current.
  useEffect(() => {
    reloadOpenFileRef.current = async (newPath: string) => {
      const result = await platform.openFilePath(newPath);
      if (!result) return;
      const displayContent = resolveImagePaths(result.content, result.filePath);
      markdownRef.current = displayContent;
      savedMarkdownRef.current = displayContent;
      loadContent(displayContent);
      setOutlineMarkdown(displayContent);
      setIsDirty(false);
      setSaveStatus("saved");
      if (result.healed) {
        showToast("Asset folders cleaned up for this file");
      }
    };
    // platform is the project-wide stable singleton (getPlatform() returns the same instance); setIsDirty is a stable in-component helper that only touches refs + stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadContent, showToast]);

  // Populate the external-change handler used by the subscription effect above.
  // Defined here (after loadContent) so it can run the smooth reload funnel.
  // Phase 12d-pre: live-reload the open document when it changes on disk.
  useEffect(() => {
    handleExternalChangeRef.current = (payload) => {
      const open = filePathRef.current;
      const isOpenFile =
        !!open &&
        open.replace(/\\/g, "/").toLowerCase() ===
          payload.absolutePath.replace(/\\/g, "/").toLowerCase();

      // Not the open document → informational toast only (legacy behavior).
      if (!isOpenFile) {
        setExternalChangeToast({
          absolutePath: payload.absolutePath,
          variant: "external",
        });
        return;
      }

      // The open file changed on disk. The external snapshot's content IS the
      // new disk content, so read it back and decide reload vs. merge.
      void (async () => {
        const snap = await platform.snapshot.read(
          payload.absolutePath,
          payload.snapshotId,
        );
        if (!snap) {
          setExternalChangeToast({
            absolutePath: payload.absolutePath,
            variant: "external",
          });
          return;
        }
        const display = resolveImagePaths(snap.content, payload.absolutePath);

        // Already in sync (detection fired on open and the editor already shows
        // disk content) → nothing to do, no toast.
        if (display === savedMarkdownRef.current) return;

        // Unsaved edits → never clobber. Offer Compare & merge; the external
        // snapshot is already captured so nothing is lost.
        if (isDirtyRef.current) {
          setExternalChangeToast({
            absolutePath: payload.absolutePath,
            variant: "conflict",
            snapshotId: payload.snapshotId,
          });
          return;
        }

        // Clean → smooth silent reload, preserving scroll position. A single
        // funnel (shared with the rename routine's shape) so Phase 12d can make
        // this incremental later. `snap.meta` carries author/agentName for the
        // future color-coded-attribution pass.
        const area =
          document.querySelector<HTMLElement>(".app-editor-area") ?? null;
        const cmScroller = cmViewRef.current?.scrollDOM ?? null;
        const prevScrollTop = sourceModeRef.current
          ? (cmScroller?.scrollTop ?? 0)
          : (area?.scrollTop ?? 0);

        // Same large-file guard as open: if the file grew past the WYSIWYG
        // limit on disk, force source mode before loading so we never push a
        // multi-MB doc into Milkdown (which would crash). loadContent then
        // renders the raw content into the source editor instead.
        const sizeBytes = new TextEncoder().encode(snap.content).length;
        fileSizeRef.current = sizeBytes;
        if (sizeBytes > FILE_SIZE_SOURCE_DEFAULT && !sourceModeRef.current) {
          setSourceMode(true);
          sourceModeRef.current = true;
        }

        savedMarkdownRef.current = display;
        loadContent(display);
        setIsDirty(false);

        // Restore scroll after the editor applies the new content.
        requestAnimationFrame(() => {
          if (sourceModeRef.current) {
            if (cmScroller) cmScroller.scrollTop = prevScrollTop;
          } else if (area) {
            area.scrollTop = prevScrollTop;
          }
        });

        // Transient ambient signal — no per-write toast, so this stays smooth
        // under rapid (streaming-style) writes. Reverts to "saved" if the user
        // hasn't started editing in the meantime.
        setSaveStatus("external-reload");
        clearTimeout(externalReloadStatusTimerRef.current);
        externalReloadStatusTimerRef.current = setTimeout(() => {
          if (!isDirtyRef.current) setSaveStatus("saved");
        }, 1500);
      })();
    };
    // platform is the project-wide stable singleton (getPlatform() returns the same instance); setIsDirty is a stable in-component helper that only touches refs + stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadContent]);

  // --- Drain pending markdown when Milkdown finishes initializing ---
  // Pairs with loadContent above for the cold-start race: if a .md was
  // opened from Explorer before the editor was ready, markdownRef holds
  // the file content; flush it as soon as `loading` flips false. This
  // effect runs at most once (Milkdown only transitions out of loading
  // once per session), so there's no need for a guard ref.
  useEffect(() => {
    if (loading) return;
    if (sourceModeRef.current) return;
    const editor = getInstance();
    if (!editor) return;
    const pending = markdownRef.current;
    if (!pending) return;
    try {
      editor.action(replaceAll(pending));
    } catch (err) {
      console.error("[deferred-load] Failed to apply pending markdown:", err);
    }
  }, [loading, getInstance]);

  // --- Open file ---
  const doOpen = useCallback(async () => {
    // Guard unsaved changes
    if (isDirtyRef.current) {
      const response = await platform.confirmDiscard();
      if (response === 2) return; // Cancel
      if (response === 0) {
        const saved = await doSave();
        if (!saved) return;
      }
      // response === 1: discard, proceed
    }

    let result;
    try {
      result = await platform.openFile();
    } catch (err) {
      console.error("[doOpen] Failed to read file:", err);
      showToast("Could not open this file — it may be corrupted or unreadable");
      return;
    }
    if (!result) return;

    const size = result.fileSize ?? 0;
    fileSizeRef.current = size;

    // Set file path first so loadContent can resolve/relativize against it
    setFilePath(result.filePath);
    recordFileOpen(result.filePath);

    // Resolve relative image paths to pennivo-file:// for display
    const displayContent = resolveImagePaths(result.content, result.filePath);

    if (size > FILE_SIZE_SOURCE_LOCKED) {
      // 1.5 MB+ — locked to source mode
      if (!sourceModeRef.current) {
        setSourceMode(true);
        sourceModeRef.current = true;
      }
      setSourceContent(result.content); // Show raw disk content (relative paths)
      markdownRef.current = displayContent;
      setOutlineMarkdown(displayContent);
      showToast(
        "Very large file — opened in source mode only to prevent crashes",
        true,
      );
    } else if (size > FILE_SIZE_SOURCE_DEFAULT) {
      // 1 MB–1.5 MB — default to source mode
      if (!sourceModeRef.current) {
        setSourceMode(true);
        sourceModeRef.current = true;
      }
      setSourceContent(result.content); // Show raw disk content (relative paths)
      markdownRef.current = displayContent;
      setOutlineMarkdown(displayContent);
      showToast("Large file — opened in source mode for performance", true);
    } else if (size > FILE_SIZE_WARN) {
      // 500 KB–1 MB — warn, let user choose
      showToast("Large file — may be slow in WYSIWYG mode", true);
      loadContent(displayContent);
    } else {
      loadContent(displayContent);
    }
    savedMarkdownRef.current = displayContent;
    setIsDirty(false);
    setSaveStatus("saved");
    loadRecentFiles();
    if (result.healed) {
      showToast("Asset folders cleaned up for this file");
    }
    // platform is the project-wide stable singleton (getPlatform() returns the same instance); setIsDirty is a stable in-component helper that only touches refs + stable setters; setSourceMode is a useCallback with [] deps — its identity is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doSave, loadRecentFiles, loadContent, showToast, recordFileOpen]);

  // --- Open recent file by path ---
  const openRecentFile = useCallback(
    async (recentPath: string) => {
      // Guard unsaved changes
      if (isDirtyRef.current) {
        const response = await platform.confirmDiscard();
        if (response === 2) return;
        if (response === 0) {
          const saved = await doSave();
          if (!saved) return;
        }
      }

      let result;
      try {
        result = await platform.openFilePath(recentPath);
      } catch (err) {
        console.error("[openRecentFile] Failed to read file:", err);
        showToast("Could not open this file — it may be missing or unreadable");
        return;
      }
      if (!result) return;

      const size = result.fileSize ?? 0;
      fileSizeRef.current = size;

      setFilePath(result.filePath);
      recordFileOpen(result.filePath);
      const displayContent = resolveImagePaths(result.content, result.filePath);

      if (size > FILE_SIZE_SOURCE_LOCKED) {
        if (!sourceModeRef.current) {
          setSourceMode(true);
          sourceModeRef.current = true;
        }
        setSourceContent(result.content);
        markdownRef.current = displayContent;
        setOutlineMarkdown(displayContent);
        showToast(
          "Very large file — opened in source mode only to prevent crashes",
          true,
        );
      } else if (size > FILE_SIZE_SOURCE_DEFAULT) {
        if (!sourceModeRef.current) {
          setSourceMode(true);
          sourceModeRef.current = true;
        }
        setSourceContent(result.content);
        markdownRef.current = displayContent;
        setOutlineMarkdown(displayContent);
        showToast("Large file — opened in source mode for performance", true);
      } else if (size > FILE_SIZE_WARN) {
        showToast("Large file — may be slow in WYSIWYG mode", true);
        loadContent(displayContent);
      } else {
        loadContent(displayContent);
      }
      savedMarkdownRef.current = displayContent;
      setIsDirty(false);
      setSaveStatus("saved");
      loadRecentFiles();
      if (result.healed) {
        showToast("Asset folders cleaned up for this file");
      }
    },
    // platform is the project-wide stable singleton (getPlatform() returns the same instance); setIsDirty is a stable in-component helper that only touches refs + stable setters; setSourceMode is a useCallback with [] deps — its identity is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doSave, loadRecentFiles, loadContent, showToast, recordFileOpen],
  );

  // --- Sidebar file click ---
  const handleSidebarFileClick = useCallback(
    async (clickedPath: string) => {
      // Clicking the file you're already on is a no-op. Without this guard
      // we'd reload from disk and silently drop any in-flight changes that
      // hadn't been autosaved yet (e.g. an image you just pasted), since
      // autosave is debounced 3s. The image file would still be on disk,
      // but the markdown reference to it would vanish from the editor.
      const current = filePathRef.current;
      if (
        current &&
        current.replace(/\\/g, "/").toLowerCase() ===
          clickedPath.replace(/\\/g, "/").toLowerCase()
      ) {
        return;
      }

      if (isDirtyRef.current) {
        const response = await platform.confirmDiscard();
        if (response === 2) return;
        if (response === 0) {
          const saved = await doSave();
          if (!saved) return;
        }
      }

      let result;
      try {
        result = await platform.openFilePath(clickedPath);
      } catch (err) {
        console.error("[handleSidebarFileClick] Failed to read file:", err);
        showToast("Could not open this file — it may be missing or unreadable");
        return;
      }
      if (!result) return;

      const size = result.fileSize ?? 0;
      fileSizeRef.current = size;

      setFilePath(result.filePath);
      recordFileOpen(result.filePath);
      const displayContent = resolveImagePaths(result.content, result.filePath);

      if (size > FILE_SIZE_SOURCE_LOCKED) {
        if (!sourceModeRef.current) {
          setSourceMode(true);
          sourceModeRef.current = true;
        }
        setSourceContent(result.content);
        markdownRef.current = displayContent;
        setOutlineMarkdown(displayContent);
        showToast(
          "Very large file — opened in source mode only to prevent crashes",
          true,
        );
      } else if (size > FILE_SIZE_SOURCE_DEFAULT) {
        if (!sourceModeRef.current) {
          setSourceMode(true);
          sourceModeRef.current = true;
        }
        setSourceContent(result.content);
        markdownRef.current = displayContent;
        setOutlineMarkdown(displayContent);
        showToast("Large file — opened in source mode for performance", true);
      } else if (size > FILE_SIZE_WARN) {
        showToast("Large file — may be slow in WYSIWYG mode", true);
        loadContent(displayContent);
      } else {
        loadContent(displayContent);
      }
      savedMarkdownRef.current = displayContent;
      setIsDirty(false);
      setSaveStatus("saved");
      loadRecentFiles();
      if (result.healed) {
        showToast("Asset folders cleaned up for this file");
      }
    },
    // platform is the project-wide stable singleton (getPlatform() returns the same instance); setIsDirty is a stable in-component helper that only touches refs + stable setters; setSourceMode is a useCallback with [] deps — its identity is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doSave, loadRecentFiles, loadContent, showToast, recordFileOpen],
  );

  // --- New file ---
  const doNewFile = useCallback(async () => {
    if (isDirtyRef.current) {
      const response = await platform.confirmDiscard();
      if (response === 2) return;
      if (response === 0) {
        const saved = await doSave();
        if (!saved) return;
      }
    }

    loadContent("");
    setFilePath(null);
    fileSizeRef.current = 0;
    savedMarkdownRef.current = "";
    setIsDirty(false);
    setSaveStatus("saved");
    // platform is the project-wide stable singleton (getPlatform() returns the same instance); setIsDirty is a stable in-component helper that only touches refs + stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doSave, loadContent]);

  // --- Auto-save ---
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (!filePathRef.current) return;

    autoSaveTimerRef.current = setTimeout(async () => {
      if (!isDirtyRef.current || !filePathRef.current) return;
      setSaveStatus("saving");
      try {
        const saveContent = relativizeImagePaths(
          markdownRef.current,
          filePathRef.current,
        );
        await platform.saveFile(filePathRef.current, saveContent);
        savedMarkdownRef.current = markdownRef.current;
        setIsDirty(false);
        setSaveStatus("saved");
        clearDraft();
      } catch {
        setSaveStatus("unsaved");
      }
    }, AUTO_SAVE_DELAY);
    // platform is the project-wide stable singleton (getPlatform() returns the same instance); setIsDirty is a stable in-component helper that only touches refs + stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Periodic draft save to localStorage ---
  useEffect(() => {
    draftTimerRef.current = setInterval(() => {
      if (isDirtyRef.current && markdownRef.current) {
        const draftContent = filePathRef.current
          ? relativizeImagePaths(markdownRef.current, filePathRef.current)
          : markdownRef.current;
        saveDraft(draftContent, filePathRef.current);
      }
    }, DRAFT_SAVE_INTERVAL);
    return () => {
      if (draftTimerRef.current) clearInterval(draftTimerRef.current);
    };
  }, []);

  // --- Check for draft recovery on mount ---
  useEffect(() => {
    const draft = loadDraft();
    if (draft && draft.content && draft.content.length > 0) {
      // Only offer recovery if the draft is recent (within 24 hours)
      const age = Date.now() - draft.timestamp;
      if (age < 24 * 60 * 60 * 1000) {
        setDraftRecovery(draft);
      } else {
        clearDraft();
      }
    }
  }, []);

  const handleRecoverDraft = useCallback(() => {
    if (!draftRecovery) return;
    const displayContent = draftRecovery.filePath
      ? resolveImagePaths(draftRecovery.content, draftRecovery.filePath)
      : draftRecovery.content;
    loadContent(displayContent);
    if (draftRecovery.filePath) {
      setFilePath(draftRecovery.filePath);
    }
    markdownRef.current = displayContent;
    setIsDirty(true);
    setSaveStatus("unsaved");
    setDraftRecovery(null);
    clearDraft();
    showToast("Draft recovered");
    // setIsDirty is a stable in-component helper that only touches refs + stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRecovery, loadContent, showToast]);

  const handleDiscardDraft = useCallback(() => {
    setDraftRecovery(null);
    clearDraft();
  }, []);

  // --- Markdown change handler ---
  const outlineTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const handleMarkdownChange = useCallback(
    (markdown: string) => {
      // Source mode emits relative image paths; resolve them so markdownRef
      // always holds the same form (pennivo-file:// URLs) for dirty comparison.
      const normalized =
        sourceModeRef.current && filePathRef.current
          ? resolveImagePaths(markdown, filePathRef.current)
          : markdown;
      markdownRef.current = normalized;
      const dirty = normalized !== savedMarkdownRef.current;

      if (dirty !== isDirtyRef.current) {
        setIsDirty(dirty);
      }

      if (dirty) {
        setSaveStatus("unsaved");
        scheduleAutoSave();
      } else {
        setSaveStatus("saved");
      }

      // Debounced update for outline panel
      if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
      outlineTimerRef.current = setTimeout(
        () => setOutlineMarkdown(markdown),
        300,
      );
    },
    // setIsDirty is a stable in-component helper that only touches refs + stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduleAutoSave],
  );

  // --- Focus mode toggle ---
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      platform.setFullScreen(next);
      return next;
    });
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Typewriter mode toggle ---
  const toggleTypewriterMode = useCallback(() => {
    setTypewriterMode((prev) => {
      const next = !prev;
      typewriterModeRef.current = next;
      return next;
    });
  }, []);

  // --- Export helpers ---
  const getEditorHtml = useCallback((): string => {
    if (loading) return "";
    const editor = getInstance();
    if (!editor) return "";
    let html = "";
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      html = view.dom.innerHTML;
    });
    // Sanitize before sending to main process for export
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      ADD_TAGS: ["foreignObject", "style"],
      ADD_ATTR: [
        "class",
        "data-type",
        "colspan",
        "rowspan",
        "dominant-baseline",
        "text-anchor",
        "transform",
        "marker-end",
        "marker-start",
        "clip-path",
      ],
    });
  }, [loading, getInstance]);

  const doExportHtml = useCallback(async () => {
    const html = getEditorHtml();
    if (!html) return;
    const result = await platform.exportHtml(html, filename);
    if (result) showToast("Exported as HTML");
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getEditorHtml, filename, showToast]);

  const doExportPdf = useCallback(async () => {
    const html = getEditorHtml();
    if (!html) return;
    const result = await platform.exportPdf(html, filename);
    if (result) showToast("Exported as PDF");
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getEditorHtml, filename, showToast]);

  // --- Link popover state ---
  const [linkPopover, setLinkPopover] = useState<{
    hasSelection: boolean;
    selectedText: string;
    anchorRect: { top: number; left: number };
  } | null>(null);

  // --- Table toolbar state ---
  const [tableToolbarVisible, setTableToolbarVisible] = useState(false);

  const [tableSizePicker, setTableSizePicker] = useState<{
    top: number;
    left: number;
    bottom: number;
  } | null>(null);

  // Listen for table-toolbar-update events from the table plugin
  useEffect(() => {
    const handler = (e: Event) => {
      const { visible } = (e as CustomEvent).detail;
      setTableToolbarVisible(visible);
    };
    document.addEventListener("table-toolbar-update", handler);
    return () => document.removeEventListener("table-toolbar-update", handler);
  }, []);

  const handleTableAction = useCallback(
    (action: TableAction) => {
      if (loading) return;
      const editor = getInstance();
      if (!editor) return;

      // Row operations use Milkdown commands (schema-safe)
      switch (action) {
        case "addRowAbove":
          editor.action(callCommand(addRowBeforeCommand.key));
          return;
        case "addRowBelow":
          editor.action(callCommand(addRowAfterCommand.key));
          return;
        case "alignLeft":
          editor.action(callCommand(setAlignCommand.key, "left"));
          return;
        case "alignCenter":
          editor.action(callCommand(setAlignCommand.key, "center"));
          return;
        case "alignRight":
          editor.action(callCommand(setAlignCommand.key, "right"));
          return;
      }

      // Column + delete operations use custom ProseMirror impl
      // (prosemirror-tables commands don't work with Milkdown's table_header_row)
      editor.action((ctx) => {
        executeTableAction(ctx.get(editorViewCtx), action);
      });
    },
    [loading, getInstance],
  );

  // --- Gantt editor state ---
  const [ganttEditor, setGanttEditor] = useState<{
    data: GanttData;
    /** The last mermaid code we wrote, used to find the right code block */
    lastCode: string;
    anchorRect: { top: number; left: number; width: number };
  } | null>(null);

  // Listen for gantt-edit-request events from the mermaid plugin
  useEffect(() => {
    const handleGanttEditRequest = (e: Event) => {
      const { code, rect } = (e as CustomEvent).detail;
      const parsed = parseMermaidGantt(code);
      if (parsed) {
        setGanttEditor({ data: parsed, lastCode: code, anchorRect: rect });
      }
    };
    document.addEventListener("gantt-edit-request", handleGanttEditRequest);
    return () =>
      document.removeEventListener(
        "gantt-edit-request",
        handleGanttEditRequest,
      );
  }, []);

  // Handle gantt data updates → write back to ProseMirror code block
  const ganttEditorRef = useRef(ganttEditor);
  ganttEditorRef.current = ganttEditor;

  const handleGanttUpdate = useCallback(
    (data: GanttData) => {
      const ge = ganttEditorRef.current;
      if (!ge) return;
      const newCode = ganttDataToMermaid(data);

      if (!loading) {
        const editor = getInstance();
        if (editor) {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;

            // Find the gantt code block by scanning for mermaid blocks with gantt content
            let foundPos = -1;
            let foundNode: import("@milkdown/prose/model").Node | null = null;

            state.doc.descendants((node, pos) => {
              if (foundNode) return false;
              if (
                node.type.name === "code_block" &&
                node.attrs["language"] === "mermaid"
              ) {
                const text = node.textContent;
                if (text === ge.lastCode || text.trim().startsWith("gantt")) {
                  foundPos = pos;
                  foundNode = node;
                  return false;
                }
              }
            });

            if (foundNode && foundPos >= 0) {
              // Replace the entire code block with a new one containing the updated code
              const newBlock = state.schema.nodes["code_block"].create(
                { language: "mermaid" },
                state.schema.text(newCode),
              );
              const tr = state.tr.replaceWith(
                foundPos,
                foundPos +
                  (foundNode as import("@milkdown/prose/model").Node).nodeSize,
                newBlock,
              );
              view.dispatch(tr);
            }
          });
        }
      }

      setGanttEditor((prev) =>
        prev ? { ...prev, data, lastCode: newCode } : null,
      );
    },
    [loading, getInstance],
  );

  const handleGanttClose = useCallback(() => {
    setGanttEditor(null);
    // Re-focus editor
    if (!loading) {
      const editor = getInstance();
      if (editor) {
        editor.action((ctx) => {
          ctx.get(editorViewCtx).focus();
        });
      }
    }
  }, [loading, getInstance]);

  // --- Kanban editor state ---
  const [kanbanEditor, setKanbanEditor] = useState<{
    data: KanbanData;
    lastCode: string;
    anchorRect: { top: number; left: number; width: number };
  } | null>(null);

  // Listen for kanban-edit-request events from the mermaid plugin
  useEffect(() => {
    const handleKanbanEditRequest = (e: Event) => {
      const { code, rect } = (e as CustomEvent).detail;
      const parsed = parseKanbanMarkdown(code);
      if (parsed) {
        setKanbanEditor({ data: parsed, lastCode: code, anchorRect: rect });
      }
    };
    document.addEventListener("kanban-edit-request", handleKanbanEditRequest);
    return () =>
      document.removeEventListener(
        "kanban-edit-request",
        handleKanbanEditRequest,
      );
  }, []);

  // Handle kanban data updates → write back to ProseMirror code block
  const kanbanEditorRef = useRef(kanbanEditor);
  kanbanEditorRef.current = kanbanEditor;

  const handleKanbanUpdate = useCallback(
    (data: KanbanData) => {
      const ke = kanbanEditorRef.current;
      if (!ke) return;
      const newCode = kanbanDataToMarkdown(data);

      if (!loading) {
        const editor = getInstance();
        if (editor) {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;

            let foundPos = -1;
            let foundNode: import("@milkdown/prose/model").Node | null = null;

            state.doc.descendants((node, pos) => {
              if (foundNode) return false;
              if (
                node.type.name === "code_block" &&
                node.attrs["language"] === "kanban"
              ) {
                const text = node.textContent;
                if (text === ke.lastCode || text.trim().startsWith("title:")) {
                  foundPos = pos;
                  foundNode = node;
                  return false;
                }
              }
            });

            if (foundNode && foundPos >= 0) {
              const newBlock = state.schema.nodes["code_block"].create(
                { language: "kanban" },
                state.schema.text(newCode),
              );
              const tr = state.tr.replaceWith(
                foundPos,
                foundPos +
                  (foundNode as import("@milkdown/prose/model").Node).nodeSize,
                newBlock,
              );
              view.dispatch(tr);
            }
          });
        }
      }

      setKanbanEditor((prev) =>
        prev ? { ...prev, data, lastCode: newCode } : null,
      );
    },
    [loading, getInstance],
  );

  const handleKanbanClose = useCallback(() => {
    setKanbanEditor(null);
    if (!loading) {
      const editor = getInstance();
      if (editor) {
        editor.action((ctx) => {
          ctx.get(editorViewCtx).focus();
        });
      }
    }
  }, [loading, getInstance]);

  // Escape exits focus mode — but not if a popover, menu, or find bar is open
  useEffect(() => {
    if (!focusMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Let the link popover, titlebar menu, find bar, or command palette handle Escape first
      if (linkPopover) return;
      if (ganttEditor) return;
      if (kanbanEditor) return;
      if (findReplaceOpen) return;
      if (commandPaletteOpen) return;
      if (toolbarCustomizerOpen) return;
      if (aboutOpen) return;
      if (shortcutsOpen) return;
      if (settingsOpen) return;
      if (document.querySelector(".titlebar-menu-dropdown")) return;
      setFocusMode(false);
      platform.setFullScreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // platform is the project-wide stable singleton; reference identity never changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    focusMode,
    linkPopover,
    ganttEditor,
    findReplaceOpen,
    commandPaletteOpen,
    kanbanEditor,
    toolbarCustomizerOpen,
    aboutOpen,
    shortcutsOpen,
    settingsOpen,
  ]);

  const openLinkPopover = useCallback(() => {
    if (loading) return;
    const editor = getInstance();
    if (!editor) return;

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { from, to, empty } = state.selection;

      // Get position for popover anchor
      const coords = view.coordsAtPos(from);
      const selectedText = empty ? "" : state.doc.textBetween(from, to, " ");

      setLinkPopover({
        hasSelection: !empty,
        selectedText,
        anchorRect: { top: coords.bottom, left: coords.left },
      });
    });
  }, [loading, getInstance]);

  const handleLinkConfirm = useCallback(
    (url: string, text: string) => {
      setLinkPopover(null);
      if (loading) return;
      const editor = getInstance();
      if (!editor) return;

      // Normalize URL — add https:// if no protocol
      let href = url;
      if (href && !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href)) {
        href = "https://" + href;
      }

      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const { from, to, empty } = state.selection;

        if (empty) {
          // No selection — insert [text](url) as a text node with link mark
          const linkMark = state.schema.marks["link"].create({ href });
          const textNode = state.schema.text(text, [linkMark]);
          view.dispatch(state.tr.replaceSelectionWith(textNode, false));
        } else {
          // Has selection — wrap it with the link mark
          const linkMark = state.schema.marks["link"].create({ href });
          view.dispatch(state.tr.addMark(from, to, linkMark));
        }
        view.focus();
      });
    },
    [loading, getInstance],
  );

  const handleLinkCancel = useCallback(() => {
    setLinkPopover(null);
    // Re-focus editor
    if (loading) return;
    const editor = getInstance();
    if (!editor) return;
    editor.action((ctx) => {
      ctx.get(editorViewCtx).focus();
    });
  }, [loading, getInstance]);

  // Ctrl+K shortcut for link insert (WYSIWYG only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        if (sourceModeRef.current) return;
        e.preventDefault();
        openLinkPopover();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openLinkPopover]);

  // Zoom shortcuts: Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 / Ctrl+wheel.
  // Electron's default zoom role accelerators don't fire reliably with a
  // frameless window on Windows, so we wire them up explicitly in the renderer.
  useEffect(() => {
    if (platform.platformName !== "electron") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        platform.zoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        platform.zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        platform.resetZoom();
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (e.deltaY < 0) platform.zoomIn();
      else if (e.deltaY > 0) platform.zoomOut();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleWheel);
    };
  }, [platform]);

  // --- Image paste handler ---
  // Returns the src to use for the image node (file:// URL for display).
  // The markdown serializer will write this as the image src.
  const handleImagePaste = useCallback(
    async (file: File): Promise<string | null> => {
      let currentPath = filePathRef.current;

      if (!currentPath) {
        const saved = await doSaveAs();
        if (!saved) return null;
        currentPath = filePathRef.current;
        if (!currentPath) return null;
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Array.from(new Uint8Array(arrayBuffer));
        const mimeType = file.type || "image/png";
        const result = await platform.saveImage(currentPath, buffer, mimeType);
        if (result) {
          showToast("Image saved");
          // Use custom protocol so the image displays in the editor.
          // Encode spaces so the URL is valid in markdown syntax.
          return `pennivo-file:///${result.absolutePath.replace(/ /g, "%20")}`;
        }
        return null;
      } catch {
        showToast("Failed to save image");
        return null;
      }
    },
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast, doSaveAs],
  );

  // Insert a saved image into the editor
  const insertImage = useCallback(
    (src: string) => {
      if (loading) return;
      const editor = getInstance();
      if (!editor) return;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const imageNode = view.state.schema.nodes["image"].create({
          src,
          alt: "",
        });
        view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
      });
    },
    [loading, getInstance],
  );

  // Image-aware paste: checks clipboard for images before falling back to text.
  // Used by both the Electron menu paste (Ctrl+V) and the hamburger menu paste.
  const doSmartPaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], "clipboard.png", { type: imageType });
          const result = await handleImagePaste(file);
          if (result) {
            insertImage(result);
            return;
          }
        }
      }
    } catch {
      // Clipboard API not available or no image — fall through to text paste
    }
    platform.paste();
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleImagePaste, insertImage]);

  // --- Menu event listeners ---
  useEffect(() => {
    const cleanups = [
      platform.onMenuPaste(() => doSmartPaste()),
      platform.onMenuOpen(() => doOpen()),
      platform.onMenuSave(() => doSave()),
      platform.onMenuSaveAs(() => doSaveAs()),
      platform.onMenuSaveAndClose(async () => {
        const saved = await doSave();
        if (saved) {
          platform.closeAfterSave();
        }
      }),
      platform.onMenuToggleFocusMode(() => toggleFocusMode()),
      platform.onMenuNewFile(() => doNewFile()),
      platform.onMenuExportHtml(() => doExportHtml()),
      platform.onMenuExportPdf(() => doExportPdf()),
      platform.onMenuOpenHistory(() => {
        setRecoveryModalMode("history");
        setRecoveryModalOpen(true);
      }),
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    doOpen,
    doSave,
    doSaveAs,
    toggleFocusMode,
    doSmartPaste,
    doNewFile,
    doExportHtml,
    doExportPdf,
  ]);

  // --- Open .md file passed by the OS (double-click in Explorer) ---
  // One-shot pull on mount picks up files from the launching argv;
  // the persistent listener handles second-instance launches.
  const pendingFileCheckedRef = useRef(false);
  useEffect(() => {
    if (!pendingFileCheckedRef.current) {
      pendingFileCheckedRef.current = true;
      platform.getPendingFilePath().then((filePath) => {
        if (filePath) openRecentFile(filePath);
      });
    }
    return platform.onFileOpenFromOS((filePath) => openRecentFile(filePath));
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRecentFile]);

  // --- Auto-update available banner ---
  // Main process only fires this in production after a release has been
  // fully downloaded, so dev runs never see the banner.
  useEffect(() => {
    return platform.onUpdateAvailable((version) => setUpdateAvailable(version));
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Drag-and-drop .md files to open ---
  const [showDropZone, setShowDropZone] = useState(false);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current++;
      if (
        dragCounterRef.current === 1 &&
        e.dataTransfer?.types.includes("Files")
      ) {
        setShowDropZone(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setShowDropZone(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setShowDropZone(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Check for .md / .markdown / .txt files — open the first match
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        if (DROPPABLE_EXTENSIONS.has(ext)) {
          // Use Electron's webUtils.getPathForFile (File.path is empty with contextIsolation)
          const filePath = platform.getPathForFile(file);
          if (filePath) {
            openRecentFile(filePath);
            return;
          }
        }
      }
    };

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRecentFile]);

  // Set window title (taskbar) when filename changes
  useEffect(() => {
    const title = filePath
      ? `${extractFilename(filePath)} \u2014 Pennivo`
      : "untitled \u2014 Pennivo";
    platform.setTitle(title);
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
      if (externalReloadStatusTimerRef.current)
        clearTimeout(externalReloadStatusTimerRef.current);
    };
  }, []);

  // --- Editor view update (toolbar sync) ---
  const handleViewUpdate = useCallback((view: EditorView) => {
    setActiveFormats(getActiveFormats(view));

    // Typewriter mode: scroll cursor to vertical center of the editor area
    if (typewriterModeRef.current) {
      const area = document.querySelector(".app-editor-area");
      if (!area) return;
      const coords = view.coordsAtPos(view.state.selection.head);
      const areaRect = area.getBoundingClientRect();
      const cursorRelative = coords.top - areaRect.top + area.scrollTop;
      const targetScroll = cursorRelative - areaRect.height / 2;
      area.scrollTop = targetScroll;
    }
  }, []);

  // --- Toolbar actions ---
  const handleAction = useCallback(
    (action: ToolbarAction) => {
      if (action === "toggleTheme") {
        toggleTheme();
        return;
      }
      if (action === "focusMode") {
        toggleFocusMode();
        return;
      }
      if (action === "typewriterMode") {
        toggleTypewriterMode();
        return;
      }
      if (action === "sourceMode") {
        // Guard switching to WYSIWYG based on file size tiers
        if (sourceModeRef.current) {
          const size = fileSizeRef.current;
          if (size > FILE_SIZE_SOURCE_LOCKED) {
            showToast(
              "This file is too large for WYSIWYG mode — it would crash the editor",
            );
            return;
          }
          if (size > FILE_SIZE_SOURCE_DEFAULT) {
            showToast(
              "Warning — WYSIWYG may be slow with this file size",
              true,
            );
          }
        }

        setSourceMode((prev) => {
          const next = !prev;
          sourceModeRef.current = next;

          // Capture scroll percentage from the outgoing editor
          let scrollFraction = 0;
          if (next) {
            // WYSIWYG → source: get scroll from .app-editor-area
            const area = document.querySelector(".app-editor-area");
            if (area) {
              const maxScroll = area.scrollHeight - area.clientHeight;
              scrollFraction = maxScroll > 0 ? area.scrollTop / maxScroll : 0;
            }
            // Show relative paths in source mode for clean markdown
            const sourceMarkdown = filePathRef.current
              ? relativizeImagePaths(markdownRef.current, filePathRef.current)
              : markdownRef.current;
            setSourceContent(sourceMarkdown);
          } else {
            // Source → WYSIWYG: get scroll from CodeMirror scroller
            const cmScroller = cmViewRef.current?.scrollDOM;
            if (cmScroller) {
              const maxScroll =
                cmScroller.scrollHeight - cmScroller.clientHeight;
              scrollFraction =
                maxScroll > 0 ? cmScroller.scrollTop / maxScroll : 0;
            }
            // Resolve relative paths back to pennivo-file:// for WYSIWYG rendering
            const displayMarkdown = filePathRef.current
              ? resolveImagePaths(markdownRef.current, filePathRef.current)
              : markdownRef.current;
            markdownRef.current = displayMarkdown;
            const ed = getInstance();
            if (ed && !loading) {
              ed.action(replaceAll(displayMarkdown));
            }
          }

          // Restore scroll in the incoming editor after DOM updates.
          // Double-rAF ensures we run after React effects (focus) and
          // editor-internal scroll adjustments have settled.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (next) {
                // Apply to CodeMirror scroller
                const cmScroller = cmViewRef.current?.scrollDOM;
                if (cmScroller) {
                  const maxScroll =
                    cmScroller.scrollHeight - cmScroller.clientHeight;
                  cmScroller.scrollTop = scrollFraction * maxScroll;
                }
              } else {
                // Apply to .app-editor-area
                const area = document.querySelector(".app-editor-area");
                if (area) {
                  const maxScroll = area.scrollHeight - area.clientHeight;
                  area.scrollTop = scrollFraction * maxScroll;
                }
              }
            });
          });

          return next;
        });
        return;
      }
      if (action === "link") {
        openLinkPopover();
        return;
      }
      if (action === "mermaid") {
        if (loading) return;
        const editor = getInstance();
        if (!editor) return;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const codeBlock = state.schema.nodes["code_block"].create(
            { language: "mermaid" },
            state.schema.text("graph TD\n    A[Start] --> B[End]"),
          );
          view.dispatch(state.tr.replaceSelectionWith(codeBlock));
          view.focus();
        });
        return;
      }
      if (action === "gantt") {
        if (loading) return;
        const editor = getInstance();
        if (!editor) return;
        const defaultData = createDefaultGanttData();
        const code = ganttDataToMermaid(defaultData);
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const codeBlock = state.schema.nodes["code_block"].create(
            { language: "mermaid" },
            state.schema.text(code),
          );
          const tr = state.tr.replaceSelectionWith(codeBlock);
          view.dispatch(tr);
          view.focus();

          // Open the gantt editor after the mermaid plugin renders the preview
          queueMicrotask(() => {
            const previewEl = document.querySelector(
              ".mermaid-preview-widget:last-of-type",
            ) as HTMLElement;
            const rect = previewEl
              ? previewEl.getBoundingClientRect()
              : { bottom: 200, left: 100, width: 400 };
            setGanttEditor({
              data: defaultData,
              lastCode: code,
              anchorRect: {
                top: rect.bottom ?? 200,
                left: rect.left ?? 100,
                width: rect.width ?? 400,
              },
            });
          });
        });
        return;
      }
      if (action === "kanban") {
        if (loading) return;
        const editor = getInstance();
        if (!editor) return;
        const defaultData = createDefaultKanbanData();
        const code = kanbanDataToMarkdown(defaultData);
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const codeBlock = state.schema.nodes["code_block"].create(
            { language: "kanban" },
            state.schema.text(code),
          );
          const tr = state.tr.replaceSelectionWith(codeBlock);
          view.dispatch(tr);
          view.focus();

          // Open the kanban editor after the plugin renders the preview
          queueMicrotask(() => {
            const previewEl = document.querySelector(
              ".kanban-preview-widget:last-of-type",
            ) as HTMLElement;
            const rect = previewEl
              ? previewEl.getBoundingClientRect()
              : { bottom: 200, left: 100, width: 800 };
            setKanbanEditor({
              data: defaultData,
              lastCode: code,
              anchorRect: {
                top: rect.bottom ?? 200,
                left: rect.left ?? 100,
                width: rect.width ?? 800,
              },
            });
          });
        });
        return;
      }
      if (action === "image") {
        (async () => {
          let currentPath = filePathRef.current;
          if (!currentPath) {
            const saved = await doSaveAs();
            if (!saved) return;
            currentPath = filePathRef.current;
            if (!currentPath) return;
          }
          const result = await platform.pickImage(currentPath);
          if (!result) return;
          const src = `pennivo-file:///${result.absolutePath.replace(/ /g, "%20")}`;
          insertImage(src);
          showToast("Image inserted");
        })();
        return;
      }
      if (loading) return;

      const editor = getInstance();
      if (!editor) return;

      switch (action) {
        case "bold":
          editor.action(callCommand(toggleStrongCommand.key));
          break;
        case "italic":
          editor.action(callCommand(toggleEmphasisCommand.key));
          break;
        case "strikethrough":
          editor.action(callCommand(toggleStrikethroughCommand.key));
          break;

        case "h1":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const isH1 = getActiveFormats(view).has("h1");
            if (isH1) callCommand(turnIntoTextCommand.key)(ctx);
            else callCommand(wrapInHeadingCommand.key, 1)(ctx);
          });
          break;
        case "h2":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const isH2 = getActiveFormats(view).has("h2");
            if (isH2) callCommand(turnIntoTextCommand.key)(ctx);
            else callCommand(wrapInHeadingCommand.key, 2)(ctx);
          });
          break;

        case "bulletList":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const formats = getActiveFormats(view);
            if (formats.has("bulletList")) {
              callCommand(liftListItemCommand.key)(ctx);
            } else {
              if (formats.has("taskList") || formats.has("orderedList")) {
                callCommand(liftListItemCommand.key)(ctx);
              }
              wrapSelectionAsList(view, "bullet_list", false);
            }
          });
          break;
        case "orderedList":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const formats = getActiveFormats(view);
            if (formats.has("orderedList")) {
              callCommand(liftListItemCommand.key)(ctx);
            } else {
              if (formats.has("taskList") || formats.has("bulletList")) {
                callCommand(liftListItemCommand.key)(ctx);
              }
              wrapSelectionAsList(view, "ordered_list", false);
            }
          });
          break;

        case "taskList":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const formats = getActiveFormats(view);
            if (formats.has("taskList")) {
              callCommand(liftListItemCommand.key)(ctx);
            } else {
              if (formats.has("orderedList") || formats.has("bulletList")) {
                callCommand(liftListItemCommand.key)(ctx);
              }
              // Wrap each selected block in its own bullet_list item, then
              // mark every new list_item with checked:false so they render
              // as task-list checkboxes.
              wrapSelectionAsList(view, "bullet_list", true);
            }
          });
          break;

        case "blockquote":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const inBq = getActiveFormats(view).has("blockquote");
            if (inBq) lift(view.state, view.dispatch);
            else callCommand(wrapInBlockquoteCommand.key)(ctx);
          });
          break;

        case "table": {
          const btn = document.querySelector('button[aria-label="Table"]');
          if (btn) {
            const r = btn.getBoundingClientRect();
            setTableSizePicker({ top: r.top, left: r.left, bottom: r.bottom });
          } else {
            // Fallback (e.g. command palette) — insert 3×3 directly
            editor.action(
              callCommand(insertTableCommand.key, { row: 3, col: 3 }),
            );
          }
          break;
        }

        case "code":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            const inCodeBlock =
              state.selection.$from.parent.type.name === "code_block";

            if (inCodeBlock) {
              // Exit code block → paragraph
              callCommand(turnIntoTextCommand.key)(ctx);
            } else if (state.selection.empty) {
              // No selection → create code block
              callCommand(createCodeBlockCommand.key)(ctx);
            } else {
              // Has selection → toggle inline code
              callCommand(toggleInlineCodeCommand.key)(ctx);
            }
          });
          break;
      }
    },
    // platform is the project-wide stable singleton (getPlatform() returns the same instance); setSourceMode is a useCallback with [] deps — its identity is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      loading,
      getInstance,
      toggleTheme,
      toggleFocusMode,
      toggleTypewriterMode,
      showToast,
      insertImage,
      doSaveAs,
      openLinkPopover,
      setTableSizePicker,
    ],
  );

  // --- Table size picker selection ---
  const handleTableSizeSelect = useCallback(
    (rows: number, cols: number) => {
      setTableSizePicker(null);
      if (loading) return;
      const editor = getInstance();
      if (!editor) return;
      editor.action(
        callCommand(insertTableCommand.key, { row: rows, col: cols }),
      );
    },
    [loading, getInstance],
  );

  // --- Get ProseMirror view (for Find & Replace) ---
  const getCmView = useCallback(():
    | import("@codemirror/view").EditorView
    | null => {
    return cmViewRef.current;
  }, []);

  const getEditorView = useCallback(():
    | import("@milkdown/prose/view").EditorView
    | null => {
    if (loading) return null;
    const editor = getInstance();
    if (!editor) return null;
    let view: import("@milkdown/prose/view").EditorView | null = null;
    editor.action((ctx) => {
      view = ctx.get(editorViewCtx);
    });
    return view;
  }, [loading, getInstance]);

  // --- Outline heading click ---
  const handleOutlineHeadingClick = useCallback((heading: HeadingEntry) => {
    if (sourceModeRef.current) {
      // Source mode: find the heading line in the CodeMirror doc and scroll to it
      const view = cmViewRef.current;
      if (!view) return;
      const doc = view.state.doc.toString();
      const lines = doc.split("\n");
      let headingCount = 0;
      let inCodeBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^```/.test(line.trimStart())) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (inCodeBlock) continue;
        if (/^#{1,6}\s+/.test(line)) {
          if (headingCount === heading.index) {
            // Scroll CodeMirror to this line
            const lineInfo = view.state.doc.line(i + 1);
            view.dispatch({
              selection: { anchor: lineInfo.from },
              scrollIntoView: true,
            });
            view.focus();
            return;
          }
          headingCount++;
        }
      }
    } else {
      // WYSIWYG mode: find the heading DOM element and scroll to it
      const editorEl = document.querySelector(".editor-wrapper .milkdown");
      if (!editorEl) return;
      const headingEls = editorEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
      const el = headingEls[heading.index] as HTMLElement | undefined;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, []);

  // Global keyboard shortcuts — single listener instead of 4 separate ones
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.shiftKey) {
        if (e.key === "P") {
          e.preventDefault();
          setCommandPaletteOpen(true);
        } else if (e.key === "O") {
          e.preventDefault();
          setOutlineVisible((v) => !v);
        } else if (e.key === "B") {
          e.preventDefault();
          setSidebarVisible((v) => !v);
        }
      } else {
        if (e.key === "f") {
          e.preventDefault();
          setFindReplaceOpen(true);
        } else if (e.key === "/") {
          e.preventDefault();
          setShortcutsOpen((v) => !v);
        } else if (e.key === ",") {
          e.preventDefault();
          setSettingsOpen((v) => !v);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // --- Command palette commands ---
  const paletteCommands = useMemo<CommandItem[]>(
    () => [
      // Format
      {
        id: "bold",
        label: "Bold",
        shortcut: "Ctrl+B",
        category: "Format",
        keywords: "strong",
      },
      {
        id: "italic",
        label: "Italic",
        shortcut: "Ctrl+I",
        category: "Format",
        keywords: "emphasis",
      },
      { id: "strikethrough", label: "Strikethrough", category: "Format" },
      {
        id: "h1",
        label: "Heading 1",
        category: "Format",
        keywords: "title header",
      },
      {
        id: "h2",
        label: "Heading 2",
        category: "Format",
        keywords: "subtitle header",
      },
      {
        id: "bulletList",
        label: "Bullet List",
        category: "Format",
        keywords: "unordered",
      },
      {
        id: "orderedList",
        label: "Ordered List",
        category: "Format",
        keywords: "numbered",
      },
      {
        id: "taskList",
        label: "Task List",
        category: "Format",
        keywords: "checkbox todo",
      },
      {
        id: "blockquote",
        label: "Blockquote",
        category: "Format",
        keywords: "quote",
      },
      {
        id: "code",
        label: "Code",
        category: "Format",
        keywords: "inline block",
      },
      { id: "table", label: "Table", category: "Format" },
      {
        id: "link",
        label: "Insert Link",
        shortcut: "Ctrl+K",
        category: "Format",
        keywords: "url href",
      },
      { id: "image", label: "Insert Image", category: "Format" },
      {
        id: "mermaid",
        label: "Insert Mermaid Diagram",
        category: "Format",
        keywords: "diagram chart flowchart sequence",
      },
      {
        id: "gantt",
        label: "Insert Gantt Chart",
        category: "Format",
        keywords: "gantt chart timeline project schedule task",
      },
      {
        id: "kanban",
        label: "Insert Kanban Board",
        category: "Format",
        keywords: "kanban board column card task",
      },
      // File
      {
        id: "newFile",
        label: "New File",
        shortcut: "Ctrl+N",
        category: "File",
      },
      { id: "open", label: "Open File", shortcut: "Ctrl+O", category: "File" },
      { id: "save", label: "Save", shortcut: "Ctrl+S", category: "File" },
      {
        id: "saveAs",
        label: "Save As",
        shortcut: "Ctrl+Shift+S",
        category: "File",
      },
      {
        id: "exportHtml",
        label: "Export as HTML",
        shortcut: "Ctrl+Shift+E",
        category: "File",
      },
      { id: "exportPdf", label: "Export as PDF", category: "File" },
      // View
      {
        id: "sourceMode",
        label: "Toggle Source Mode",
        category: "View",
        keywords: "markdown code raw",
      },
      {
        id: "focusMode",
        label: "Toggle Focus Mode",
        shortcut: "Ctrl+Shift+F",
        category: "View",
        keywords: "zen distraction free fullscreen",
      },
      {
        id: "typewriterMode",
        label: "Toggle Typewriter Mode",
        category: "View",
        keywords: "center scroll focus writing",
      },
      {
        id: "toggleTheme",
        label: "Toggle Theme",
        category: "View",
        keywords: "dark light mode",
      },
      {
        id: "toggleSidebar",
        label: "Toggle Sidebar",
        shortcut: "Ctrl+Shift+B",
        category: "View",
        keywords: "file tree panel",
      },
      {
        id: "findReplace",
        label: "Find & Replace",
        shortcut: "Ctrl+F",
        category: "View",
        keywords: "search",
      },
      {
        id: "toggleOutline",
        label: "Toggle Outline",
        shortcut: "Ctrl+Shift+O",
        category: "View",
        keywords: "toc table of contents headings",
      },
      { id: "zoomIn", label: "Zoom In", category: "View" },
      { id: "zoomOut", label: "Zoom Out", category: "View" },
      { id: "resetZoom", label: "Reset Zoom", category: "View" },
      // Themes
      {
        id: "cycleTheme",
        label: "Cycle Color Scheme",
        category: "Theme",
        keywords: "theme color style",
      },
      {
        id: "themeDefault",
        label: "Theme: Default",
        category: "Theme",
        keywords: "color scheme original green",
      },
      {
        id: "themeSepia",
        label: "Theme: Sepia",
        category: "Theme",
        keywords: "color scheme warm parchment brown",
      },
      {
        id: "themeNord",
        label: "Theme: Nord",
        category: "Theme",
        keywords: "color scheme arctic ice blue",
      },
      {
        id: "themeRosepine",
        label: "Theme: Rose Pine",
        category: "Theme",
        keywords: "color scheme rose pink purple",
      },
      // Settings
      {
        id: "customizeToolbar",
        label: "Customize Toolbar",
        category: "Settings",
        keywords: "toolbar buttons customize configure",
      },
      {
        id: "spellcheckSettings",
        label: "Spellcheck Languages",
        category: "Settings",
        keywords: "spell check language dictionary",
      },
      {
        id: "openSettings",
        label: "Open Settings",
        shortcut: "Ctrl+,",
        category: "Settings",
        keywords: "preferences options config",
      },
      // Help
      {
        id: "showShortcuts",
        label: "Keyboard Shortcuts",
        shortcut: "Ctrl+/",
        category: "Help",
        keywords: "keys hotkeys bindings",
      },
      {
        id: "showAbout",
        label: "About Pennivo",
        category: "Help",
        keywords: "version info",
      },
    ],
    [],
  );

  // --- Hamburger menu actions ---
  const focusEditor = useCallback(() => {
    if (sourceModeRef.current) {
      // Focus the CodeMirror editor
      const cmEl = document.querySelector(
        ".source-editor-wrapper .cm-content",
      ) as HTMLElement | null;
      cmEl?.focus();
      return;
    }
    if (loading) return;
    const editor = getInstance();
    if (!editor) return;
    editor.action((ctx) => {
      ctx.get(editorViewCtx).focus();
    });
  }, [loading, getInstance]);

  const handleMenuAction = useCallback(
    (action: MenuAction) => {
      switch (action) {
        case "open":
          doOpen();
          break;
        case "save":
          doSave();
          break;
        case "saveAs":
          doSaveAs();
          break;
        case "openHistory":
          setRecoveryModalMode("history");
          setRecoveryModalOpen(true);
          break;
        case "quit":
          platform.close();
          break;
        case "undo":
        case "redo":
        case "cut":
        case "copy":
        case "paste":
        case "selectAll": {
          // Refocus editor first — menu click steals focus
          focusEditor();
          queueMicrotask(() => {
            if (action === "paste") {
              doSmartPaste();
            } else {
              document.execCommand(action);
            }
          });
          break;
        }
        case "focusMode":
          toggleFocusMode();
          break;
        case "sourceMode":
          handleAction("sourceMode");
          break;
        case "toggleTheme":
          toggleTheme();
          break;
        case "toggleSidebar":
          setSidebarVisible((v) => !v);
          break;
        case "toggleOutline":
          setOutlineVisible((v) => !v);
          break;
        case "setFolder":
          handleChooseFolder();
          break;
        case "findReplace":
          setFindReplaceOpen(true);
          break;
        case "newFile":
          doNewFile();
          break;
        case "exportHtml":
          doExportHtml();
          break;
        case "exportPdf":
          doExportPdf();
          break;
        case "clearRecentFiles":
          platform.clearRecentFiles().then(() => loadRecentFiles());
          break;
        case "zoomIn":
          platform.zoomIn();
          break;
        case "zoomOut":
          platform.zoomOut();
          break;
        case "resetZoom":
          platform.resetZoom();
          break;
        case "cycleTheme":
          cycleColorScheme();
          showToast(
            `Theme: ${colorScheme === "default" ? "Sepia" : colorScheme === "sepia" ? "Nord" : colorScheme === "nord" ? "Rose Pine" : "Default"}`,
          );
          break;
        case "themeDefault":
          setColorScheme("default");
          showToast("Theme: Default");
          break;
        case "themeSepia":
          setColorScheme("sepia");
          showToast("Theme: Sepia");
          break;
        case "themeNord":
          setColorScheme("nord");
          showToast("Theme: Nord");
          break;
        case "themeRosepine":
          setColorScheme("rosepine");
          showToast("Theme: Rose Pine");
          break;
        case "customizeToolbar":
          setToolbarCustomizerOpen(true);
          break;
        case "openSettings":
          setSettingsOpen(true);
          break;
        case "showShortcuts":
          setShortcutsOpen(true);
          break;
        case "showAbout":
          setAboutOpen(true);
          break;
        case "spellcheckSettings": {
          // Cycle through common language presets
          (async () => {
            const current = (await platform.getSpellCheckLanguages()) ?? [];
            const presets = [
              ["en-US"],
              ["en-US", "en-GB"],
              ["en-US", "fr"],
              ["en-US", "es"],
              ["en-US", "de"],
            ];
            const currentKey = current.join(",");
            const currentIdx = presets.findIndex(
              (p) => p.join(",") === currentKey,
            );
            const next = presets[(currentIdx + 1) % presets.length];
            await platform.setSpellCheckLanguages(next);
            showToast(`Spellcheck: ${next.join(", ")}`);
          })();
          break;
        }
      }
    },
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      doOpen,
      doSave,
      doSaveAs,
      toggleFocusMode,
      toggleTheme,
      focusEditor,
      doSmartPaste,
      loadRecentFiles,
      doNewFile,
      doExportHtml,
      doExportPdf,
      handleChooseFolder,
      handleAction,
      cycleColorScheme,
      setColorScheme,
      colorScheme,
      showToast,
    ],
  );

  // --- Command palette handler ---
  const handleCommandSelect = useCallback(
    (id: string) => {
      setCommandPaletteOpen(false);

      // Table from command palette → insert 3×3 directly (no size picker)
      if (id === "table") {
        if (!loading) {
          const editor = getInstance();
          if (editor)
            editor.action(
              callCommand(insertTableCommand.key, { row: 3, col: 3 }),
            );
        }
        return;
      }

      const toolbarActions: Set<string> = new Set([
        "bold",
        "italic",
        "strikethrough",
        "h1",
        "h2",
        "bulletList",
        "orderedList",
        "taskList",
        "blockquote",
        "link",
        "image",
        "mermaid",
        "gantt",
        "kanban",
        "code",
        "focusMode",
        "toggleTheme",
        "sourceMode",
        "typewriterMode",
      ]);

      if (toolbarActions.has(id)) {
        handleAction(id as ToolbarAction);
      } else {
        handleMenuAction(id as MenuAction);
      }
    },
    [handleAction, handleMenuAction, loading, getInstance],
  );

  const toolbarFormats = (() => {
    const formats = new Set(activeFormats);
    if (focusMode) formats.add("focusMode");
    if (sourceMode) formats.add("sourceMode");
    if (typewriterMode) formats.add("typewriterMode");
    return formats;
  })();

  return (
    <AppShell
      filename={filename}
      isDirty={isDirty}
      wordCount={wordCount}
      charCount={charCount}
      saveStatus={saveStatus}
      showWordCount={showWordCount}
      focusMode={focusMode}
      sourceMode={sourceMode}
      typewriterMode={typewriterMode}
      onMenuAction={handleMenuAction}
      recentFiles={recentFiles}
      onOpenRecentFile={openRecentFile}
      archiveStatus={archiveStatus}
      onArchiveStatusClick={() => {
        // Open Settings → Recovery → "Where snapshots are stored". Reuses
        // the slice 2 deep-link plumbing.
        setSettingsScrollSection("recovery");
        setHighlightRecoveryRetention(false);
        setSettingsOpen(true);
      }}
      toolbar={
        <Toolbar
          activeFormats={toolbarFormats}
          onAction={handleAction}
          sourceMode={sourceMode}
          visibleActions={toolbarConfig}
          onCustomize={() => setToolbarCustomizerOpen(true)}
        />
      }
      sidebar={
        <Sidebar
          visible={sidebarVisible}
          folderPath={sidebarFolder}
          tree={sortedSidebarTree}
          currentFilePath={filePath}
          onFileClick={handleSidebarFileClick}
          onChooseFolder={handleChooseFolder}
          sortKey={sidebarSort}
          onSortChange={handleSidebarSortChange}
          onShowInExplorer={handleSidebarShowInExplorer}
          onShowHistory={(_p) => {
            setRecoveryModalMode("history");
            setRecoveryModalOpen(true);
          }}
          onShowTrash={() => {
            setRecoveryModalMode("trash");
            setRecoveryModalOpen(true);
          }}
          trashCount={trashCount}
          onRenameFile={handleSidebarRenameFile}
          onDeleteFile={handleSidebarDeleteFile}
          onGetAssetSummary={(p) => platform.getAssetSummary(p)}
          onMoveFile={handleSidebarMoveFile}
          onShowToast={(msg) => showToast(msg)}
        />
      }
      outline={
        <OutlinePanel
          visible={outlineVisible}
          markdown={outlineMarkdown}
          sourceMode={sourceMode}
          onHeadingClick={handleOutlineHeadingClick}
        />
      }
      findReplace={
        <FindReplace
          visible={findReplaceOpen}
          getView={getEditorView}
          getCmView={getCmView}
          sourceMode={sourceMode}
          onClose={() => setFindReplaceOpen(false)}
        />
      }
    >
      <div
        className={
          sourceMode ? "editor-pane editor-pane--hidden" : "editor-pane"
        }
      >
        <Editor
          onWordCountChange={setWordCount}
          onCharCountChange={setCharCount}
          onMarkdownChange={handleMarkdownChange}
          onViewUpdate={handleViewUpdate}
          onImagePaste={handleImagePaste}
        />
      </div>
      {sourceEverActivated && (
        <div
          className={
            sourceMode
              ? "editor-pane editor-pane--source"
              : "editor-pane editor-pane--hidden"
          }
        >
          <Suspense fallback={null}>
            <LazySourceEditor
              content={sourceContent}
              active={sourceMode}
              typewriterMode={typewriterMode}
              onMarkdownChange={handleMarkdownChange}
              onWordCountChange={setWordCount}
              onCharCountChange={setCharCount}
              onViewReady={(view) => {
                cmViewRef.current = view;
              }}
              onViewDestroy={() => {
                cmViewRef.current = null;
              }}
            />
          </Suspense>
        </div>
      )}
      {showDropZone && (
        <div className="drop-zone-overlay">
          <div className="drop-zone-content">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <polyline points="9 15 12 12 15 15" />
            </svg>
            <span>Drop to open</span>
          </div>
        </div>
      )}
      <CommandPalette
        visible={commandPaletteOpen}
        commands={paletteCommands}
        onSelect={handleCommandSelect}
        onClose={() => setCommandPaletteOpen(false)}
      />
      <RecoveryModal
        open={recoveryModalOpen}
        mode={recoveryModalMode}
        title={
          recoveryModalMode === "history" && filePath
            ? `History — ${extractFilename(filePath)}`
            : recoveryModalMode === "compare-merge" && filePath
              ? `Compare & merge — ${extractFilename(filePath)}`
              : undefined
        }
        onModeChange={(m) => setRecoveryModalMode(m)}
        onClose={() => {
          setRecoveryModalOpen(false);
          setCompareMergeSelection(null);
        }}
        onCloseRequest={
          recoveryModalMode === "compare-merge"
            ? () => {
                // Compare-merge mode: route × / overlay-click through the
                // body's discard-confirm guard when one is published. With
                // no published guard (selection unset, etc.) fall through
                // to a plain close.
                const guard = compareMergeCloseGuardRef.current;
                if (guard) guard();
                else {
                  setRecoveryModalOpen(false);
                  setCompareMergeSelection(null);
                }
              }
            : undefined
        }
        onBack={
          recoveryModalMode === "compare-merge"
            ? () => {
                // Esc / back-button: drop back to History but preserve the
                // selection so re-entering Compare reuses the same pair.
                setRecoveryModalMode("history");
              }
            : undefined
        }
      >
        {shouldShowCapBanner(capWarning, {
          capBannerDismissedAt,
          lastCapWarningOverageBytes,
        }) &&
          capWarning &&
          recoveryModalMode !== "compare-merge" && (
            <CapExceededBanner
              warning={capWarning}
              onOpenSettings={() => {
                setRecoveryModalOpen(false);
                setSettingsScrollSection("recovery");
                setHighlightRecoveryRetention(false);
                setSettingsOpen(true);
              }}
              onChangeRules={() => {
                setRecoveryModalOpen(false);
                setSettingsScrollSection("recovery");
                setHighlightRecoveryRetention(true);
                setSettingsOpen(true);
              }}
              onManageManually={() => {
                if (capWarning)
                  void persistCapBannerDismissal(capWarning.overageBytes);
                showToast("We'll wait — delete snapshots from the timeline.");
              }}
              onDismiss={() => {
                if (capWarning)
                  void persistCapBannerDismissal(capWarning.overageBytes);
              }}
            />
          )}
        {recoveryModalMode === "history" ? (
          <RecoveryModalWidthMeasurer onWidth={setRecoveryModalWidth}>
            <HistoryView
              filePath={filePath}
              filename={filePath ? extractFilename(filePath) : null}
              currentContent={markdownRef.current ?? ""}
              onOpenFilePath={(p) => openRecentFile(p)}
              onShowToast={(msg, isError) =>
                isError ? showToast(msg) : showToast(msg)
              }
              timelineWidth={recoveryHistoryLayout.timelineWidth}
              timelineCollapsed={recoveryHistoryLayout.timelineCollapsed}
              previewCollapsed={recoveryHistoryLayout.previewCollapsed}
              onLayoutChange={(next) =>
                setRecoveryHistoryLayout((prev) => ({ ...prev, ...next }))
              }
              modalWidth={recoveryModalWidth}
              onEnterCompareMerge={(sel) => {
                setCompareMergeSelection(sel);
                setRecoveryModalMode("compare-merge");
              }}
            />
          </RecoveryModalWidthMeasurer>
        ) : recoveryModalMode === "trash" ? (
          <RecoveryModalWidthMeasurer onWidth={setRecoveryModalWidth}>
            <TrashView
              onShowToast={(msg, isError) =>
                isError ? showToast(msg) : showToast(msg)
              }
              timelineWidth={recoveryHistoryLayout.timelineWidth}
              timelineCollapsed={recoveryHistoryLayout.timelineCollapsed}
              previewCollapsed={recoveryHistoryLayout.previewCollapsed}
              onLayoutChange={(next) =>
                setRecoveryHistoryLayout((prev) => ({ ...prev, ...next }))
              }
              modalWidth={recoveryModalWidth}
            />
          </RecoveryModalWidthMeasurer>
        ) : compareMergeSelection && filePath ? (
          <CompareMergeView
            filePath={filePath}
            filename={extractFilename(filePath)}
            selection={compareMergeSelection}
            currentContent={markdownRef.current ?? ""}
            onShowToast={(msg) => showToast(msg)}
            onOpenFilePath={(p) => openRecentFile(p)}
            onClose={() => {
              setRecoveryModalOpen(false);
              setCompareMergeSelection(null);
            }}
            onBack={() => setRecoveryModalMode("history")}
            onAfterReplace={() => {
              if (filePath) void openRecentFile(filePath);
            }}
            closeGuardRef={compareMergeCloseGuardRef}
          />
        ) : (
          <div className="recovery-modal-placeholder">
            <span className="recovery-modal-placeholder-title">
              No comparison selected
            </span>
            <span className="recovery-modal-placeholder-sub">
              Pick two snapshots in History and click Compare &amp; merge to
              open the merge view.
            </span>
          </div>
        )}
      </RecoveryModal>
      {capToastVisible && capWarning && (
        <CapExceededToast
          warning={capWarning}
          onOpenSettings={() => {
            setCapToastVisible(false);
            setSettingsScrollSection("recovery");
            setHighlightRecoveryRetention(false);
            setSettingsOpen(true);
          }}
          onDismiss={() => setCapToastVisible(false)}
        />
      )}
      {externalChangeToast && (
        <ExternalChangeToast
          absolutePath={externalChangeToast.absolutePath}
          variant={externalChangeToast.variant}
          onViewHistory={() => {
            // Open the recovery modal in History mode for the affected
            // file. Note: we don't auto-switch the editor's open file —
            // the user might be looking at a different document right now.
            // The History view's `filePath` prop comes from the editor's
            // current path, so the user gets the timeline of whichever file
            // they're presently editing. If they want to inspect the
            // externally-changed file specifically, they open it in the
            // sidebar first.
            setExternalChangeToast(null);
            setRecoveryModalMode("history");
            setRecoveryModalOpen(true);
          }}
          onCompareMerge={() => {
            // Dirty conflict: reconcile the editor's unsaved version (the
            // merge "current"/left side) against the new on-disk version
            // (right = the external snapshot just captured) rather than
            // clobbering. Opens the existing Phase 13a Compare & merge view.
            const snapshotId = externalChangeToast.snapshotId;
            setExternalChangeToast(null);
            if (!snapshotId) return;
            setCompareMergeSelection({ left: "current", right: snapshotId });
            setRecoveryModalMode("compare-merge");
            setRecoveryModalOpen(true);
          }}
          onDismiss={() => setExternalChangeToast(null)}
        />
      )}
      {draftRecovery && (
        <div className="draft-recovery-banner">
          <span>
            Unsaved draft found
            {draftRecovery.filePath
              ? ` for ${extractFilename(draftRecovery.filePath)}`
              : ""}
            . Recover it?
          </span>
          <div className="draft-recovery-actions">
            <button
              className="draft-recovery-btn draft-recovery-btn--primary"
              onClick={handleRecoverDraft}
            >
              Recover
            </button>
            <button className="draft-recovery-btn" onClick={handleDiscardDraft}>
              Discard
            </button>
          </div>
        </div>
      )}
      {updateAvailable && (
        <div className="draft-recovery-banner" role="status" aria-live="polite">
          <span>A new version of Pennivo is ready. Restart to update.</span>
          <div className="draft-recovery-actions">
            <button
              className="draft-recovery-btn draft-recovery-btn--primary"
              onClick={() => platform.installUpdate()}
            >
              Restart Now
            </button>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {linkPopover && (
        <LinkPopover
          hasSelection={linkPopover.hasSelection}
          initialText={linkPopover.selectedText}
          anchorRect={linkPopover.anchorRect}
          onConfirm={handleLinkConfirm}
          onCancel={handleLinkCancel}
        />
      )}
      {ganttEditor && (
        <Suspense fallback={null}>
          <LazyGanttEditorPanel
            data={ganttEditor.data}
            anchorRect={ganttEditor.anchorRect}
            onUpdate={handleGanttUpdate}
            onClose={handleGanttClose}
          />
        </Suspense>
      )}
      {kanbanEditor && (
        <Suspense fallback={null}>
          <LazyKanbanEditorPanel
            data={kanbanEditor.data}
            anchorRect={kanbanEditor.anchorRect}
            onUpdate={handleKanbanUpdate}
            onClose={handleKanbanClose}
          />
        </Suspense>
      )}
      {tableToolbarVisible && !sourceMode && (
        <TableToolbar onAction={handleTableAction} />
      )}
      {tableSizePicker && (
        <TableSizePicker
          anchorRect={tableSizePicker}
          onSelect={handleTableSizeSelect}
          onClose={() => setTableSizePicker(null)}
        />
      )}
      {toolbarCustomizerOpen && (
        <Suspense fallback={null}>
          <LazyToolbarCustomizer
            config={toolbarConfig}
            onUpdate={handleToolbarConfigUpdate}
            onClose={() => setToolbarCustomizerOpen(false)}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <LazyAboutDialog
          visible={aboutOpen}
          onClose={() => setAboutOpen(false)}
        />
      </Suspense>
      <Suspense fallback={null}>
        <LazyShortcutsSheet
          visible={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />
      </Suspense>
      <Suspense fallback={null}>
        <LazySettingsPanel
          visible={settingsOpen}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsScrollSection(null);
            setHighlightRecoveryRetention(false);
          }}
          typewriterMode={typewriterMode}
          onTypewriterModeChange={(v) => {
            setTypewriterMode(v);
            typewriterModeRef.current = v;
          }}
          onChange={handleSettingsChange}
          scrollToSection={settingsScrollSection}
          highlightRecoveryRetention={highlightRecoveryRetention}
          onShowToast={(msg) => showToast(msg)}
        />
      </Suspense>
    </AppShell>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <MilkdownProvider>
        <AppContent />
      </MilkdownProvider>
    </ErrorBoundary>
  );
}
