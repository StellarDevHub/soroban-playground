import express from "express";
import cors from "cors";
import compileRoute from "./routes/compile.js";
import deployRoute from "./routes/deploy.js";
import invokeRoute from "./routes/invoke.js";
import dashboardRoute from "./dashboard/dashboard.routes.js";


const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/compile", compileRoute);
app.use("/api/deploy", deployRoute);
app.use("/api/invoke", invokeRoute);
app.use("/api/dashboard", dashboardRoute);


app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Soroban Playground API is running",
    timestamp: new Date().toISOString(),
    service: "soroban-playground-backend"
  });
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
