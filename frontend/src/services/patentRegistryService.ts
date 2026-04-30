const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:5000/api";

export type PatentStatus = "Registered" | "Verified";
export type LicenseStatus = "Open" | "Accepted";

export type Patent = {
  id: number;
  owner: string;
  title: string;
  metadata_uri: string;
  metadata_hash: string;
  status: PatentStatus;
  created_at: number;
  updated_at: number;
  verified_at: number | null;
};

export type LicenseOffer = {
  id: number;
  patent_id: number;
  licensor: string;
  licensee: string;
  terms: string;
  payment_amount: number;
  payment_currency: string;
  status: LicenseStatus;
  created_at: number;
  accepted_at: number | null;
  payment_reference: string | null;
};

export type PatentRegistryDashboard = {
  patents: Patent[];
  licenses: LicenseOffer[];
  metrics: {
    patentCount: number;
    verifiedCount: number;
    licenseCount: number;
    activeOffers: number;
    totalPayments: number;
  };
  config: {
    adminAddress: string;
    verifierAddress: string;
  };
  paused: boolean;
};

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
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
      ? payload.details.join(", ")
      : payload.details || "";
    throw new Error([payload.message, details].filter(Boolean).join(": "));
  }

  return payload.data as T;
}

class PatentRegistryService {
  getDashboard() {
    return request<PatentRegistryDashboard>("/patents");
  }

  getHealth() {
    return request<{
      status: string;
      patentCount: number;
      verifiedCount: number;
      licenseCount: number;
      paused: boolean;
    }>("/patents/health");
  }

  registerPatent(payload: {
    actor: string;
    title: string;
    metadata_uri: string;
    metadata_hash: string;
  }) {
    return request<Patent>("/patents", {
      method: "POST",
      headers: {
        "x-actor-address": payload.actor,
      },
      body: JSON.stringify(payload),
    });
  }

  listPatents() {
    return request<Patent[]>("/patents");
  }

  getPatent(patentId: number) {
    return request<Patent>(`/patents/${patentId}`);
  }

  updatePatent(
    patentId: number,
    actor: string,
    payload: {
      title: string;
      metadata_uri: string;
      metadata_hash: string;
    }
  ) {
    return request<Patent>(`/patents/${patentId}`, {
      method: "PATCH",
      headers: {
        "x-actor-address": actor,
      },
      body: JSON.stringify(payload),
    });
  }

  verifyPatent(patentId: number, actor: string) {
    return request<Patent>(`/patents/${patentId}/verify`, {
      method: "POST",
      headers: {
        "x-actor-address": actor,
      },
      body: JSON.stringify({}),
    });
  }

  createLicenseOffer(
    patentId: number,
    actor: string,
    payload: {
      licensee: string;
      terms: string;
      payment_amount: number;
      payment_currency: string;
    }
  ) {
    return request<LicenseOffer>(`/patents/${patentId}/licenses`, {
      method: "POST",
      headers: {
        "x-actor-address": actor,
      },
      body: JSON.stringify(payload),
    });
  }

  getLicensesByPatent(patentId: number) {
    return request<LicenseOffer[]>(`/patents/${patentId}/licenses`);
  }

  acceptLicense(
    patentId: number,
    licenseId: number,
    actor: string,
    payload: {
      payment_reference: string;
    }
  ) {
    return request<LicenseOffer>(
      `/patents/${patentId}/licenses/${licenseId}`,
      {
        method: "PATCH",
        headers: {
          "x-actor-address": actor,
        },
        body: JSON.stringify(payload),
      }
    );
  }

  listLicenses() {
    return request<LicenseOffer[]>("/patents/licenses");
  }

  getLicense(licenseId: number) {
    return request<LicenseOffer>(`/patents/licenses/${licenseId}`);
  }
}

const patentRegistryService = new PatentRegistryService();
export default patentRegistryService;
