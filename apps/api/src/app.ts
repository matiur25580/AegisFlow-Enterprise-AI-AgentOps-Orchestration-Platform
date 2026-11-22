import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { requestContext } from "./middleware/request-context.js";
import { notFound } from "./middleware/not-found.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRateLimit } from "./middleware/auth-rate-limit.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { workspaceRouter } from "./routes/workspace.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());
app.use(requestContext);
app.use(pinoHttp({ logger }));

app.get("/", (_req, res) => res.json({ name: "AegisFlow API", version: "0.2.0", docs: "See apps/api/README.md." }));
app.use("/health", healthRouter);
app.use(env.API_PREFIX, healthRouter);
app.use(`${env.API_PREFIX}/auth`, authRateLimit, authRouter);
app.use(`${env.API_PREFIX}/workspace`, workspaceRouter);
app.use(notFound);
app.use(errorHandler);
