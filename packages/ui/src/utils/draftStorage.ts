const DRAFT_STORAGE_KEY = 'pennivo-draft';

export interface DraftData {
  content: string;
  filePath: string | null;
  timestamp: number;
}

export function saveDraft(content: string, filePath: string | null) {
  try {
    const draft: DraftData = { content, filePath, timestamp: Date.now() };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function loadDraft(): DraftData | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as DraftData;
    if (draft && typeof draft.content === 'string' && typeof draft.timestamp === 'number') {
      return draft;
    }
  } catch {
    // Corrupt data
  }
  return null;
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Ignore
  }
}
