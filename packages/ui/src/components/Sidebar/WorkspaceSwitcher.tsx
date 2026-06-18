import { useState, useRef, useEffect, useCallback } from "react";

/**
 * One workspace row in the switcher menu. Mirrors the `Workspace` shape from
 * @pennivo/core, but kept structural here so the UI package stays free of the
 * core import for a presentational component.
 */
export interface WorkspaceSwitcherItem {
  id: string;
  name: string;
  rootPath: string;
}

interface WorkspaceSwitcherProps {
  /** All known workspaces, in user-facing order. */
  workspaces: WorkspaceSwitcherItem[];
  /** Id of the active workspace, or null when none is selected. */
  activeWorkspaceId: string | null;
  /**
   * Display name shown on the trigger. Prefer the active workspace's name;
   * the host passes the folder-derived title as a fallback so a no-workspace
   * install looks exactly like before.
   */
  displayName: string;
  /** Full path for the trigger tooltip (matches the old `.sidebar-title`). */
  titleTooltip?: string;
  /** Switch to a non-active workspace by id. */
  onSwitchWorkspace: (id: string) => void;
  /** Open the folder picker and add the chosen folder as a new workspace. */
  onAddWorkspace: () => void;
  /** Forget a workspace by id (never touches files on disk). */
  onRemoveWorkspace: (id: string) => void;
}

/**
 * Header title dropdown for switching between opened workspaces (Phase 4 of
 * multiple-workspaces). The current workspace name is a clickable trigger with
 * a chevron; clicking opens a popover anchored under the title.
 *
 * Open/close behavior, focus handling, and styling deliberately mirror the
 * sibling `SortMenu` in Sidebar.tsx: click-outside to close, Escape to close
 * and return focus to the trigger, `aria-haspopup`/`aria-expanded` on the
 * button, and `role="menu"` on the popover.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  displayName,
  titleTooltip,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click or Escape. Identical to SortMenu so the two menus
  // feel like siblings.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(t) &&
        !buttonRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const closeAndFocusTrigger = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  const handleSwitch = useCallback(
    (id: string) => {
      if (id !== activeWorkspaceId) onSwitchWorkspace(id);
      closeAndFocusTrigger();
    },
    [activeWorkspaceId, onSwitchWorkspace, closeAndFocusTrigger],
  );

  const handleAdd = useCallback(() => {
    onAddWorkspace();
    closeAndFocusTrigger();
  }, [onAddWorkspace, closeAndFocusTrigger]);

  return (
    <div className="sidebar-workspace">
      <button
        ref={buttonRef}
        className="sidebar-workspace-trigger"
        onClick={() => setOpen((v) => !v)}
        title={titleTooltip}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch workspace"
      >
        <span className="sidebar-title">{displayName}</span>
        <span
          className={`sidebar-workspace-chevron${open ? " sidebar-workspace-chevron--open" : ""}`}
          aria-hidden="true"
        >
          <ChevronDownIcon />
        </span>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="sidebar-workspace-menu"
          role="menu"
          aria-label="Workspaces"
        >
          <div className="sidebar-workspace-section-label">Workspaces</div>
          {workspaces.length === 0 && (
            <div className="sidebar-workspace-empty">No workspaces yet</div>
          )}
          {workspaces.map((ws) => {
            const selected = ws.id === activeWorkspaceId;
            const allowRemove = workspaces.length > 1;
            return (
              <div
                key={ws.id}
                className={`sidebar-workspace-row${selected ? " sidebar-workspace-row--selected" : ""}`}
              >
                <button
                  className="sidebar-workspace-option"
                  role="menuitemradio"
                  aria-checked={selected}
                  title={ws.rootPath}
                  onClick={() => handleSwitch(ws.id)}
                >
                  <span className="sidebar-workspace-option-check">
                    {selected && <CheckIcon />}
                  </span>
                  <span className="sidebar-workspace-option-name">
                    {ws.name}
                  </span>
                </button>
                {allowRemove && (
                  <button
                    className="sidebar-workspace-remove"
                    title={`Remove "${ws.name}" (keeps files on disk)`}
                    aria-label={`Remove workspace ${ws.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveWorkspace(ws.id);
                    }}
                  >
                    <CloseIcon />
                  </button>
                )}
              </div>
            );
          })}
          <div className="sidebar-workspace-divider" role="separator" />
          <button
            className="sidebar-workspace-add"
            role="menuitem"
            onClick={handleAdd}
          >
            <span className="sidebar-workspace-add-icon" aria-hidden="true">
              <PlusIcon />
            </span>
            <span>Add workspace...</span>
          </button>
        </div>
      )}
    </div>
  );
}

// --- Icons (match the stroke style of the sidebar's existing icons) ---

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4,6 8,10 12,6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3,8 7,12 13,4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}
