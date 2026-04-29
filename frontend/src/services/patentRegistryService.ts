const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:5000/api';

export type PatentItem = {
  id: number;
  owner: string;
  title: string;
  description: string;
  contentHash: string;
  metadataUri: string;
  verificationStatus: 'pending' | 'verified';
  verifier: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LicenseOffer = {
  id: number;
  patentId: number;
  patentTitle: string;
  owner: string;
  licensee: string | null;
  terms: string;
  paymentAmount: number;
  paymentToken: string;
  status: 'open' | 'accepted';
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
};

export type HistoryItem = {
  id: number;
  timestamp: string;
  actor: string;
  action: string;
  patentId?: number;
  offerId?: number;
  details?: Record<string, unknown>;
};

export type PatentDashboardResponse = {
  patents: PatentItem[];
  offers: LicenseOffer[];
  history: HistoryItem[];
  config: {
    adminAddress: string;
    verifierAddress: string;
  };
};

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    message?: string;
    details?: string[] | string;
  };

  if (!response.ok) {
    const details = Array.isArray(payload.details)
      ? payload.details.join(', ')
      : payload.details || '';
    throw new Error([payload.message, details].filter(Boolean).join(': '));
  }

  return payload.data as T;
}

class PatentRegistryService {
  getDashboard() {
    return request<PatentDashboardResponse>('/patents');
  }

  getHealth() {
    return request<{ status: string; patents: number; offers: number }>('/patents/health');
  }

  registerPatent(payload: {
    owner: string;
    title: string;
    description: string;
    contentHash: string;
    metadataUri: string;
  }) {
    return request<PatentItem>('/patents/items', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updatePatent(
    patentId: number,
    actor: string,
    payload: {
      title: string;
      description: string;
      contentHash: string;
      metadataUri: string;
    }
  ) {
    return request<PatentItem>(`/patents/items/${patentId}`, {
      method: 'PATCH',
      headers: {
        'x-actor-address': actor,
      },
      body: JSON.stringify(payload),
    });
  }

  verifyPatent(patentId: number, actor: string) {
    return request<PatentItem>(`/patents/items/${patentId}/verify`, {
      method: 'POST',
      headers: {
        'x-actor-address': actor,
      },
      body: JSON.stringify({}),
    });
  }

  createLicenseOffer(payload: {
    patentId: number;
    owner: string;
    terms: string;
    paymentAmount: number;
    paymentToken: string;
  }) {
    return request<LicenseOffer>('/patents/licenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateLicenseOffer(
    offerId: number,
    actor: string,
    payload: {
      terms: string;
      paymentAmount: number;
      paymentToken: string;
    }
  ) {
    return request<LicenseOffer>(`/patents/licenses/${offerId}`, {
      method: 'PATCH',
      headers: {
        'x-actor-address': actor,
      },
      body: JSON.stringify(payload),
    });
  }

  acceptLicenseOffer(offerId: number, actor: string) {
    return request<LicenseOffer>(`/patents/licenses/${offerId}/accept`, {
      method: 'POST',
      headers: {
        'x-actor-address': actor,
      },
      body: JSON.stringify({}),
    });
  }
}

export default new PatentRegistryService();
