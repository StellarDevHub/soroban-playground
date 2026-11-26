/**
 * Service to load and manage template metadata from contract directories
 */

import { TemplateMetadata, TemplateFunctionality } from "@/types/template";

export async function loadTemplateMetadata(): Promise<TemplateMetadata[]> {
  try {
    const response = await fetch("/api/templates/metadata");
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("Error loading templates:", error);
    return generateMockMetadata();
  }
}

export function generateMockMetadata(): TemplateMetadata[] {
  return [
    {
      id: "hello-world",
      name: "Hello World",
      dirName: "hello-world",
      description: "Minimal Soroban contract example",
      category: "Utilities",
      functionalities: ["Basic"],
      complexity: "Beginner",
      deploymentStatus: "Testnet",
      dependencies: [],
      tags: ["minimal", "example"],
      features: ["Simple function call"],
    },
    {
      id: "counter",
      name: "Counter",
      dirName: "counter",
      description: "Simple counter with state management",
      category: "Utilities",
      functionalities: ["Basic", "State Management"],
      complexity: "Beginner",
      deploymentStatus: "Testnet",
      dependencies: [],
      tags: ["state", "storage"],
      features: ["State persistence"],
    },
    {
      id: "stablecoin",
      name: "Stablecoin",
      dirName: "stablecoin",
      description: "Algorithmic stablecoin with collateral",
      category: "DeFi",
      functionalities: ["Token Operations", "Advanced"],
      complexity: "Advanced",
      deploymentStatus: "Production",
      dependencies: [{ name: "soroban-sdk", version: "^21.0" }],
      tags: ["defi", "collateral"],
      features: ["Minting", "Burning", "Price feed"],
    },
    {
      id: "gaming-arena",
      name: "Turn-Based Gaming Arena",
      dirName: "gaming-arena",
      description: "Turn-based gaming state machine with move verification and prize distribution",
      category: "Gaming",
      functionalities: ["State Management", "Advanced"],
      complexity: "Intermediate",
      deploymentStatus: "Testnet",
      dependencies: [{ name: "soroban-sdk", version: "^21.0" }],
      tags: ["gaming", "pvp", "state-machine"],
      features: ["Turn Timers", "Move Proofs", "Reward Escrow"],
    },
    {
      id: "rwa-treasury-vault",
      name: "RWA Tokenized Yield Vault",
      dirName: "rwa-treasury-vault",
      description: "Real-World Asset tokenized yield vault with identity whitelisting",
      category: "RWA",
      functionalities: ["Token Operations", "Lending", "Advanced"],
      complexity: "Advanced",
      deploymentStatus: "Production",
      dependencies: [{ name: "soroban-sdk", version: "^21.0" }],
      tags: ["rwa", "yield", "compliance"],
      features: ["Yield Distribution", "Whitelisting", "Oracle Auditing"],
    },
    {
      id: "identity-verifier",
      name: "Decentralized Identity Credential Registry",
      dirName: "identity-verifier",
      description: "W3C-compliant DID registry with zero-knowledge proof verification",
      category: "Identity",
      functionalities: ["Basic", "State Management"],
      complexity: "Intermediate",
      deploymentStatus: "Testnet",
      dependencies: [{ name: "soroban-sdk", version: "^21.0" }],
      tags: ["identity", "did", "zk"],
      features: ["DID Management", "Attestation Verification"],
    },
  ];
}

export function filterTemplates(
  templates: TemplateMetadata[],
  searchQuery: string,
  categories: string[],
  functionalities: string[],
  complexityLevels: string[],
  deploymentStatuses: string[],
  dependencies: string[],
): TemplateMetadata[] {
  return templates.filter((template) => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matches =
        template.name.toLowerCase().includes(query) ||
        template.description.toLowerCase().includes(query) ||
        template.tags.some((tag) => tag.toLowerCase().includes(query));
      if (!matches) return false;
    }

    if (categories.length > 0 && !categories.includes(template.category))
      return false;
    if (functionalities.length > 0) {
      const has = functionalities.some((func) =>
        template.functionalities.includes(func as TemplateFunctionality),
      );
      if (!has) return false;
    }
    if (
      complexityLevels.length > 0 &&
      !complexityLevels.includes(template.complexity)
    )
      return false;
    if (
      deploymentStatuses.length > 0 &&
      !deploymentStatuses.includes(template.deploymentStatus)
    )
      return false;
    if (dependencies.length > 0) {
      const depNames = template.dependencies.map((d) => d.name);
      const has = dependencies.every((dep) => depNames.includes(dep));
      if (!has) return false;
    }

    return true;
  });
}

export function generateSuggestions(templates: TemplateMetadata[]) {
  const suggestions = new Map<string, string>();

  templates.forEach((template) => {
    suggestions.set(template.category, "category");
    template.functionalities.forEach((func) =>
      suggestions.set(func, "functionality"),
    );
    template.tags.forEach((tag) => suggestions.set(tag, "tag"));
    template.dependencies.forEach((dep) =>
      suggestions.set(dep.name, "dependency"),
    );
  });

  return Array.from(suggestions.entries())
    .map(([label, category]) => ({ label, category }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export const WORKSPACE_BACKUPS_STORAGE_KEY = "soroban_workspace_backups";
export const ACTIVE_PROJECT_STORAGE_KEY = "soroban_active_project";
export const EDITOR_CODE_STORAGE_KEY = "soroban_editor_code";

export interface WorkspaceBackup {
  id: string;
  timestamp: number;
  templateId?: string;
  code: string;
  description: string;
}

export interface ForkTemplateOptions {
  template: { id: string; name: string; code: string };
  target: "replace_current" | "new_project";
  newProjectName?: string;
  autoBackup?: boolean;
}

export interface ForkTemplateResult {
  success: boolean;
  targetUrl: string;
  backupCreated: boolean;
  backupId?: string;
  namespace?: string;
}

/**
 * Creates an automatic timestamped backup of the user's active workspace editor code.
 */
export function createWorkspaceBackup(
  currentCode?: string,
  description?: string
): WorkspaceBackup {
  if (typeof window === "undefined") {
    return {
      id: "backup-mock",
      timestamp: Date.now(),
      code: currentCode || "",
      description: description || "Automated pre-fork backup",
    };
  }

  try {
    const rawCode =
      currentCode !== undefined
        ? currentCode
        : localStorage.getItem(EDITOR_CODE_STORAGE_KEY) || "";

    const backup: WorkspaceBackup = {
      id: `backup-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      code: rawCode,
      description: description || `Automated pre-fork backup (${new Date().toLocaleString()})`,
    };

    const existingBackups = getWorkspaceBackups();
    // Keep most recent 20 backups
    const updated = [backup, ...existingBackups].slice(0, 20);
    localStorage.setItem(WORKSPACE_BACKUPS_STORAGE_KEY, JSON.stringify(updated));

    return backup;
  } catch (err) {
    console.error("Failed to persist workspace backup:", err);
    return {
      id: `backup-${Date.now()}`,
      timestamp: Date.now(),
      code: currentCode || "",
      description: "Ephemeral backup",
    };
  }
}

/**
 * Returns all saved workspace backups sorted by timestamp descending.
 */
export function getWorkspaceBackups(): WorkspaceBackup[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(WORKSPACE_BACKUPS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Restores a specific backup into the active workspace editor slot.
 */
export function restoreWorkspaceBackup(backupId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const backups = getWorkspaceBackups();
    const target = backups.find((b) => b.id === backupId);
    if (!target) return false;

    localStorage.setItem(EDITOR_CODE_STORAGE_KEY, target.code);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely forks a template into the playground IDE.
 * Either creates an isolated project namespace (leaving active workspace untouched)
 * or creates an automatic safety backup before replacing the active workspace code.
 */
export function forkTemplate(options: ForkTemplateOptions): ForkTemplateResult {
  const {
    template,
    target,
    newProjectName,
    autoBackup = true,
  } = options;

  let backupCreated = false;
  let backupId: string | undefined;

  if (target === "new_project") {
    // Isolated project namespace: does NOT overwrite the active workspace
    const rawName = (newProjectName || `${template.id}-fork`).trim().toLowerCase();
    const cleanNamespace = rawName.replace(/[^a-z0-9_-]/g, "-");

    if (typeof window !== "undefined") {
      try {
        const projectKey = `soroban_project_${cleanNamespace}`;
        localStorage.setItem(
          projectKey,
          JSON.stringify({
            id: cleanNamespace,
            name: newProjectName || `${template.name} Fork`,
            templateId: template.id,
            code: template.code,
            createdAt: Date.now(),
          })
        );
        localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, cleanNamespace);
      } catch (err) {
        console.error("Failed to store isolated project namespace:", err);
      }
    }

    return {
      success: true,
      targetUrl: `/playground?project=${encodeURIComponent(cleanNamespace)}&template=${encodeURIComponent(template.id)}`,
      backupCreated: false,
      namespace: cleanNamespace,
    };
  }

  // target === "replace_current"
  if (autoBackup) {
    const backup = createWorkspaceBackup(
      undefined,
      `Pre-fork backup before loading "${template.name}"`
    );
    backupCreated = true;
    backupId = backup.id;
  }

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(EDITOR_CODE_STORAGE_KEY, template.code);
      localStorage.setItem("soroban_loaded_template_id", template.id);
    } catch (err) {
      console.error("Failed to set active editor code:", err);
    }
  }

  return {
    success: true,
    targetUrl: `/playground?template=${encodeURIComponent(template.id)}&confirmed=true`,
    backupCreated,
    backupId,
  };
}
