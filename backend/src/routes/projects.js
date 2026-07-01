// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { getDatabase } from '../database/connection.js';
import { QueryBuilder } from '../services/queryBuilder.js';
import {
  authenticate,
  requirePermission,
} from '../middleware/auth.js';

const router = express.Router();
const projectQueryBuilder = new QueryBuilder('projects');

// Apply authentication to all projects routes
router.use(authenticate);

/**
 * GET /api/projects
 * Lists projects for the authenticated user, enforcing RLS.
 */
router.get(
  '/',
  requirePermission('project:read'),
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    // Parse filters/pagination from query params if needed
    const limit = parseInt(req.query.limit, 10) || 50;
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.status) filter.status = req.query.status;

    // Use QueryBuilder and pass req.user to enforce RLS
    const { sql, params } = projectQueryBuilder.buildFullQuery(
      { filter, limit },
      req.user,
      'read'
    );

    const projects = await db.all(sql, params);
    
    // Parse tags JSON strings back to arrays if necessary
    const formatted = projects.map(p => ({
      ...p,
      tags: p.tags ? JSON.parse(p.tags) : [],
    }));

    return res.json({ success: true, projects: formatted });
  })
);

/**
 * GET /api/projects/:id
 * Retrieve a specific project if owned by the user (or admin).
 */
router.get(
  '/:id',
  requirePermission('project:read'),
  asyncHandler(async (req, res, next) => {
    const db = getDatabase();
    const { id } = req.params;

    const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
    if (!project) {
      return next(createHttpError(404, 'Project not found'));
    }

    // Verify row-level access: creator matches user (unless admin)
    if (req.user.role !== 'admin' && project.creator_id !== req.user.id) {
      return next(createHttpError(403, 'Forbidden: You do not own this project'));
    }

    project.tags = project.tags ? JSON.parse(project.tags) : [];
    return res.json({ success: true, project });
  })
);

/**
 * POST /api/projects
 * Create a new project.
 */
router.post(
  '/',
  requirePermission('project:create'),
  asyncHandler(async (req, res, next) => {
    const { title, description, category, status, funding_goal, tags } = req.body || {};
    
    if (!title || !description || !category || !status || funding_goal === undefined) {
      return next(createHttpError(400, 'Missing required fields'));
    }

    const db = getDatabase();
    const creatorId = req.user.id;
    const creatorName = req.user.username;
    const tagsJson = JSON.stringify(tags || []);

    const result = await db.run(
      `INSERT INTO projects (title, description, category, status, creator_id, creator_name, funding_goal, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, category, status, creatorId, creatorName, funding_goal, tagsJson]
    );

    const newProject = {
      id: result.lastID,
      title,
      description,
      category,
      status,
      creator_id: creatorId,
      creator_name: creatorName,
      funding_goal,
      tags: tags || [],
    };

    return res.status(201).json({ success: true, project: newProject });
  })
);

/**
 * PUT /api/projects/:id
 * Update an existing project if owned by the user (or admin).
 */
router.put(
  '/:id',
  requirePermission('project:update'),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const db = getDatabase();

    const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
    if (!project) {
      return next(createHttpError(404, 'Project not found'));
    }

    // Verify row-level access: creator matches user (unless admin)
    if (req.user.role !== 'admin' && project.creator_id !== req.user.id) {
      return next(createHttpError(403, 'Forbidden: You do not own this project'));
    }

    const { title, description, category, status, funding_goal, tags } = req.body || {};
    const updatedTitle = title !== undefined ? title : project.title;
    const updatedDesc = description !== undefined ? description : project.description;
    const updatedCat = category !== undefined ? category : project.category;
    const updatedStatus = status !== undefined ? status : project.status;
    const updatedGoal = funding_goal !== undefined ? funding_goal : project.funding_goal;
    const updatedTags = tags !== undefined ? JSON.stringify(tags) : project.tags;

    await db.run(
      `UPDATE projects 
       SET title = ?, description = ?, category = ?, status = ?, funding_goal = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [updatedTitle, updatedDesc, updatedCat, updatedStatus, updatedGoal, updatedTags, id]
    );

    const updatedProject = {
      id: parseInt(id, 10),
      title: updatedTitle,
      description: updatedDesc,
      category: updatedCat,
      status: updatedStatus,
      creator_id: project.creator_id,
      creator_name: project.creator_name,
      funding_goal: updatedGoal,
      tags: tags !== undefined ? tags : (project.tags ? JSON.parse(project.tags) : []),
    };

    return res.json({ success: true, project: updatedProject });
  })
);

/**
 * DELETE /api/projects/:id
 * Delete an existing project if owned by the user (or admin).
 */
router.delete(
  '/:id',
  requirePermission('project:delete'),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const db = getDatabase();

    const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
    if (!project) {
      return next(createHttpError(404, 'Project not found'));
    }

    // Verify row-level access: creator matches user (unless admin)
    if (req.user.role !== 'admin' && project.creator_id !== req.user.id) {
      return next(createHttpError(403, 'Forbidden: You do not own this project'));
    }

    await db.run('DELETE FROM projects WHERE id = ?', [id]);

    return res.json({ success: true, message: 'Project deleted successfully' });
  })
);

export default router;
