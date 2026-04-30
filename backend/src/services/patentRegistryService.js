const DEFAULT_ADMIN =
  process.env.PATENT_ADMIN_ADDRESS ||
  "GPATENTADMIN000000000000000000000000000000000000";
const DEFAULT_VERIFIER =
  process.env.PATENT_VERIFIER_ADDRESS ||
  "GPATENTVERIFIER000000000000000000000000000000000000";

function nowIso() {
  return new Date().toISOString();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class PatentRegistryService {
  constructor() {
    this.reset();
  }

  reset() {
    this.patents = [];
    this.licenses = [];
    this.patentSeq = 1;
    this.licenseSeq = 1;
    this.admin = DEFAULT_ADMIN;
    this.verifier = DEFAULT_VERIFIER;
    this.paused = false;
    this.cachedDashboard = null;
    this.cacheExpiresAt = 0;
  }

  getConfig() {
    return {
      adminAddress: this.admin,
      verifierAddress: this.verifier,
    };
  }

  async getDashboard() {
    if (this.cachedDashboard && Date.now() < this.cacheExpiresAt) {
      return clone(this.cachedDashboard);
    }

    const patents = this.listPatents();
    const payload = {
      patents,
      licenses: this.listLicenses(),
      metrics: {
        patentCount: patents.length,
        verifiedCount: patents.filter((p) => p.status === "Verified").length,
        licenseCount: this.licenses.length,
        activeOffers: this.licenses.filter((l) => l.status === "Open").length,
        totalPayments: this.licenses.reduce(
          (sum, l) => sum + (l.payment_amount || 0),
          0
        ),
      },
      config: this.getConfig(),
      paused: this.paused,
    };

    this.cachedDashboard = payload;
    this.cacheExpiresAt = Date.now() + 30_000;
    return clone(payload);
  }

  registerPatent(owner, title, metadata_uri, metadata_hash) {
    if (this.paused) {
      throw new Error("Contract is paused");
    }
    if (!owner || !title || !metadata_uri || !metadata_hash) {
      throw new Error("Invalid patent input");
    }

    const patent = {
      id: this.patentSeq++,
      owner,
      title,
      metadata_uri,
      metadata_hash,
      status: "Registered",
      created_at: nowSeconds(),
      updated_at: nowSeconds(),
      verified_at: null,
    };

    this.patents.push(patent);
    return clone(patent);
  }

  updatePatent(owner, patent_id, title, metadata_uri, metadata_hash) {
    if (this.paused) {
      throw new Error("Contract is paused");
    }

    const patent = this.patents.find((p) => p.id === patent_id);
    if (!patent) {
      throw new Error("Patent not found");
    }
    if (patent.owner !== owner) {
      throw new Error("Not patent owner");
    }

    patent.title = title;
    patent.metadata_uri = metadata_uri;
    patent.metadata_hash = metadata_hash;
    patent.updated_at = nowSeconds();

    return clone(patent);
  }

  verifyPatent(verifier, patent_id) {
    if (this.paused) {
      throw new Error("Contract is paused");
    }
    if (verifier !== this.verifier) {
      throw new Error("Not verifier");
    }

    const patent = this.patents.find((p) => p.id === patent_id);
    if (!patent) {
      throw new Error("Patent not found");
    }
    if (patent.status === "Verified") {
      throw new Error("Already verified");
    }

    patent.status = "Verified";
    patent.verified_at = nowSeconds();
    patent.updated_at = nowSeconds();

    return clone(patent);
  }

  createLicenseOffer(owner, patent_id, licensee, terms, payment_amount, payment_currency) {
    if (this.paused) {
      throw new Error("Contract is paused");
    }

    const patent = this.patents.find((p) => p.id === patent_id);
    if (!patent) {
      throw new Error("Patent not found");
    }
    if (patent.owner !== owner) {
      throw new Error("Not patent owner");
    }
    if (patent.status !== "Verified") {
      throw new Error("Patent not verified");
    }

    const license = {
      id: this.licenseSeq++,
      patent_id,
      licensor: owner,
      licensee,
      terms,
      payment_amount,
      payment_currency,
      status: "Open",
      created_at: nowSeconds(),
      accepted_at: null,
      payment_reference: null,
    };

    this.licenses.push(license);
    return clone(license);
  }

  acceptLicense(licensee, patent_id, license_id, payment_reference) {
    if (this.paused) {
      throw new Error("Contract is paused");
    }

    const license = this.licenses.find((l) => l.id === license_id);
    if (!license) {
      throw new Error("License not found");
    }
    if (license.licensee !== licensee) {
      throw new Error("Unauthorized");
    }
    if (license.status !== "Open") {
      throw new Error("License already accepted");
    }

    license.status = "Accepted";
    license.accepted_at = nowSeconds();
    license.payment_reference = payment_reference;

    return clone(license);
  }

  getPatent(patent_id) {
    const patent = this.patents.find((p) => p.id === patent_id);
    if (!patent) {
      throw new Error("Patent not found");
    }
    return clone(patent);
  }

  getLicense(license_id) {
    const license = this.licenses.find((l) => l.id === license_id);
    if (!license) {
      throw new Error("License not found");
    }
    return clone(license);
  }

  listPatents() {
    return clone(
      this.patents
        .map((patent) => ({
          ...patent,
        }))
        .sort((a, b) => b.id - a.id)
    );
  }

  listLicenses() {
    return clone(
      this.licenses
        .map((license) => ({
          ...license,
        }))
        .sort((a, b) => b.id - a.id)
    );
  }

  getLicensesByPatent(patent_id) {
    return clone(
      this.licenses
        .filter((l) => l.patent_id === patent_id)
        .sort((a, b) => b.id - a.id)
    );
  }

  setVerifier(admin, verifier) {
    if (admin !== this.admin) {
      throw new Error("Not admin");
    }
    this.verifier = verifier;
    this.cachedDashboard = null;
  }

  pause(admin) {
    if (admin !== this.admin) {
      throw new Error("Not admin");
    }
    this.paused = true;
    this.cachedDashboard = null;
  }

  unpause(admin) {
    if (admin !== this.admin) {
      throw new Error("Not admin");
    }
    this.paused = false;
    this.cachedDashboard = null;
  }

  isPaused() {
    return this.paused;
  }

  getAdmin() {
    return this.admin;
  }

  getVerifier() {
    return this.verifier;
  }
}

const patentRegistryService = new PatentRegistryService();
export default patentRegistryService;
