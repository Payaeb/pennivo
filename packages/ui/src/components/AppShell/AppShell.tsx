import type { ReactNode } from 'react';
import { Titlebar } from '../Titlebar/Titlebar';
import { Statusbar, type SaveStatus } from '../Statusbar/Statusbar';
import './AppShell.css';

interface AppShellProps {
  filename?: string;
  isDirty?: boolean;
  wordCount?: number;
  saveStatus?: SaveStatus;
  toolbar: ReactNode;
  children: ReactNode;
}

export function AppShell({
  filename = 'untitled.md',
  isDirty = false,
  wordCount = 0,
  saveStatus = 'saved',
  toolbar,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <Titlebar filename={filename} isDirty={isDirty} />
      <div className="app-toolbar-row">{toolbar}</div>
      <main className="app-editor-area">
        <div className="app-editor-column">{children}</div>
      </main>
      <Statusbar wordCount={wordCount} saveStatus={saveStatus} />
    </div>
  );
}
