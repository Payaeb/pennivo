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
import type { EditorView } from "@milkdown/prose/view";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
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
import {
  Toolbar,
  type ToolbarAction,
  type ConfigurableAction,
  DEFAULT_TOOLBAR_CONFIG,
} from "./components/Toolbar/Toolbar";
import { LinkPopover } from "./components/LinkPopover/LinkPopover";
import { FindReplace } from "./components/FindReplace/FindReplace";
import type { SaveStatus } from "./components/Statusbar/Statusbar";
import { Sidebar } from "./components/Sidebar/Sidebar";
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

  // --- Sidebar state ---
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [sidebarFolder, setSidebarFolder] = useState<string | null>(null);
  const [sidebarTree, setSidebarTree] = useState<FileTreeEntry[]>([]);

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

  // Load persisted settings on mount
  useEffect(() => {
    platform.getSettings().then((saved) => {
      if (saved && typeof saved.showWordCount === "boolean") {
        setShowWordCount(saved.showWordCount);
      }
    });
  }, []);

  const handleSettingsChange = useCallback(
    (settings: Record<string, unknown>) => {
      if (typeof settings.showWordCount === "boolean") {
        setShowWordCount(settings.showWordCount);
      }
    },
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
  }, []);

  const handleChooseFolder = useCallback(async () => {
    const folder = await platform.chooseSidebarFolder();
    if (folder) {
      setSidebarFolder(folder);
      setSidebarVisible(true);
      refreshSidebarTree(folder);
    }
  }, [refreshSidebarTree]);

  // Load persisted sidebar folder on mount
  useEffect(() => {
    platform.getSidebarFolder().then((folder) => {
      if (folder) {
        setSidebarFolder(folder);
        refreshSidebarTree(folder);
      }
    });
  }, [refreshSidebarTree]);

  // Load persisted toolbar config on mount
  useEffect(() => {
    platform.getToolbarConfig().then((saved) => {
      if (saved) setToolbarConfig(saved as ConfigurableAction[]);
    });
  }, []);

  const handleToolbarConfigUpdate = useCallback(
    (config: ConfigurableAction[]) => {
      setToolbarConfig(config);
      platform.setToolbarConfig(config);
    },
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
  }, [sidebarFolder, refreshSidebarTree]);

  const setFilePath = (p: string | null) => {
    filePathRef.current = p;
    setFilePathState(p);
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
  }, []);

  const doSaveAs = useCallback(async (): Promise<boolean> => {
    const content = markdownRef.current;
    setSaveStatus("saving");
    try {
      // Build a default path: if a file is open, suggest "name (copy).md"
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
    [getInstance, showToast],
  );

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
  }, [doSave, loadRecentFiles, loadContent, showToast]);

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
    },
    [doSave, loadRecentFiles, loadContent, showToast],
  );

  // --- Sidebar file click ---
  const handleSidebarFileClick = useCallback(
    async (clickedPath: string) => {
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
    },
    [doSave, loadRecentFiles, loadContent, showToast],
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
    [scheduleAutoSave],
  );

  // --- Focus mode toggle ---
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      platform.setFullScreen(next);
      return next;
    });
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
  }, [getEditorHtml, filename, showToast]);

  const doExportPdf = useCallback(async () => {
    const html = getEditorHtml();
    if (!html) return;
    const result = await platform.exportPdf(html, filename);
    if (result) showToast("Exported as PDF");
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
  }, [
    focusMode,
    linkPopover,
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
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
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
  }, [openRecentFile]);

  // --- Auto-update available banner ---
  // Main process only fires this in production after a release has been
  // fully downloaded, so dev runs never see the banner.
  useEffect(() => {
    return platform.onUpdateAvailable((version) => setUpdateAvailable(version));
  }, []);

  // --- Drag-and-drop .md files to open ---
  const [showDropZone, setShowDropZone] = useState(false);
  const dragCounterRef = useRef(0);

  const DROPPABLE_EXTENSIONS = new Set(["md", "markdown", "txt"]);

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
  }, [openRecentFile]);

  // Set window title (taskbar) when filename changes
  useEffect(() => {
    const title = filePath
      ? `${extractFilename(filePath)} \u2014 Pennivo`
      : "untitled \u2014 Pennivo";
    platform.setTitle(title);
  }, [filePath]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
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
              // Lift out of any existing list first (task list or ordered list)
              if (formats.has("taskList") || formats.has("orderedList")) {
                callCommand(liftListItemCommand.key)(ctx);
              }
              callCommand(wrapInBulletListCommand.key)(ctx);
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
              // Lift out of any existing list first (task list or bullet list)
              if (formats.has("taskList") || formats.has("bulletList")) {
                callCommand(liftListItemCommand.key)(ctx);
              }
              callCommand(wrapInOrderedListCommand.key)(ctx);
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
              // Lift out of any existing list first
              if (formats.has("orderedList") || formats.has("bulletList")) {
                callCommand(liftListItemCommand.key)(ctx);
              }
              callCommand(wrapInBulletListCommand.key)(ctx);
              // Set the list_item's checked attribute to make it a task list
              queueMicrotask(() => {
                const { state, dispatch } = view;
                const { $from } = state.selection;
                for (let d = $from.depth; d >= 0; d--) {
                  const node = $from.node(d);
                  if (node.type.name === "list_item") {
                    const pos = $from.before(d);
                    dispatch(
                      state.tr.setNodeMarkup(pos, undefined, {
                        ...node.attrs,
                        checked: false,
                      }),
                    );
                    break;
                  }
                }
              });
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
        }
      } else {
        if (e.key === "f") {
          e.preventDefault();
          setFindReplaceOpen(true);
        } else if (e.key === "b") {
          e.preventDefault();
          setSidebarVisible((v) => !v);
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
        shortcut: "Ctrl+B",
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
          tree={sidebarTree}
          currentFilePath={filePath}
          onFileClick={handleSidebarFileClick}
          onChooseFolder={handleChooseFolder}
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
          onClose={() => setSettingsOpen(false)}
          typewriterMode={typewriterMode}
          onTypewriterModeChange={(v) => {
            setTypewriterMode(v);
            typewriterModeRef.current = v;
          }}
          onChange={handleSettingsChange}
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
