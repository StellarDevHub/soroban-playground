export const BACKUP_STORAGE_KEY = 'soroban_emergency_editor_backup';

export interface EditorBackup {
  timestamp: number;
  files: Record<string, string>;
  activeFile?: string;
}

/**
 * Automatically backs up unsaved editor buffers to localStorage before session termination.
 */
export function backupEditorBuffers(activeFile?: string, content?: string): void {
  if (typeof window === 'undefined') return;
  try {
    let files: Record<string, string> = {};
    const existing =
      localStorage.getItem('soroban_editor_files') ||
      localStorage.getItem('workspace_files') ||
      localStorage.getItem('soroban_contracts');

    if (existing) {
      try {
        files = JSON.parse(existing);
      } catch {
        // Fallback or unparsed string
      }
    }

    if (activeFile && content !== undefined) {
      files[activeFile] = content;
    }

    const backup: EditorBackup = {
      timestamp: Date.now(),
      files,
      activeFile,
    };

    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backup));
  } catch (err) {
    console.warn('Failed to perform emergency editor backup:', err);
  }
}

/**
 * Retrieves the most recent emergency editor backup.
 */
export function getEditorBackup(): EditorBackup | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EditorBackup) : null;
  } catch {
    return null;
  }
}
