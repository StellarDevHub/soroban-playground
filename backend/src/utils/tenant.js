// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

export function deriveTenantId({ tenantId, organizationId, userId } = {}) {
  if (tenantId) return String(tenantId);
  if (organizationId !== undefined && organizationId !== null) {
    return `org:${organizationId}`;
  }
  if (userId !== undefined && userId !== null) {
    return `user:${userId}`;
  }
  return null;
}
