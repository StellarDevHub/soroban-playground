// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Row-Level Security (RLS) Rules
 * Decouples authorization rules from data querying and business logic.
 *
 * Rules return a filter fragment (as a JS object) that must be combined with
 * the query, or null if no restriction applies.
 */
export const rlsRules = {
  projects: (user, action = 'read') => {
    // Admin bypasses RLS
    if (!user || user.role === 'admin') {
      return null;
    }

    // If writing (update/delete) and user is admin, no check, otherwise restrict to creator
    if (action === 'write' || action === 'update' || action === 'delete') {
      return { creator_id: user.id };
    }

    // Default read check: developers and guests can only view their own projects
    return { creator_id: user.id };
  },

  files: (user, action = 'read') => {
    if (!user || user.role === 'admin') {
      return null;
    }
    return { uploader_id: user.id };
  }
};
