// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Job Marketplace API Service
 * 
 * Handles all API calls to the job marketplace backend
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

interface Job {
  id: number;
  client: string;
  freelancer?: string;
  title: string;
  description: string;
  payment_token: string;
  total_escrow: string;
  released_amount: string;
  status: 'Open' | 'InProgress' | 'Completed' | 'Disputed' | 'Cancelled';
  required_skills: string[];
  milestones: Milestone[];
  created_at: string;
  accepted_at?: string;
  completed_at?: string;
}

interface Milestone {
  id: number;
  job_id: number;
  description: string;
  amount: string;
  is_released: boolean;
  milestone_index: number;
}

interface Skill {
  id: number;
  user_address: string;
  skill: string;
  level: number;
  verified_at: string;
  verified_by: string;
}

interface Certification {
  id: number;
  user_address: string;
  name: string;
  issuer: string;
  issued_at: string;
  valid_until: string;
}

interface Dispute {
  id: number;
  job_id: number;
  raised_by: string;
  reason: string;
  created_at: string;
  resolved_at?: string;
  resolution?: string;
  resolved_by?: string;
}

class JobMarketplaceAPI {
  /**
   * Get all jobs with filtering and pagination
   */
  async getJobs(filters: {
    page?: number;
    limit?: number;
    status?: string;
    client?: string;
    freelancer?: string;
  } = {}): Promise<{ success: boolean; data: any }> {
    const params = new URLSearchParams();
    
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.status) params.append('status', filters.status);
    if (filters.client) params.append('client', filters.client);
    if (filters.freelancer) params.append('freelancer', filters.freelancer);

    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/jobs?${params.toString()}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch jobs');
    }

    return response.json();
  }

  /**
   * Get job details by ID
   */
  async getJob(jobId: number): Promise<{ success: boolean; data: Job }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/jobs/${jobId}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch job');
    }

    return response.json();
  }

  /**
   * Create a new job
   */
  async createJob(jobData: {
    client: string;
    title: string;
    description: string;
    paymentToken: string;
    totalEscrow: string;
    milestones: Array<{ description: string; amount: string }>;
    requiredSkills?: string[];
  }): Promise<{ success: boolean; data: Job }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/jobs`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jobData),
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to create job');
    }

    return response.json();
  }

  /**
   * Accept a job as freelancer
   */
  async acceptJob(jobId: number, freelancer: string): Promise<{ success: boolean; data: any }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/jobs/${jobId}/accept`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ freelancer }),
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to accept job');
    }

    return response.json();
  }

  /**
   * Release milestone payment
   */
  async releaseMilestone(
    jobId: number,
    client: string,
    milestoneIndex: number
  ): Promise<{ success: boolean; data: any }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/jobs/${jobId}/release-milestone`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ client, milestoneIndex }),
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to release milestone');
    }

    return response.json();
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: number, client: string): Promise<{ success: boolean; data: any }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/jobs/${jobId}/cancel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ client }),
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to cancel job');
    }

    return response.json();
  }

  /**
   * Get user skills
   */
  async getUserSkills(user: string): Promise<{ success: boolean; data: Skill[] }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/skills/${user}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch skills');
    }

    return response.json();
  }

  /**
   * Verify a skill (admin only)
   */
  async verifySkill(data: {
    admin: string;
    user: string;
    skill: string;
    level: number;
  }): Promise<{ success: boolean; data: any }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/skills/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to verify skill');
    }

    return response.json();
  }

  /**
   * Get user certifications
   */
  async getUserCertifications(user: string): Promise<{ success: boolean; data: Certification[] }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/certifications/${user}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch certifications');
    }

    return response.json();
  }

  /**
   * Issue a certification (admin only)
   */
  async issueCertification(data: {
    admin: string;
    user: string;
    certificationName: string;
    issuer: string;
    validUntil: number;
  }): Promise<{ success: boolean; data: any }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/certifications/issue`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to issue certification');
    }

    return response.json();
  }

  /**
   * Raise a dispute
   */
  async raiseDispute(data: {
    caller: string;
    jobId: number;
    reason: string;
  }): Promise<{ success: boolean; data: any }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/disputes/raise`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to raise dispute');
    }

    return response.json();
  }

  /**
   * Get dispute details
   */
  async getDispute(disputeId: number): Promise<{ success: boolean; data: Dispute }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/disputes/${disputeId}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch dispute');
    }

    return response.json();
  }

  /**
   * Resolve a dispute (admin only)
   */
  async resolveDispute(data: {
    disputeId: number;
    admin: string;
    refundClient: string;
    releaseToFreelancer: string;
  }): Promise<{ success: boolean; data: any }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/disputes/${data.disputeId}/resolve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          admin: data.admin,
          refundClient: data.refundClient,
          releaseToFreelancer: data.releaseToFreelancer,
        }),
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to resolve dispute');
    }

    return response.json();
  }

  /**
   * Get contract status
   */
  async getContractStatus(): Promise<{ success: boolean; data: any }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/admin/status`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch contract status');
    }

    return response.json();
  }

  /**
   * Get analytics overview
   */
  async getAnalyticsOverview(): Promise<{ success: boolean; data: any }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/analytics/overview`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch analytics');
    }

    return response.json();
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(address: string): Promise<{ success: boolean; data: any }> {
    const response = await fetch(
      `${API_BASE_URL}/job-marketplace/analytics/user/${address}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch user analytics');
    }

    return response.json();
  }
}

export default new JobMarketplaceAPI();
