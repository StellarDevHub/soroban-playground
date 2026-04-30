import cacheService from './cacheService.js';
import { broadcast } from '../websocket.js';

class MusicLicensingService {
  constructor() {
    this.cacheKeyPrefix = 'music_track_';
  }

  async registerTrack(trackData) {
    const trackId = `track_${Date.now()}`;
    const track = {
      id: trackId,
      ...trackData,
      licensesSold: 0,
      createdAt: new Date().toISOString()
    };

    await cacheService.set(`${this.cacheKeyPrefix}${trackId}`, track, 60 * 60 * 24 * 30); // 30 days

    // Store id in a master list
    const allIds = await cacheService.get(`${this.cacheKeyPrefix}all_ids`) || [];
    allIds.push(trackId);
    await cacheService.set(`${this.cacheKeyPrefix}all_ids`, allIds, 60 * 60 * 24 * 30);

    broadcast({
      type: 'TRACK_REGISTERED',
      data: track
    });

    return track;
  }

  async getTracks() {
    const ids = await cacheService.get(`${this.cacheKeyPrefix}all_ids`) || [];
    const tracks = [];
    for (const id of ids) {
      const track = await cacheService.get(`${this.cacheKeyPrefix}${id}`);
      if (track) tracks.push(track);
    }
    return tracks;
  }

  async purchaseLicense(trackId, buyerData) {
    const track = await cacheService.get(`${this.cacheKeyPrefix}${trackId}`);
    if (!track) throw new Error('Track not found');

    track.licensesSold += 1;
    await cacheService.set(`${this.cacheKeyPrefix}${trackId}`, track, 60 * 60 * 24 * 30);

    const license = {
      trackId,
      buyer: buyerData.wallet,
      pricePaid: track.price,
      purchaseTime: new Date().toISOString()
    };

    broadcast({
      type: 'LICENSE_PURCHASED',
      data: license
    });

    return license;
  }
}

export default new MusicLicensingService();
