export interface CarbonCredit {
  id: string;
  minter: string;
  co2_offset: number;
  project_type: string;
  project_id: string;
  verified: boolean;
  retired: boolean;
}

export interface ImpactMetrics {
  totalCO2Offset: number;
  activeProjects: number;
  totalCreditsMinted: number;
  impactHistory: Array<{ date: string; offset: number }>;
}

export interface CarbonTransaction {
  id: string;
  type: 'mint' | 'transfer' | 'retire' | 'verify';
  amount: number;
  date: string;
  status?: string;
  from?: string;
  to?: string;
  projectId?: string;
}