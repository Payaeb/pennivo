import { vi } from 'vitest';

export function createMockPennivoAPI() {
  return {
    platform: 'test',
    getPathForFile: vi.fn(() => '/mock/path'),
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    setFullScreen: vi.fn(),
    isFullScreen: vi.fn(async () => false),
    paste: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    openExternal: vi.fn(),

    // File I/O
    saveImage: vi.fn(async () => ({ relativePath: 'img.png', absolutePath: '/img.png' })),
    pickImage: vi.fn(async () => null),
    openFile: vi.fn(async () => null),
    saveFile: vi.fn(async () => true),
    saveFileAs: vi.fn(async () => null),
    confirmDiscard: vi.fn(async () => 0),
    setDirty: vi.fn(),
    closeAfterSave: vi.fn(),

    // Recent files
    getRecentFiles: vi.fn(async () => []),
    addRecentFile: vi.fn(async () => []),
    clearRecentFiles: vi.fn(async () => []),
    openFilePath: vi.fn(async () => null),

    // Export
    exportHtml: vi.fn(async () => null),
    exportPdf: vi.fn(async () => null),

    // Window title
    setTitle: vi.fn(),

    // Sidebar
    getSidebarFolder: vi.fn(async () => null),
    setSidebarFolder: vi.fn(async () => undefined),
    chooseSidebarFolder: vi.fn(async () => null),
    readDirectory: vi.fn(async () => []),
    onSidebarFolderChanged: vi.fn(() => () => {}),

    // Toolbar config
    getToolbarConfig: vi.fn(async () => null),
    setToolbarConfig: vi.fn(async () => undefined),

    // Spellcheck
    getSpellCheckLanguages: vi.fn(async () => []),
    getAvailableSpellLanguages: vi.fn(async () => []),
    setSpellCheckLanguages: vi.fn(async () => undefined),
    addWordToDictionary: vi.fn(async () => undefined),

    // Menu events
    onMenuPaste: vi.fn(() => () => {}),
    onMenuOpen: vi.fn(() => () => {}),
    onMenuSave: vi.fn(() => () => {}),
    onMenuSaveAs: vi.fn(() => () => {}),
    onMenuSaveAndClose: vi.fn(() => () => {}),
    onMenuToggleFocusMode: vi.fn(() => () => {}),
    onMenuNewFile: vi.fn(() => () => {}),
    onMenuExportHtml: vi.fn(() => () => {}),
    onMenuExportPdf: vi.fn(() => () => {}),
  };
}

export function createMockEditorView() {
  const dom = document.createElement('div');
  return {
    state: {
      doc: { content: { size: 0 } },
      tr: {
        setMeta: vi.fn().mockReturnThis(),
        doc: { content: { size: 0 } },
      },
      schema: {
        text: vi.fn((t: string) => ({ text: t })),
      },
    },
    dispatch: vi.fn(),
    dom,
    focus: vi.fn(),
    coordsAtPos: vi.fn(() => ({ top: 0, left: 0, bottom: 0, right: 0 })),
  };
}
