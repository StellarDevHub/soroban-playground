import express from "express";
import cors from "cors";
import { initializeDatabase } from "./database/connection.js";
import compileRoute from "./routes/compile.js";
import deployRoute from "./routes/deploy.js";
import invokeRoute from "./routes/invoke.js";
import searchRoute from "./routes/search.js";
import cacheService from "./services/cacheService.js";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize database and cache on startup
async function initializeServices() {
  try {
    await initializeDatabase();
    console.log('Database initialized successfully');
    
    await cacheService.initialize();
    console.log('Cache service initialized');
  } catch (error) {
    console.error('Service initialization error:', error);
  }
}

// Routes
app.use("/api/compile", compileRoute);
app.use("/api/deploy", deployRoute);
app.use("/api/invoke", invokeRoute);
app.use("/api/search", searchRoute);

// Enhanced health check
app.get("/api/health", async (req, res) => {
  const cacheHealth = await cacheService.healthCheck();
  
  res.json({
    status: "ok",
    message: "Soroban Playground API is running",
    timestamp: new Date().toISOString(),
    service: "soroban-playground-backend",
    services: {
      database: "connected",
      cache: cacheHealth.status
    }
  });
});

// Search-specific health check
app.get("/api/search/health", async (req, res) => {
  const cacheHealth = await cacheService.healthCheck();
  
  res.json({
    success: cacheHealth.status === 'connected',
    status: cacheHealth.status,
    timestamp: new Date().toISOString(),
    service: "search-service"
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  await initializeServices();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await cacheService.close();
  process.exit(0);
});
