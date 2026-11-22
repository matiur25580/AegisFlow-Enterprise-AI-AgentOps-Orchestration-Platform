import { Router } from "express";
import mongoose from "mongoose";
import { databaseReady } from "../config/database.js";

export const healthRouter = Router();

healthRouter.get("/live", (_req, res) => {
  res.status(200).json({ status: "ok", service: "aegisflow-api", timestamp: new Date().toISOString() });
});

healthRouter.get("/ready", (_req, res) => {
  const ready = databaseReady();
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    dependencies: { mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected" },
    timestamp: new Date().toISOString()
  });
});
