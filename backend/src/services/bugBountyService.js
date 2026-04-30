import cacheService from './cacheService.js';
import { broadcast } from '../websocket.js';

class BugBountyService {
  constructor() {
    this.cacheKeyPrefix = 'bug_bounty_';
  }

  async submitReport(reportData) {
    const reportId = `report_${Date.now()}`;
    const report = {
      id: reportId,
      ...reportData,
      status: 'Open',
      reward: null,
      createdAt: new Date().toISOString()
    };

    // Store in cache (or DB in a real app)
    await cacheService.set(`${this.cacheKeyPrefix}${reportId}`, report, 60 * 60 * 24 * 30); // 30 days

    // Broadcast update via WebSocket
    broadcast({
      type: 'BUG_REPORT_SUBMITTED',
      data: report
    });

    return report;
  }

  async getReports() {
    // In a real database, we would query. Since we use cache here, we'll return a mock list
    // or retrieve keys starting with prefix. CacheService might not have a pattern match.
    // For now, return a mock or a stored array of IDs.
    const ids = await cacheService.get(`${this.cacheKeyPrefix}all_ids`) || [];
    const reports = [];
    for (const id of ids) {
      const report = await cacheService.get(`${this.cacheKeyPrefix}${id}`);
      if (report) reports.push(report);
    }
    return reports;
  }

  async reviewReport(reportId, reviewData) {
    const report = await cacheService.get(`${this.cacheKeyPrefix}${reportId}`);
    if (!report) throw new Error('Report not found');

    report.status = reviewData.status;
    report.reward = reviewData.reward;
    report.reviewedAt = new Date().toISOString();

    await cacheService.set(`${this.cacheKeyPrefix}${reportId}`, report, 60 * 60 * 24 * 30);

    broadcast({
      type: 'BUG_REPORT_REVIEWED',
      data: report
    });

    return report;
  }
}

export default new BugBountyService();
