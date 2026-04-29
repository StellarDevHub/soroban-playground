import cacheService from './cacheService.js';

const DEFAULT_ADMIN = process.env.PATENT_ADMIN_ADDRESS || 'GADMINPATENTREGISTRY0000000000000000000000000000000';
const DEFAULT_VERIFIER =
  process.env.PATENT_VERIFIER_ADDRESS || 'GVERIFIERPATENTREGISTRY00000000000000000000000000000';

function now() {
  return new Date().toISOString();
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
    this.offers = [];
    this.history = [];
    this.patentSeq = 1;
    this.offerSeq = 1;
    this.historySeq = 1;
  }

  async getDashboard() {
    const cached = await cacheService.get('patents:dashboard');
    if (cached) {
      return cached;
    }

    const payload = {
      patents: await this.listPatents(),
      offers: await this.listOffers(),
      history: await this.listHistory(),
      config: this.getConfig(),
    };
    await cacheService.set('patents:dashboard', payload, 30);

    return payload;
  }

  getConfig() {
    return {
      adminAddress: DEFAULT_ADMIN,
      verifierAddress: DEFAULT_VERIFIER,
    };
  }

  async listPatents(filters = {}) {
    let patents = [...this.patents];
    if (filters.owner) {
      patents = patents.filter((item) => item.owner === filters.owner);
    }
    if (filters.verificationStatus) {
      patents = patents.filter(
        (item) => item.verificationStatus === filters.verificationStatus
      );
    }

    patents.sort((a, b) => b.id - a.id);
    return clone(patents);
  }

  async getPatent(id) {
    const patent = this.patents.find((item) => item.id === Number(id));
    return patent ? clone(patent) : null;
  }

  async createPatent(input) {
    const timestamp = now();
    const patent = {
      id: this.patentSeq++,
      owner: input.owner,
      title: input.title,
      description: input.description,
      contentHash: input.contentHash,
      metadataUri: input.metadataUri,
      verificationStatus: 'pending',
      verifier: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.patents.push(patent);
    this.recordHistory({
      actor: input.owner,
      action: 'patent.created',
      patentId: patent.id,
      details: {
        title: patent.title,
      },
    });
    await this.invalidateCaches();
    return clone(patent);
  }

  async updatePatent(id, actor, patch) {
    const patent = this.patents.find((item) => item.id === Number(id));
    if (!patent) {
      return null;
    }
    if (patent.owner !== actor) {
      const error = new Error('Only the patent owner can update this patent');
      error.statusCode = 403;
      throw error;
    }

    patent.title = patch.title;
    patent.description = patch.description;
    patent.contentHash = patch.contentHash;
    patent.metadataUri = patch.metadataUri;
    patent.updatedAt = now();
    patent.verificationStatus = 'pending';
    patent.verifier = null;

    this.recordHistory({
      actor,
      action: 'patent.updated',
      patentId: patent.id,
      details: {
        title: patent.title,
      },
    });
    await this.invalidateCaches();
    return clone(patent);
  }

  async verifyPatent(id, actor) {
    const patent = this.patents.find((item) => item.id === Number(id));
    if (!patent) {
      return null;
    }

    if (![DEFAULT_ADMIN, DEFAULT_VERIFIER].includes(actor)) {
      const error = new Error('Only an admin or verifier can verify inventions');
      error.statusCode = 403;
      throw error;
    }

    patent.verificationStatus = 'verified';
    patent.verifier = actor;
    patent.updatedAt = now();

    this.recordHistory({
      actor,
      action: 'patent.verified',
      patentId: patent.id,
      details: {
        verificationStatus: patent.verificationStatus,
      },
    });
    await this.invalidateCaches();
    return clone(patent);
  }

  async listOffers(filters = {}) {
    let offers = [...this.offers];
    if (filters.patentId) {
      offers = offers.filter((item) => item.patentId === Number(filters.patentId));
    }
    if (filters.owner) {
      offers = offers.filter((item) => item.owner === filters.owner);
    }
    if (filters.status) {
      offers = offers.filter((item) => item.status === filters.status);
    }

    offers.sort((a, b) => b.id - a.id);
    return clone(offers);
  }

  async getOffer(id) {
    const offer = this.offers.find((item) => item.id === Number(id));
    return offer ? clone(offer) : null;
  }

  async createOffer(input) {
    const patent = this.patents.find((item) => item.id === Number(input.patentId));
    if (!patent) {
      return null;
    }

    if (patent.owner !== input.owner) {
      const error = new Error('Only the patent owner can create a license offer');
      error.statusCode = 403;
      throw error;
    }

    const timestamp = now();
    const offer = {
      id: this.offerSeq++,
      patentId: patent.id,
      patentTitle: patent.title,
      owner: input.owner,
      licensee: null,
      terms: input.terms,
      paymentAmount: input.paymentAmount,
      paymentToken: input.paymentToken,
      status: 'open',
      createdAt: timestamp,
      updatedAt: timestamp,
      acceptedAt: null,
    };

    this.offers.push(offer);
    this.recordHistory({
      actor: input.owner,
      action: 'license.created',
      patentId: patent.id,
      offerId: offer.id,
      details: {
        paymentAmount: offer.paymentAmount,
      },
    });
    await this.invalidateCaches();
    return clone(offer);
  }

  async updateOffer(id, actor, patch) {
    const offer = this.offers.find((item) => item.id === Number(id));
    if (!offer) {
      return null;
    }
    if (offer.owner !== actor) {
      const error = new Error('Only the patent owner can update license terms');
      error.statusCode = 403;
      throw error;
    }
    if (offer.status !== 'open') {
      const error = new Error('Accepted offers cannot be changed');
      error.statusCode = 409;
      throw error;
    }

    offer.terms = patch.terms;
    offer.paymentAmount = patch.paymentAmount;
    offer.paymentToken = patch.paymentToken;
    offer.updatedAt = now();

    this.recordHistory({
      actor,
      action: 'license.updated',
      patentId: offer.patentId,
      offerId: offer.id,
      details: {
        paymentAmount: offer.paymentAmount,
      },
    });
    await this.invalidateCaches();
    return clone(offer);
  }

  async acceptOffer(id, actor) {
    const offer = this.offers.find((item) => item.id === Number(id));
    if (!offer) {
      return null;
    }
    if (offer.owner === actor) {
      const error = new Error('The patent owner cannot accept their own offer');
      error.statusCode = 409;
      throw error;
    }
    if (offer.status !== 'open') {
      const error = new Error('This offer has already been accepted');
      error.statusCode = 409;
      throw error;
    }

    const timestamp = now();
    offer.licensee = actor;
    offer.status = 'accepted';
    offer.acceptedAt = timestamp;
    offer.updatedAt = timestamp;

    this.recordHistory({
      actor,
      action: 'license.accepted',
      patentId: offer.patentId,
      offerId: offer.id,
      details: {
        paymentAmount: offer.paymentAmount,
        paymentToken: offer.paymentToken,
      },
    });
    await this.invalidateCaches();
    return clone(offer);
  }

  async listHistory(filters = {}) {
    let events = [...this.history];
    if (filters.patentId) {
      events = events.filter((item) => item.patentId === Number(filters.patentId));
    }

    events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return clone(events);
  }

  recordHistory(event) {
    this.history.push({
      id: this.historySeq++,
      timestamp: now(),
      ...event,
    });
  }

  async invalidateCaches() {
    await Promise.all([cacheService.del('patents:dashboard')]).catch(() => {});
  }
}

const patentRegistryService = new PatentRegistryService();

export default patentRegistryService;
