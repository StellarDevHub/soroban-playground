// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Comprehensive test suite for the Email Notification processor (Issue #971).
// Covers input validation, error handling, HTML sanitization (#2008) and the
// return value shape.

import emailProcessor from '../src/workers/emailProcessor.js';
import { sanitizeEmailHtml } from '../src/workers/emailSanitizer.js';

// Helper to create a mock BullMQ job
function makeJob(data, overrides = {}) {
  return {
    id: overrides.id ?? 'job_1',
    data,
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: 3, ...overrides.opts },
    // BullMQ's Job always exposes updateProgress; the processor reports
    // 20/50/100 for every send, so the mock has to provide it.
    updateProgress: jest.fn().mockResolvedValue(undefined),
  };
}

describe('emailProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Successful sends ───────────────────────────────────────────────────────

  describe('successful sends', () => {
    it('returns success with correct shape', async () => {
      const job = makeJob({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'World',
      });

      const result = await emailProcessor(job);

      expect(result.success).toBe(true);
      expect(result.sentTo).toBe('user@example.com');
      expect(result.subject).toBe('Hello');
      expect(result.hasTextContent).toBe(true);
      expect(result.hasHtmlContent).toBe(false);
      expect(typeof result.durationMs).toBe('number');
    });

    it('trims whitespace from email address', async () => {
      const job = makeJob({
        to: '  user@example.com  ',
        subject: 'Test',
      });

      const result = await emailProcessor(job);
      expect(result.sentTo).toBe('user@example.com');
    });

    it('handles html content flag', async () => {
      const job = makeJob({
        to: 'user@example.com',
        subject: 'HTML',
        html: '<p>Hello</p>',
      });

      const result = await emailProcessor(job);
      expect(result.hasHtmlContent).toBe(true);
      expect(result.hasTextContent).toBe(false);
    });

    it('sets default subject when none provided', async () => {
      const job = makeJob({
        to: 'user@example.com',
      });

      const result = await emailProcessor(job);
      expect(result.subject).toBe('(no subject)');
    });

    it('sets default subject when subject is an empty string', async () => {
      const job = makeJob({ to: 'user@example.com', subject: '' });

      const result = await emailProcessor(job);
      expect(result.subject).toBe('(no subject)');
    });

    it('sets default subject when subject is whitespace only', async () => {
      const job = makeJob({ to: 'user@example.com', subject: '   \t  ' });

      const result = await emailProcessor(job);
      expect(result.subject).toBe('(no subject)');
    });

    it('strips CRLF from the subject so headers cannot be injected', async () => {
      const job = makeJob({
        to: 'user@example.com',
        subject: 'Hello\r\nBcc: attacker@evil.example',
      });

      const result = await emailProcessor(job);
      expect(result.subject).not.toMatch(/[\r\n]/);
      expect(result.subject).toBe('Hello Bcc: attacker@evil.example');
    });

    it('strips CRLF from the sender address', async () => {
      const job = makeJob({
        to: 'user@example.com',
        from: 'admin@test.com\nBcc: attacker@evil.example',
      });

      const result = await emailProcessor(job);
      expect(result.from).not.toMatch(/[\r\n]/);
    });

    it('drops html that is entirely unsafe', async () => {
      const job = makeJob({
        to: 'user@example.com',
        html: '<script>alert(document.cookie)</script>',
      });

      const result = await emailProcessor(job);
      expect(result.hasHtmlContent).toBe(false);
    });

    it('sanitizes html before it is reported as sent', async () => {
      const job = makeJob({
        to: 'user@example.com',
        html: '<p onclick="alert(1)">Safe copy</p>',
      });

      const result = await emailProcessor(job);
      expect(result.hasHtmlContent).toBe(true);
    });

    it('reports progress through the job', async () => {
      const job = makeJob({ to: 'user@example.com' });

      await emailProcessor(job);

      expect(job.updateProgress).toHaveBeenCalledWith(20);
      expect(job.updateProgress).toHaveBeenCalledWith(50);
      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });

    it('includes default from address', async () => {
      const job = makeJob({
        to: 'user@example.com',
      });

      const result = await emailProcessor(job);
      expect(result.from).toBe('noreply@soroban-playground.dev');
    });

    it('uses custom from address when provided', async () => {
      const job = makeJob({
        to: 'user@example.com',
        from: 'admin@test.com',
      });

      const result = await emailProcessor(job);
      expect(result.from).toBe('admin@test.com');
    });
  });

  // ── Input validation ──────────────────────────────────────────────────────

  describe('input validation', () => {
    it('throws when job data is null', async () => {
      const job = makeJob(null);
      await expect(emailProcessor(job)).rejects.toThrow('Validation failed');
    });

    it('throws when job data is undefined', async () => {
      const job = makeJob(undefined);
      await expect(emailProcessor(job)).rejects.toThrow('Validation failed');
    });

    it('throws when "to" is missing', async () => {
      const job = makeJob({ subject: 'Test' });
      await expect(emailProcessor(job)).rejects.toThrow('"to" is required');
    });

    it('throws when "to" is empty string', async () => {
      const job = makeJob({ to: '', subject: 'Test' });
      await expect(emailProcessor(job)).rejects.toThrow('"to" is required');
    });

    it('throws when "to" is not a string', async () => {
      const job = makeJob({ to: 123 });
      await expect(emailProcessor(job)).rejects.toThrow('"to" is required');
    });

    it('throws for invalid email format', async () => {
      const job = makeJob({ to: 'not-an-email' });
      await expect(emailProcessor(job)).rejects.toThrow(
        'Invalid email address'
      );
    });

    it('throws for email without domain', async () => {
      const job = makeJob({ to: 'user@' });
      await expect(emailProcessor(job)).rejects.toThrow(
        'Invalid email address'
      );
    });

    it('throws when "subject" is not a string', async () => {
      const job = makeJob({ to: 'user@example.com', subject: 123 });
      await expect(emailProcessor(job)).rejects.toThrow(
        '"subject" must be a string'
      );
    });

    it('throws when "body" is not a string', async () => {
      const job = makeJob({ to: 'user@example.com', body: 123 });
      await expect(emailProcessor(job)).rejects.toThrow(
        '"body" must be a string'
      );
    });

    it('throws when "html" is not a string', async () => {
      const job = makeJob({ to: 'user@example.com', html: 123 });
      await expect(emailProcessor(job)).rejects.toThrow(
        '"html" must be a string'
      );
    });

    it('throws when "from" is not a string', async () => {
      const job = makeJob({ to: 'user@example.com', from: 123 });
      await expect(emailProcessor(job)).rejects.toThrow(
        '"from" must be a string'
      );
    });
  });

  // ── Error code ────────────────────────────────────────────────────────────

  describe('error codes', () => {
    it('includes VALIDATION_ERROR code on validation failure', async () => {
      const job = makeJob({});
      try {
        await emailProcessor(job);
        fail('Should have thrown');
      } catch (e) {
        expect(e.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ── Job metadata ───────────────────────────────────────────────────────────

  describe('job metadata', () => {
    it('logs attempt number correctly', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const job = makeJob({ to: 'user@example.com' }, { attemptsMade: 2 });

      await emailProcessor(job);

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Attempt 3');
      consoleSpy.mockRestore();
    });

    it('handles job with id 0', async () => {
      const job = makeJob({ to: 'user@example.com' }, { id: 0 });
      const result = await emailProcessor(job);
      expect(result.success).toBe(true);
    });
  });

  // ── HTML sanitization (#2008) ─────────────────────────────────────────────

  describe('html sanitization', () => {
    it('keeps safe formatting markup', () => {
      const clean = sanitizeEmailHtml('<p>Hello <strong>world</strong></p>');
      expect(clean).toBe('<p>Hello <strong>world</strong></p>');
    });

    it('removes script elements and their content', () => {
      const clean = sanitizeEmailHtml(
        '<p>Hi</p><script>alert(document.cookie)</script>'
      );
      expect(clean).toBe('<p>Hi</p>');
      expect(clean).not.toContain('script');
    });

    it('removes inline event handlers', () => {
      const clean = sanitizeEmailHtml('<p onclick="alert(1)">Hi</p>');
      expect(clean).toBe('<p>Hi</p>');
    });

    it('removes javascript: URLs', () => {
      const clean = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>');
      expect(clean).not.toContain('javascript:');
      expect(clean).not.toContain('href');
    });

    it('removes style blocks so @import cannot load remote CSS', () => {
      const clean = sanitizeEmailHtml(
        '<style>@import url("https://evil.example/x.css");</style><p>Hi</p>'
      );
      expect(clean).toBe('<p>Hi</p>');
      expect(clean).not.toContain('@import');
    });

    it('removes style attributes that reference a URL', () => {
      const clean = sanitizeEmailHtml(
        '<p style="background:url(https://evil.example/track)">Hi</p>'
      );
      expect(clean).toBe('<p>Hi</p>');
    });

    it('removes style attributes with expression()', () => {
      const clean = sanitizeEmailHtml(
        '<p style="width:expression(alert(1))">Hi</p>'
      );
      expect(clean).toBe('<p>Hi</p>');
    });

    it('removes style attributes that CSS-escape a dangerous construct', () => {
      const clean = sanitizeEmailHtml(
        '<p style="background:u\\72l(https://evil.example/x)">Hi</p>'
      );
      expect(clean).toBe('<p>Hi</p>');
    });

    it('keeps benign inline styles', () => {
      const clean = sanitizeEmailHtml(
        '<p style="color:#333;font-weight:bold">Hi</p>'
      );
      expect(clean).toContain('style="color:#333;font-weight:bold"');
    });

    it('removes embedding and form elements', () => {
      expect(
        sanitizeEmailHtml('<iframe src="https://evil.example"></iframe>')
      ).toBe('');
      expect(
        sanitizeEmailHtml('<form action="https://evil.example">x</form>')
      ).toBe('x');
    });

    it('preserves table layout markup used by email templates', () => {
      const clean = sanitizeEmailHtml('<table><tr><td>Hi</td></tr></table>');
      expect(clean).toContain('<table>');
      expect(clean).toContain('<td>Hi</td>');
    });

    it('returns an empty string for non-strings and blank input', () => {
      expect(sanitizeEmailHtml(undefined)).toBe('');
      expect(sanitizeEmailHtml(null)).toBe('');
      expect(sanitizeEmailHtml(42)).toBe('');
      expect(sanitizeEmailHtml('   ')).toBe('');
    });
  });
});
