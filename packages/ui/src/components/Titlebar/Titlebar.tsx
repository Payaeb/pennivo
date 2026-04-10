import {
  TitlebarMenu,
  type MenuAction,
  type RecentFileEntry,
} from "./TitlebarMenu";
import logoSrc from "../../assets/logo-32.png";
import "./Titlebar.css";

interface TitlebarProps {
  filename: string;
  isDirty: boolean;
  onMenuAction?: (action: MenuAction) => void;
  recentFiles?: RecentFileEntry[];
  onOpenRecentFile?: (filePath: string) => void;
}

export type { MenuAction, RecentFileEntry };

export function Titlebar({
  filename,
  isDirty,
  onMenuAction,
  recentFiles,
  onOpenRecentFile,
}: TitlebarProps) {
  const handleMinimize = () => window.pennivo?.minimize();
  const handleMaximize = () => window.pennivo?.maximize();
  const handleClose = () => window.pennivo?.close();

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        {onMenuAction && (
          <TitlebarMenu
            onAction={onMenuAction}
            recentFiles={recentFiles}
            onOpenRecentFile={onOpenRecentFile}
          />
        )}
        <img
          className="titlebar-app-icon"
          src={logoSrc}
          alt="Pennivo"
          draggable={false}
        />
        <span className="titlebar-filename">
          {filename === "untitled.md" ? "untitled" : filename}
        </span>
        <span className="titlebar-appname">&mdash; Pennivo</span>
        {isDirty && <span className="titlebar-dirty" title="Unsaved changes" />}
      </div>

      <div className="titlebar-caption-buttons">
        <button
          className="caption-btn"
          onClick={handleMinimize}
          title="Minimize"
          tabIndex={-1}
        >
          <MinimizeIcon />
        </button>
        <button
          className="caption-btn"
          onClick={handleMaximize}
          title="Maximize"
          tabIndex={-1}
        >
          <MaximizeIcon />
        </button>
        <button
          className="caption-btn caption-btn--close"
          onClick={handleClose}
          title="Close"
          tabIndex={-1}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

function MinimizeIcon() {
  return (
    <svg
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <line x1="1" y1="5" x2="9" y2="5" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <rect x="1" y="1" width="8" height="8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
      <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
    </svg>
  );
}
