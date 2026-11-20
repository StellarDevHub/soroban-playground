/**
 * Template metadata types for contract template library
 */

export type TemplateCategoryType =
  | "DeFi"
  | "Gaming"
  | "RWA"
  | "NFT"
  | "Governance"
  | "Storage"
  | "Utilities"
  | "Payments"
  | "Oracle"
  | "Social"
  | "Identity"
  | "Other";

export type TemplateFunctionality =
  | "Basic"
  | "State Management"
  | "Token Operations"
  | "Voting"
  | "Trading"
  | "Lending"
  | "Insurance"
  | "Data Storage"
  | "Cross-chain"
  | "Advanced";

export type ComplexityLevel =
  "Beginner" | "Intermediate" | "Advanced" | "Expert";

export type DeploymentStatus = "Not Deployed" | "Testnet" | "Production";

export interface TemplateDependency {
  name: string;
  version: string;
}

export interface TemplateMetadata {
  id: string;
  name: string;
  dirName: string;
  description: string;
  category: TemplateCategoryType;
  functionalities: TemplateFunctionality[];
  complexity: ComplexityLevel;
  deploymentStatus: DeploymentStatus;
  dependencies: TemplateDependency[];
  tags: string[];
  author?: string;
  created?: string;
  updated?: string;
  features: string[];
  readmeContent?: string;
}

export interface FilterCriteria {
  categories: TemplateCategoryType[];
  functionalities: TemplateFunctionality[];
  complexityLevels: ComplexityLevel[];
  deploymentStatuses: DeploymentStatus[];
  searchQuery: string;
  dependencies: string[];
}

export interface FilterPreset {
  id: string;
  name: string;
  description?: string;
  criteria: FilterCriteria;
  createdAt: string;
  updatedAt: string;
}

export interface FilterState {
  criteria: FilterCriteria;
  presets: FilterPreset[];
  appliedPresetId?: string;
  resultsCount: number;
}

export interface SuggestionItem {
  label: string;
  category: "category" | "functionality" | "dependency" | "tag";
  value: string;
}
