// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Sandboxed processor for sending emails.
 * Runs in a separate process.
 */
export default async function emailProcessor(job) {
  const { to, subject, body } = job.data || {};
  console.log(
    `[Email Worker] Processing job ${job.id} (Attempt ${job.attemptsMade + 1})`
  );

  if (!to) {
    throw new Error('Recipient "to" is required for email jobs');
  }

  // Simulate heavy computation or network request for email sending
  console.log(
    `[Email Worker] Sending email to ${to} with subject "${subject}"`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(`[Email Worker] Email sent successfully to ${to}`);
  return { success: true, sentTo: to, subject };
}
