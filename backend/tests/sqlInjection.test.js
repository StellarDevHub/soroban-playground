import {
  assertSafeIdentifier,
  cutoffTimestampDaysAgo,
  resolveMappedSort,
  sanitizePositiveInteger,
  validateParameterizedQuery,
} from '../src/database/safeQuery.js';

describe('SQL injection guardrails', () => {
  describe('assertSafeIdentifier', () => {
    it('accepts safe column names', () => {
      expect(assertSafeIdentifier('user_id')).toBe('user_id');
    });

    it('rejects injection payloads in identifiers', () => {
      expect(() => assertSafeIdentifier('id; DROP TABLE users--')).toThrow(
        /Unsafe SQL/
      );
      expect(() => assertSafeIdentifier('1=1')).toThrow(/Unsafe SQL/);
    });
  });

  describe('resolveMappedSort', () => {
    const mapping = {
      relevance: 'rank DESC',
      recent: 'created_at DESC',
    };

    it('uses allowlisted sort keys only', () => {
      expect(resolveMappedSort('recent', mapping)).toBe('created_at DESC');
      expect(resolveMappedSort('recent; DROP TABLE projects--', mapping)).toBe(
        'rank DESC'
      );
    });
  });

  describe('sanitizePositiveInteger', () => {
    it('neutralizes OR 1=1 style day inputs', () => {
      expect(sanitizePositiveInteger('OR 1=1')).toBe(30);
      expect(sanitizePositiveInteger('7 OR 1=1')).toBe(7);
      expect(sanitizePositiveInteger('-10')).toBe(1);
      expect(sanitizePositiveInteger('3650')).toBe(365);
    });
  });

  describe('cutoffTimestampDaysAgo', () => {
    it('returns ISO timestamps for bounded day windows', () => {
      const now = Date.parse('2026-01-31T00:00:00.000Z');
      const cutoff = cutoffTimestampDaysAgo('10', now);
      expect(cutoff).toBe('2026-01-21T00:00:00.000Z');
    });
  });

  describe('validateParameterizedQuery', () => {
    it('accepts prepared statements with matching placeholders', () => {
      expect(() =>
        validateParameterizedQuery('SELECT * FROM users WHERE id = ?', [1])
      ).not.toThrow();
    });

    it('rejects classic SQL injection strings in raw SQL', () => {
      expect(() =>
        validateParameterizedQuery('SELECT * FROM users WHERE id = 1 OR 1=1')
      ).toThrow(/unsafe SQL/i);
      expect(() =>
        validateParameterizedQuery('SELECT * FROM users; DROP TABLE users')
      ).toThrow(/unsafe SQL/i);
      expect(() =>
        validateParameterizedQuery('SELECT * FROM users WHERE id = ?', [])
      ).toThrow(/Parameter count mismatch/);
    });
  });
});
