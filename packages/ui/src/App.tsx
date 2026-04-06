import { useState, useCallback, useRef, useEffect } from 'react';
import { MilkdownProvider, useInstance } from '@milkdown/react';
import { editorViewCtx } from '@milkdown/core';
import { callCommand, replaceAll } from '@milkdown/utils';
import { lift } from '@milkdown/prose/commands';
import type { EditorView } from '@milkdown/prose/view';
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
} from '@milkdown/preset-commonmark';
import {
  toggleStrikethroughCommand,
  insertTableCommand,
} from '@milkdown/preset-gfm';
import './styles/tokens.css';
import './styles/base.css';
import { AppShell } from './components/AppShell/AppShell';
import { Editor, DEFAULT_CONTENT } from './components/Editor/Editor';
import { Toolbar, type ToolbarAction } from './components/Toolbar/Toolbar';
import { LinkPopover } from './components/LinkPopover/LinkPopover';
import { FindReplace } from './components/FindReplace/FindReplace';
import type { SaveStatus } from './components/Statusbar/Statusbar';
import type { MenuAction, RecentFileEntry } from './components/Titlebar/TitlebarMenu';
import { useTheme } from './hooks/useTheme';

const AUTO_SAVE_DELAY = 3000;

function extractFilename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || 'untitled.md';
}

function getActiveFormats(view: EditorView): Set<ToolbarAction> {
  const active = new Set<ToolbarAction>();
  const state = view.state;
  const { from, to, empty } = state.selection;
  const { doc } = state;

  if (empty) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    for (const mark of marks) {
      if (mark.type.name === 'strong') active.add('bold');
      if (mark.type.name === 'emphasis') active.add('italic');
      if (mark.type.name === 'strike_through') active.add('strikethrough');
    }
  } else {
    const schema = state.schema;
    if (schema.marks['strong'] && doc.rangeHasMark(from, to, schema.marks['strong'])) active.add('bold');
    if (schema.marks['emphasis'] && doc.rangeHasMark(from, to, schema.marks['emphasis'])) active.add('italic');
    if (schema.marks['strike_through'] && doc.rangeHasMark(from, to, schema.marks['strike_through'])) active.add('strikethrough');
  }

  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type.name === 'heading') {
    if (parent.attrs['level'] === 1) active.add('h1');
    if (parent.attrs['level'] === 2) active.add('h2');
  }
  if (parent.type.name === 'code_block') active.add('code');

  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'bullet_list') {
      // Check if this is a task list (list items have checked attr)
      const listItem = d + 1 <= $from.depth ? $from.node(d + 1) : null;
      if (listItem && listItem.attrs['checked'] != null) {
        active.add('taskList');
      } else {
        active.add('bulletList');
      }
      break;
    }
    if (node.type.name === 'ordered_list') { active.add('orderedList'); break; }
    if (node.type.name === 'blockquote') { active.add('blockquote'); break; }
  }

  return active;
}

function AppContent() {
  const { toggleTheme } = useTheme();
  const [loading, getInstance] = useInstance();
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [activeFormats, setActiveFormats] = useState<Set<ToolbarAction>>(new Set());
  const [focusMode, setFocusMode] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);

  // --- File state ---
  const [filePath, setFilePathState] = useState<string | null>(null);
  const [isDirty, setIsDirtyState] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  // Refs for stable access in callbacks (avoids stale closures)
  const filePathRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const markdownRef = useRef(DEFAULT_CONTENT);
  const savedMarkdownRef = useRef(DEFAULT_CONTENT);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // --- Recent files ---
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);

  const loadRecentFiles = useCallback(async () => {
    const files = await window.pennivo?.getRecentFiles();
    if (!files) return;
    setRecentFiles(files.map((fp: string) => {
      const parts = fp.replace(/\\/g, '/').split('/');
      const filename = parts.pop() || fp;
      const dir = parts.length > 2
        ? '.../' + parts.slice(-2).join('/')
        : parts.join('/');
      return { filePath: fp, filename, truncatedPath: dir };
    }));
  }, []);

  // Load recent files on mount
  useEffect(() => { loadRecentFiles(); }, [loadRecentFiles]);

  const setFilePath = (p: string | null) => {
    filePathRef.current = p;
    setFilePathState(p);
  };

  const setIsDirty = (dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirtyState(dirty);
    window.pennivo?.setDirty(dirty);
  };

  const filename = filePath ? extractFilename(filePath) : 'untitled.md';

  // --- Save operations ---
  const doSave = useCallback(async (): Promise<boolean> => {
    const currentPath = filePathRef.current;
    const content = markdownRef.current;

    if (!currentPath) {
      return doSaveAs();
    }

    setSaveStatus('saving');
    try {
      await window.pennivo?.saveFile(currentPath, content);
      savedMarkdownRef.current = content;
      setIsDirty(false);
      setSaveStatus('saved');
      return true;
    } catch {
      setSaveStatus('unsaved');
      return false;
    }
  }, []);

  const doSaveAs = useCallback(async (): Promise<boolean> => {
    const content = markdownRef.current;
    setSaveStatus('saving');
    try {
      const newPath = await window.pennivo?.saveFileAs(content);
      if (newPath) {
        setFilePath(newPath);
        savedMarkdownRef.current = content;
        setIsDirty(false);
        setSaveStatus('saved');
        loadRecentFiles();
        return true;
      }
      setSaveStatus(isDirtyRef.current ? 'unsaved' : 'saved');
      return false;
    } catch {
      setSaveStatus('unsaved');
      return false;
    }
  }, [loadRecentFiles]);

  // --- Open file ---
  const doOpen = useCallback(async () => {
    // Guard unsaved changes
    if (isDirtyRef.current) {
      const response = await window.pennivo?.confirmDiscard();
      if (response === 2) return; // Cancel
      if (response === 0) {
        const saved = await doSave();
        if (!saved) return;
      }
      // response === 1: discard, proceed
    }

    const result = await window.pennivo?.openFile();
    if (!result) return;

    const editor = getInstance();
    if (!editor || loading) return;

    editor.action(replaceAll(result.content));
    setFilePath(result.filePath);
    savedMarkdownRef.current = result.content;
    markdownRef.current = result.content;
    setIsDirty(false);
    setSaveStatus('saved');
    loadRecentFiles();
  }, [loading, getInstance, doSave, loadRecentFiles]);

  // --- Open recent file by path ---
  const openRecentFile = useCallback(async (recentPath: string) => {
    // Guard unsaved changes
    if (isDirtyRef.current) {
      const response = await window.pennivo?.confirmDiscard();
      if (response === 2) return;
      if (response === 0) {
        const saved = await doSave();
        if (!saved) return;
      }
    }

    const result = await window.pennivo?.openFilePath(recentPath);
    if (!result) return;

    const editor = getInstance();
    if (!editor || loading) return;

    editor.action(replaceAll(result.content));
    setFilePath(result.filePath);
    savedMarkdownRef.current = result.content;
    markdownRef.current = result.content;
    setIsDirty(false);
    setSaveStatus('saved');
    loadRecentFiles();
  }, [loading, getInstance, doSave, loadRecentFiles]);

  // --- New file ---
  const doNewFile = useCallback(async () => {
    if (isDirtyRef.current) {
      const response = await window.pennivo?.confirmDiscard();
      if (response === 2) return;
      if (response === 0) {
        const saved = await doSave();
        if (!saved) return;
      }
    }

    const editor = getInstance();
    if (!editor || loading) return;

    editor.action(replaceAll(''));
    setFilePath(null);
    savedMarkdownRef.current = '';
    markdownRef.current = '';
    setIsDirty(false);
    setSaveStatus('saved');
  }, [loading, getInstance, doSave]);

  // --- Auto-save ---
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (!filePathRef.current) return;

    autoSaveTimerRef.current = setTimeout(async () => {
      if (!isDirtyRef.current || !filePathRef.current) return;
      setSaveStatus('saving');
      try {
        await window.pennivo?.saveFile(filePathRef.current, markdownRef.current);
        savedMarkdownRef.current = markdownRef.current;
        setIsDirty(false);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unsaved');
      }
    }, AUTO_SAVE_DELAY);
  }, []);

  // --- Markdown change handler ---
  const handleMarkdownChange = useCallback((markdown: string) => {
    markdownRef.current = markdown;
    const dirty = markdown !== savedMarkdownRef.current;

    if (dirty !== isDirtyRef.current) {
      setIsDirty(dirty);
    }

    if (dirty) {
      setSaveStatus('unsaved');
      scheduleAutoSave();
    } else {
      setSaveStatus('saved');
    }
  }, [scheduleAutoSave]);

  // --- Focus mode toggle ---
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      window.pennivo?.setFullScreen(next);
      return next;
    });
  }, []);

  // --- Toast state ---
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // --- Export helpers ---
  const getEditorHtml = useCallback((): string => {
    if (loading) return '';
    const editor = getInstance();
    if (!editor) return '';
    let html = '';
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      html = view.dom.innerHTML;
    });
    return html;
  }, [loading, getInstance]);

  const doExportHtml = useCallback(async () => {
    const html = getEditorHtml();
    if (!html) return;
    const result = await window.pennivo?.exportHtml(html, filename);
    if (result) showToast('Exported as HTML');
  }, [getEditorHtml, filename, showToast]);

  const doExportPdf = useCallback(async () => {
    const html = getEditorHtml();
    if (!html) return;
    const result = await window.pennivo?.exportPdf(html, filename);
    if (result) showToast('Exported as PDF');
  }, [getEditorHtml, filename, showToast]);

  // --- Link popover state ---
  const [linkPopover, setLinkPopover] = useState<{
    hasSelection: boolean;
    selectedText: string;
    anchorRect: { top: number; left: number };
  } | null>(null);

  // Escape exits focus mode — but not if a popover, menu, or find bar is open
  useEffect(() => {
    if (!focusMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Let the link popover, titlebar menu, or find bar handle Escape first
      if (linkPopover) return;
      if (findReplaceOpen) return;
      if (document.querySelector('.titlebar-menu-dropdown')) return;
      setFocusMode(false);
      window.pennivo?.setFullScreen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusMode, linkPopover, findReplaceOpen]);

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
      const selectedText = empty ? '' : state.doc.textBetween(from, to, ' ');

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
        href = 'https://' + href;
      }

      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const { from, to, empty } = state.selection;

        if (empty) {
          // No selection — insert [text](url) as a text node with link mark
          const linkMark = state.schema.marks['link'].create({ href });
          const textNode = state.schema.text(text, [linkMark]);
          view.dispatch(state.tr.replaceSelectionWith(textNode, false));
        } else {
          // Has selection — wrap it with the link mark
          const linkMark = state.schema.marks['link'].create({ href });
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

  // Ctrl+K shortcut for link insert
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openLinkPopover();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openLinkPopover]);

  // --- Image paste handler ---
  // Returns the src to use for the image node (file:// URL for display).
  // The markdown serializer will write this as the image src.
  const handleImagePaste = useCallback(async (file: File): Promise<string | null> => {
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
      const mimeType = file.type || 'image/png';
      const result = await window.pennivo?.saveImage(currentPath, buffer, mimeType);
      if (result) {
        showToast('Image saved');
        // Use custom protocol so the image displays in the editor
        // (file:// is blocked when page is served from http://localhost in dev)
        return `pennivo-file:///${result.absolutePath}`;
      }
      return null;
    } catch {
      showToast('Failed to save image');
      return null;
    }
  }, [showToast, doSaveAs]);

  // Insert a saved image into the editor
  const insertImage = useCallback((src: string) => {
    if (loading) return;
    const editor = getInstance();
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const imageNode = view.state.schema.nodes['image'].create({ src, alt: '' });
      view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
    });
  }, [loading, getInstance]);

  // Image-aware paste: checks clipboard for images before falling back to text.
  // Used by both the Electron menu paste (Ctrl+V) and the hamburger menu paste.
  const doSmartPaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], 'clipboard.png', { type: imageType });
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
    window.pennivo?.paste();
  }, [handleImagePaste, insertImage]);

  // --- Menu event listeners ---
  useEffect(() => {
    const cleanups = [
      window.pennivo?.onMenuPaste(() => doSmartPaste()),
      window.pennivo?.onMenuOpen(() => doOpen()),
      window.pennivo?.onMenuSave(() => doSave()),
      window.pennivo?.onMenuSaveAs(() => doSaveAs()),
      window.pennivo?.onMenuSaveAndClose(async () => {
        const saved = await doSave();
        if (saved) {
          window.pennivo?.closeAfterSave();
        }
      }),
      window.pennivo?.onMenuToggleFocusMode(() => toggleFocusMode()),
      window.pennivo?.onMenuNewFile(() => doNewFile()),
      window.pennivo?.onMenuExportHtml(() => doExportHtml()),
      window.pennivo?.onMenuExportPdf(() => doExportPdf()),
    ];
    return () => cleanups.forEach(cleanup => cleanup?.());
  }, [doOpen, doSave, doSaveAs, toggleFocusMode, doSmartPaste, doNewFile, doExportHtml, doExportPdf]);

  // Prevent Electron from navigating when files are dragged onto the window
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);

  // Set window title (taskbar) when filename changes
  useEffect(() => {
    const title = filePath ? `${extractFilename(filePath)} \u2014 Pennivo` : 'untitled \u2014 Pennivo';
    window.pennivo?.setTitle(title);
  }, [filePath]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // --- Editor view update (toolbar sync) ---
  const handleViewUpdate = useCallback((view: EditorView) => {
    setActiveFormats(getActiveFormats(view));
  }, []);

  // --- Toolbar actions ---
  const handleAction = useCallback(
    (action: ToolbarAction) => {
      if (action === 'toggleTheme') { toggleTheme(); return; }
      if (action === 'focusMode') { toggleFocusMode(); return; }
      if (action === 'link') { openLinkPopover(); return; }
      if (action === 'image') {
        (async () => {
          let currentPath = filePathRef.current;
          if (!currentPath) {
            const saved = await doSaveAs();
            if (!saved) return;
            currentPath = filePathRef.current;
            if (!currentPath) return;
          }
          const result = await window.pennivo?.pickImage(currentPath);
          if (!result) return;
          const src = `pennivo-file:///${result.absolutePath}`;
          insertImage(src);
          showToast('Image inserted');
        })();
        return;
      }
      if (loading) return;

      const editor = getInstance();
      if (!editor) return;

      switch (action) {
        case 'bold':
          editor.action(callCommand(toggleStrongCommand.key));
          break;
        case 'italic':
          editor.action(callCommand(toggleEmphasisCommand.key));
          break;
        case 'strikethrough':
          editor.action(callCommand(toggleStrikethroughCommand.key));
          break;

        case 'h1':
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const isH1 = getActiveFormats(view).has('h1');
            if (isH1) callCommand(turnIntoTextCommand.key)(ctx);
            else callCommand(wrapInHeadingCommand.key, 1)(ctx);
          });
          break;
        case 'h2':
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const isH2 = getActiveFormats(view).has('h2');
            if (isH2) callCommand(turnIntoTextCommand.key)(ctx);
            else callCommand(wrapInHeadingCommand.key, 2)(ctx);
          });
          break;

        case 'bulletList':
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const formats = getActiveFormats(view);
            if (formats.has('bulletList')) {
              callCommand(liftListItemCommand.key)(ctx);
            } else {
              // Lift out of any existing list first (task list or ordered list)
              if (formats.has('taskList') || formats.has('orderedList')) {
                callCommand(liftListItemCommand.key)(ctx);
              }
              callCommand(wrapInBulletListCommand.key)(ctx);
            }
          });
          break;
        case 'orderedList':
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const formats = getActiveFormats(view);
            if (formats.has('orderedList')) {
              callCommand(liftListItemCommand.key)(ctx);
            } else {
              // Lift out of any existing list first (task list or bullet list)
              if (formats.has('taskList') || formats.has('bulletList')) {
                callCommand(liftListItemCommand.key)(ctx);
              }
              callCommand(wrapInOrderedListCommand.key)(ctx);
            }
          });
          break;

        case 'taskList':
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const formats = getActiveFormats(view);
            if (formats.has('taskList')) {
              callCommand(liftListItemCommand.key)(ctx);
            } else {
              // Lift out of any existing list first
              if (formats.has('orderedList') || formats.has('bulletList')) {
                callCommand(liftListItemCommand.key)(ctx);
              }
              callCommand(wrapInBulletListCommand.key)(ctx);
              // Set the list_item's checked attribute to make it a task list
              queueMicrotask(() => {
                const { state, dispatch } = view;
                const { $from } = state.selection;
                for (let d = $from.depth; d >= 0; d--) {
                  const node = $from.node(d);
                  if (node.type.name === 'list_item') {
                    const pos = $from.before(d);
                    dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false }));
                    break;
                  }
                }
              });
            }
          });
          break;

        case 'blockquote':
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const inBq = getActiveFormats(view).has('blockquote');
            if (inBq) lift(view.state, view.dispatch);
            else callCommand(wrapInBlockquoteCommand.key)(ctx);
          });
          break;

        case 'table':
          editor.action(callCommand(insertTableCommand.key, { row: 2, col: 3 }));
          break;

        case 'code':
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            const inCodeBlock = state.selection.$from.parent.type.name === 'code_block';

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
    [loading, getInstance, toggleTheme, toggleFocusMode, showToast, insertImage, doSaveAs, openLinkPopover],
  );

  // --- Get ProseMirror view (for Find & Replace) ---
  const getEditorView = useCallback((): import('@milkdown/prose/view').EditorView | null => {
    if (loading) return null;
    const editor = getInstance();
    if (!editor) return null;
    let view: import('@milkdown/prose/view').EditorView | null = null;
    editor.action((ctx) => {
      view = ctx.get(editorViewCtx);
    });
    return view;
  }, [loading, getInstance]);

  // Ctrl+F opens find & replace
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setFindReplaceOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Hamburger menu actions ---
  const focusEditor = useCallback(() => {
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
        case 'open':        doOpen(); break;
        case 'save':        doSave(); break;
        case 'saveAs':      doSaveAs(); break;
        case 'quit':        window.pennivo?.close(); break;
        case 'undo':
        case 'redo':
        case 'cut':
        case 'copy':
        case 'paste':
        case 'selectAll': {
          // Refocus editor first — menu click steals focus
          focusEditor();
          queueMicrotask(() => {
            if (action === 'paste') {
              doSmartPaste();
            } else {
              document.execCommand(action);
            }
          });
          break;
        }
        case 'focusMode':   toggleFocusMode(); break;
        case 'toggleTheme': toggleTheme(); break;
        case 'findReplace': setFindReplaceOpen(true); break;
        case 'newFile':     doNewFile(); break;
        case 'exportHtml':  doExportHtml(); break;
        case 'exportPdf':   doExportPdf(); break;
        case 'clearRecentFiles':
          window.pennivo?.clearRecentFiles().then(() => loadRecentFiles());
          break;
        case 'zoomIn':      window.pennivo?.zoomIn(); break;
        case 'zoomOut':     window.pennivo?.zoomOut(); break;
        case 'resetZoom':   window.pennivo?.resetZoom(); break;
      }
    },
    [doOpen, doSave, doSaveAs, toggleFocusMode, toggleTheme, focusEditor, doSmartPaste, loadRecentFiles, doNewFile, doExportHtml, doExportPdf],
  );

  const toolbarFormats = focusMode
    ? new Set([...activeFormats, 'focusMode' as ToolbarAction])
    : activeFormats;

  return (
    <AppShell
      filename={filename}
      isDirty={isDirty}
      wordCount={wordCount}
      charCount={charCount}
      saveStatus={saveStatus}
      focusMode={focusMode}
      onMenuAction={handleMenuAction}
      recentFiles={recentFiles}
      onOpenRecentFile={openRecentFile}
      toolbar={<Toolbar activeFormats={toolbarFormats} onAction={handleAction} />}
      findReplace={
        <FindReplace
          visible={findReplaceOpen}
          getView={getEditorView}
          onClose={() => setFindReplaceOpen(false)}
        />
      }
    >
      <Editor
        onWordCountChange={setWordCount}
        onCharCountChange={setCharCount}
        onMarkdownChange={handleMarkdownChange}
        onViewUpdate={handleViewUpdate}
        onImagePaste={handleImagePaste}
      />
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
    </AppShell>
  );
}

export function App() {
  return (
    <MilkdownProvider>
      <AppContent />
    </MilkdownProvider>
  );
}
