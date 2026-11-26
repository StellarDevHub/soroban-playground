export interface EmergencyWorkspaceDump {
  files: Record<string, string>;
  activeFile: string;
  savedAt: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const EMERGENCY_DUMP_KEY = "sp:editor:emergency-dump";
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

function getStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function sanitiseDump(value: unknown): EmergencyWorkspaceDump | null {
  if (typeof value !== "object" || value === null) return null;

  const raw = value as Partial<EmergencyWorkspaceDump>;
  if (typeof raw.files !== "object" || raw.files === null) return null;

  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(raw.files)) {
    if (path.length > 0 && typeof content === "string") {
      files[path] = content;
    }
  }
  if (Object.keys(files).length === 0) return null;

  const activeFile =
    typeof raw.activeFile === "string" && files[raw.activeFile] !== undefined
      ? raw.activeFile
      : Object.keys(files)[0];

  return {
    files,
    activeFile,
    savedAt:
      typeof raw.savedAt === "number" && Number.isFinite(raw.savedAt)
        ? raw.savedAt
        : 0,
  };
}

export function readEmergencyWorkspaceDump(
  storage: StorageLike | null = getStorage(),
): EmergencyWorkspaceDump | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(EMERGENCY_DUMP_KEY);
    return raw ? sanitiseDump(JSON.parse(raw)) : null;
  } catch (error) {
    console.warn("Unable to read the editor emergency snapshot.", error);
    return null;
  }
}

export function writeEmergencyWorkspaceDump(
  dump: Omit<EmergencyWorkspaceDump, "savedAt">,
  storage: StorageLike | null = getStorage(),
): void {
  if (!storage) return;

  try {
    storage.setItem(
      EMERGENCY_DUMP_KEY,
      JSON.stringify({ ...dump, savedAt: Date.now() }),
    );
  } catch (error) {
    console.warn("Unable to save the editor emergency snapshot.", error);
  }
}

export function scheduleEmergencyWorkspaceDump(
  dump: Omit<EmergencyWorkspaceDump, "savedAt">,
  delayMs = 500,
): void {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    writeEmergencyWorkspaceDump(dump);
  }, delayMs);
}

export function flushEmergencyWorkspaceDump(
  dump: Omit<EmergencyWorkspaceDump, "savedAt">,
): void {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = null;
  writeEmergencyWorkspaceDump(dump);
}
