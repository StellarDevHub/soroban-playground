import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import compileRoute from './routes/compile.js';
import deployRoute from './routes/deploy.js';
import invokeRoute from './routes/invoke.js';
import patentsRoute from './routes/patents.js';
import searchRoute from './routes/search.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import cacheService from './services/cacheService.js';

const app = express();
const PORT = Number.parseInt(process.env.PORT || '5000', 10);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));

app.use('/api/compile', compileRoute);
app.use('/api/deploy', deployRoute);
app.use('/api/invoke', invokeRoute);
app.use('/api/search', searchRoute);
app.use('/api/patents', patentsRoute);

app.get('/api/health', async (_req, res) => {
  const cacheHealth = await cacheService.healthCheck();

  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      service: 'soroban-playground-backend',
      timestamp: new Date().toISOString(),
      runtime: {
        node: process.version,
        platform: process.platform,
      },
      cache: cacheHealth,
    },
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}

export default app;
