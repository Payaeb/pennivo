// Workspaces module — pure types + migration helpers for Pennivo Phase 1
// multiple-workspaces support. No fs, no IPC, no React, no Electron. The host
// composes these with persistence and the injected id generator.

export type { Workspace, WorkspacePrefs, WorkspacesState } from "./types";
export {
  defaultWorkspacePrefs,
  workspaceNameFromPath,
  findWorkspaceForPath,
  trashEntryInWorkspace,
  migrateWorkspaces,
} from "./migrate";
