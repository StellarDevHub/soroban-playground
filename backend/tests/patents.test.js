import express from 'express';
import request from 'supertest';

import { errorHandler } from '../src/middleware/errorHandler.js';
import patentsRoute from '../src/routes/patents.js';
import patentRegistryService from '../src/services/patentRegistryService.js';

const app = express();
app.use(express.json());
app.use('/api/patents', patentsRoute);
app.use(errorHandler);

const adminActor = patentRegistryService.getConfig().adminAddress;
const verifierActor = patentRegistryService.getConfig().verifierAddress;

describe('Patent registry routes', () => {
  beforeEach(() => {
    patentRegistryService.reset();
  });

  it('registers and verifies a patent', async () => {
    const create = await request(app).post('/api/patents/items').send({
      owner: 'GOWNER123',
      title: 'Adaptive Cooling Mesh',
      description: 'Heat balancing textile mesh for battery enclosures.',
      contentHash: 'QmPatentHash',
      metadataUri: 'ipfs://adaptive-cooling',
    });

    expect(create.status).toBe(201);
    expect(create.body.data.verificationStatus).toBe('pending');

    const verify = await request(app)
      .post(`/api/patents/items/${create.body.data.id}/verify`)
      .set('x-actor-address', verifierActor)
      .send({});

    expect(verify.status).toBe(200);
    expect(verify.body.data.verificationStatus).toBe('verified');
    expect(verify.body.data.verifier).toBe(verifierActor);
  });

  it('blocks unauthorized patent updates', async () => {
    const create = await request(app).post('/api/patents/items').send({
      owner: 'GOWNER456',
      title: 'Solar Intake Skin',
      description: 'A flexible photovoltaic membrane.',
      contentHash: 'QmSolarHash',
      metadataUri: 'ipfs://solar-intake',
    });

    const update = await request(app)
      .patch(`/api/patents/items/${create.body.data.id}`)
      .set('x-actor-address', 'GNOTOWNER')
      .send({
        title: 'Solar Intake Skin v2',
        description: 'Updated description',
        contentHash: 'QmSolarHash2',
        metadataUri: 'ipfs://solar-intake-v2',
      });

    expect(update.status).toBe(403);
    expect(update.body.message).toContain('Only the patent owner');
  });

  it('creates and accepts a license offer', async () => {
    const patent = await request(app).post('/api/patents/items').send({
      owner: 'GOWNER789',
      title: 'Bio Adhesive Scaffold',
      description: 'Rapid-setting scaffold for regenerative medicine.',
      contentHash: 'QmBioHash',
      metadataUri: 'ipfs://bio-adhesive',
    });

    const offer = await request(app).post('/api/patents/licenses').send({
      patentId: patent.body.data.id,
      owner: 'GOWNER789',
      terms: 'Non-exclusive, regional healthcare deployment.',
      paymentAmount: 2500,
      paymentToken: 'USDC',
    });

    expect(offer.status).toBe(201);
    expect(offer.body.data.status).toBe('open');

    const accept = await request(app)
      .post(`/api/patents/licenses/${offer.body.data.id}/accept`)
      .set('x-actor-address', 'GLICENSEE999')
      .send({});

    expect(accept.status).toBe(200);
    expect(accept.body.data.status).toBe('accepted');
    expect(accept.body.data.licensee).toBe('GLICENSEE999');
  });

  it('returns dashboard data and history', async () => {
    await request(app).post('/api/patents/items').send({
      owner: adminActor,
      title: 'Admin Patent',
      description: 'Admin-created fixture patent',
      contentHash: 'fixture-hash',
      metadataUri: 'ipfs://fixture',
    });

    const dashboard = await request(app).get('/api/patents');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.patents).toHaveLength(1);
    expect(dashboard.body.data.history.length).toBeGreaterThan(0);
  });
});
