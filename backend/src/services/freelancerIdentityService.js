import crypto from 'crypto';
import { EventEmitter } from 'events';

const now = () => new Date().toISOString();

function stableId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function numericHash(value) {
  if (Number.isInteger(value) && value > 0) return value;
  const digest = crypto.createHash('sha256').update(String(value)).digest();
  return digest.readUInt32BE(0);
}

class FreelancerIdentityService extends EventEmitter {
  constructor() {
    super();
    this.profiles = new Map();
    this.verifications = new Map();
    this.endorsements = new Map();
    this.activity = [];
  }

  listProfiles({ q = '', skillHash, verifiedOnly = false } = {}) {
    const needle = q.trim().toLowerCase();
    const onlyVerified = verifiedOnly === true || verifiedOnly === 'true';
    return [...this.profiles.values()]
      .filter((profile) => {
        if (onlyVerified && profile.verifiedProjects === 0) return false;
        if (skillHash && !profile.skills.includes(Number(skillHash))) return false;
        if (!needle) return true;
        return [profile.handle, profile.owner, profile.bio]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(needle));
      })
      .sort((a, b) => b.reputation - a.reputation);
  }

  getProfile(owner) {
    const profile = this.profiles.get(owner);
    if (!profile) {
      const error = new Error('Freelancer profile not found');
      error.statusCode = 404;
      throw error;
    }
    return profile;
  }

  createProfile(input) {
    const owner = String(input.owner || '').trim();
    const handle = String(input.handle || '').trim();
    const portfolioUrl = String(input.portfolioUrl || '').trim();

    if (!owner || !handle || !portfolioUrl) {
      const error = new Error('owner, handle and portfolioUrl are required');
      error.statusCode = 400;
      throw error;
    }
    if (this.profiles.has(owner)) {
      const error = new Error('Freelancer profile already exists');
      error.statusCode = 409;
      throw error;
    }

    const timestamp = now();
    const profile = {
      owner,
      handle,
      bio: String(input.bio || '').slice(0, 280),
      portfolioUrl,
      displayHash: numericHash(input.displayHash || handle),
      portfolioHash: numericHash(input.portfolioHash || portfolioUrl),
      skills: Array.isArray(input.skills)
        ? input.skills.map(numericHash).slice(0, 12)
        : [],
      verifiedProjects: 0,
      endorsementCount: 0,
      reputation: 0,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.profiles.set(owner, profile);
    return this.record('profile.created', profile);
  }

  verifyPortfolio(input) {
    const verifier = String(input.verifier || '').trim();
    const owner = String(input.owner || '').trim();
    const score = Number(input.score);
    if (!verifier || !owner || !Number.isInteger(score) || score < 1 || score > 100) {
      const error = new Error('verifier, owner and score from 1 to 100 are required');
      error.statusCode = 400;
      throw error;
    }

    const profile = this.getProfile(owner);
    const verification = {
      id: stableId('ver'),
      owner,
      verifier,
      projectHash: numericHash(input.projectHash || input.projectUrl || owner),
      evidenceHash: numericHash(input.evidenceHash || input.evidenceUrl || verifier),
      score,
      createdAt: now(),
      active: true,
    };

    this.verifications.set(verification.id, verification);
    profile.verifiedProjects += 1;
    profile.reputation += score;
    profile.updatedAt = verification.createdAt;
    this.profiles.set(owner, profile);
    return this.record('portfolio.verified', { profile, verification });
  }

  endorseSkill(input) {
    const endorser = String(input.endorser || '').trim();
    const owner = String(input.owner || '').trim();
    const weight = Number(input.weight);
    if (!endorser || !owner || endorser === owner) {
      const error = new Error('endorser and a different owner are required');
      error.statusCode = 400;
      throw error;
    }
    if (!Number.isInteger(weight) || weight < 1 || weight > 10) {
      const error = new Error('weight must be an integer from 1 to 10');
      error.statusCode = 400;
      throw error;
    }

    const profile = this.getProfile(owner);
    const endorsement = {
      id: stableId('end'),
      owner,
      endorser,
      skillHash: numericHash(input.skillHash || input.skill || owner),
      evidenceHash: numericHash(input.evidenceHash || input.evidenceUrl || endorser),
      weight,
      createdAt: now(),
      revoked: false,
    };

    this.endorsements.set(endorsement.id, endorsement);
    profile.endorsementCount += 1;
    profile.reputation += weight;
    profile.updatedAt = endorsement.createdAt;
    this.profiles.set(owner, profile);
    return this.record('skill.endorsed', { profile, endorsement });
  }

  analytics() {
    const profiles = [...this.profiles.values()];
    return {
      profileCount: profiles.length,
      activeProfiles: profiles.filter((profile) => profile.active).length,
      verificationCount: this.verifications.size,
      endorsementCount: this.endorsements.size,
      averageReputation:
        profiles.length === 0
          ? 0
          : Math.round(
              profiles.reduce((total, profile) => total + profile.reputation, 0) /
                profiles.length
            ),
      topProfiles: profiles
        .slice()
        .sort((a, b) => b.reputation - a.reputation)
        .slice(0, 5),
      recentActivity: this.activity.slice(0, 20),
    };
  }

  record(type, data) {
    const event = { type, data, timestamp: now() };
    this.activity.unshift(event);
    this.activity = this.activity.slice(0, 100);
    this.emit('activity', event);
    return data;
  }
}

export const freelancerIdentityEvents = new EventEmitter();
const service = new FreelancerIdentityService();
service.on('activity', (event) => freelancerIdentityEvents.emit('activity', event));

export default service;
