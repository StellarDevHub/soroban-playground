export const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.1.0',
    info: {
      title: 'Soroban Playground API',
      version: '1.0.0',
      description:
        'API for compiling, deploying, and invoking Soroban smart contracts on the Stellar network',
      contact: {
        name: 'Developer',
      },
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Local development server',
      },
    ],
  },
  apis: ['./src/docs/*.doc.js', './src/routes/*.js'],
};
