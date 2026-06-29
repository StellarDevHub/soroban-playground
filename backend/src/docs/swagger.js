// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Soroban Playground API',
      version: '1.0.0',
      description:
        'REST API for compiling, deploying, and invoking Soroban smart contracts on Stellar.',
    },
    servers: [{ url: '/api', description: 'Default server' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/**/*.js', './src/docs/*.doc.js'],
};

export const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app) {
  app.get('/api-docs/spec.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'Soroban Playground API Docs',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
      },
    }),
  );
}
