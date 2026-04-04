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
  turnIntoTextCommand,
  liftListItemCommand,
} from '@milkdown/preset-commonmark';
import { toggleStrikethroughCommand } from '@milkdown/preset-gfm';
import './styles/tokens.css';
import './styles/base.css';
import { AppShell } from './components/AppShell/AppShell';
import { Editor, DEFAULT_CONTENT } from './components/Editor/Editor';
import { Toolbar, type ToolbarAction } from './components/Toolbar/Toolbar';
import type { SaveStatus } from './components/Statusbar/Statusbar';
import type { MenuAction } from './components/Titlebar/TitlebarMenu';
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
    if (node.type.name === 'bullet_list') { active.add('bulletList'); break; }
    if (node.type.name === 'ordered_list') { active.add('orderedList'); break; }
    if (node.type.name === 'blockquote') { active.add('blockquote'); break; }
  }

  return active;
}

function AppContent() {
  const { toggleTheme } = useTheme();
  const [loading, getInstance] = useInstance();
  const [wordCount, setWordCount] = useState(0);
  const [activeFormats, setActiveFormats] = useState<Set<ToolbarAction>>(new Set());
  const [focusMode, setFocusMode] = useState(false);

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
        return true;
      }
      setSaveStatus(isDirtyRef.current ? 'unsaved' : 'saved');
      return false;
    } catch {
      setSaveStatus('unsaved');
      return false;
    }
  }, []);

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

  // Escape exits focus mode
  useEffect(() => {
    if (!focusMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFocusMode(false);
        window.pennivo?.setFullScreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusMode]);

  // --- Toast state ---
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

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

  // --- Menu event listeners ---
  useEffect(() => {
    const cleanups = [
      window.pennivo?.onMenuPaste(async () => {
        // Electron's native paste (webContents.paste) doesn't include image data
        // in the DOM paste event. Read the clipboard directly for images.
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
        // No image found, do normal text paste
        window.pennivo?.paste();
      }),
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
    ];
    return () => cleanups.forEach(cleanup => cleanup?.());
  }, [doOpen, doSave, doSaveAs, toggleFocusMode, handleImagePaste, insertImage]);

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
      if (action === 'link') return;
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
            const inList = getActiveFormats(view).has('bulletList');
            if (inList) callCommand(liftListItemCommand.key)(ctx);
            else callCommand(wrapInBulletListCommand.key)(ctx);
          });
          break;
        case 'orderedList':
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const inList = getActiveFormats(view).has('orderedList');
            if (inList) callCommand(liftListItemCommand.key)(ctx);
            else callCommand(wrapInOrderedListCommand.key)(ctx);
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

        case 'code':
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const inCode = getActiveFormats(view).has('code');
            if (inCode) callCommand(turnIntoTextCommand.key)(ctx);
            else callCommand(createCodeBlockCommand.key)(ctx);
          });
          break;
      }
    },
    [loading, getInstance, toggleTheme, toggleFocusMode, showToast, insertImage, doSaveAs],
  );

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
              window.pennivo?.paste();
            } else {
              document.execCommand(action);
            }
          });
          break;
        }
        case 'focusMode':   toggleFocusMode(); break;
        case 'toggleTheme': toggleTheme(); break;
        case 'zoomIn':      window.pennivo?.zoomIn(); break;
        case 'zoomOut':     window.pennivo?.zoomOut(); break;
        case 'resetZoom':   window.pennivo?.resetZoom(); break;
      }
    },
    [doOpen, doSave, doSaveAs, toggleFocusMode, toggleTheme, focusEditor],
  );

  const toolbarFormats = focusMode
    ? new Set([...activeFormats, 'focusMode' as ToolbarAction])
    : activeFormats;

  return (
    <AppShell
      filename={filename}
      isDirty={isDirty}
      wordCount={wordCount}
      saveStatus={saveStatus}
      focusMode={focusMode}
      onMenuAction={handleMenuAction}
      toolbar={<Toolbar activeFormats={toolbarFormats} onAction={handleAction} />}
    >
      <Editor
        onWordCountChange={setWordCount}
        onMarkdownChange={handleMarkdownChange}
        onViewUpdate={handleViewUpdate}
        onImagePaste={handleImagePaste}
      />
      {toast && <div className="toast">{toast}</div>}
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
