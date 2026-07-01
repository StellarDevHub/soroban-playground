// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { getDatabase } from '../database/connection.js';
import apiKeyService from './apiKeyService.js';

export class AuthService {
  /**
   * Fetch a user by ID including their role
   */
  async getUserById(userId) {
    if (!userId) return null;
    const db = getDatabase();
    const user = await db.get(
      'SELECT id, username, email, role FROM users WHERE id = ?',
      [userId]
    );
    return user || null;
  }

  /**
   * Get all permission names for a specific user ID
   */
  async getUserPermissions(userId) {
    if (!userId) return [];
    const db = getDatabase();
    const rows = await db.all(
      `SELECT p.name
       FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       JOIN roles r ON r.id = rp.role_id
       JOIN users u ON u.role = r.name
       WHERE u.id = ?`,
      [userId]
    );
    return rows.map((row) => row.name);
  }

  /**
   * Authenticate a request based on API key, session, or fallback headers
   */
  async authenticate(req) {
    // 1. Check API Key
    let token = null;
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    if (token) {
      const validated = await apiKeyService.validateKey(token);
      if (validated && validated.userId) {
        const user = await this.getUserById(validated.userId);
        if (user) {
          const permissions = await this.getUserPermissions(user.id);
          return { ...user, permissions };
        }
      }
    }

    // 2. Check Session
    if (req.session && req.session.userId) {
      const user = await this.getUserById(req.session.userId);
      if (user) {
        const permissions = await this.getUserPermissions(user.id);
        return { ...user, permissions };
      }
    }

    // 3. Fallback Headers (For testing/development context/GraphQL playground)
    const headerUserId = req.headers['x-user-id'];
    const headerRole = req.headers['x-role'];

    if (headerUserId) {
      const user = await this.getUserById(parseInt(headerUserId, 10));
      if (user) {
        const permissions = await this.getUserPermissions(user.id);
        return { ...user, permissions };
      }
    }

    if (headerRole) {
      // If we only have x-role header (e.g. playground), return a mock user with that role
      const mockUser = {
        id: headerRole === 'admin' ? 1 : 2, // mock ID
        username: `${headerRole}_user`,
        email: `${headerRole}@example.com`,
        role: headerRole,
      };
      // Fetch permissions for the role
      const db = getDatabase();
      const rows = await db.all(
        `SELECT p.name
         FROM permissions p
         JOIN role_permissions rp ON p.id = rp.permission_id
         JOIN roles r ON r.id = rp.role_id
         WHERE r.name = ?`,
        [headerRole]
      );
      const permissions = rows.map((row) => row.name);
      return { ...mockUser, permissions };
    }

    // Default anonymous/guest user
    return {
      id: null,
      username: 'anonymous',
      email: '',
      role: 'guest',
      permissions: ['project:read'], // Guest default permission
    };
  }

  /**
   * Check if a user has a specific permission
   */
  hasPermission(user, permission) {
    if (!user) return false;
    if (user.role === 'admin') return true; // Admins bypass all permission checks
    return user.permissions ? user.permissions.includes(permission) : false;
  }

  /**
   * Check if a user has a specific role
   */
  hasRole(user, roles) {
    if (!user) return false;
    const rolesToCheck = Array.isArray(roles) ? roles : [roles];
    return rolesToCheck.includes(user.role);
  }
}

export default new AuthService();
