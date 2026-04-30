import express from "express";
import cors from "cors";
import compileRoute from "./routes/compile.js";
import deployRoute from "./routes/deploy.js";
import invokeRoute from "./routes/invoke.js";
import optimizerRoute from "./routes/optimizer.js";
import patentRegistryRoute from "./routes/patentRegistry.js";
import logger from "./utils/logger.js";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/compile", compileRoute);
app.use("/api/deploy", deployRoute);
app.use("/api/invoke", invokeRoute);
app.use("/api/optimizer", optimizerRoute);
app.use("/api/patents", patentRegistryRoute);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Soroban Playground API is running",
    timestamp: new Date().toISOString(),
    service: "soroban-playground-backend"
  });
});

export function startServer() {
  return app.listen(PORT, () => {
    logger.info("Backend server started", {
      port: PORT,
      url: `http://localhost:${PORT}`,
    });
  });
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}

export default app;
