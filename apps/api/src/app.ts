import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { requestContext } from "./middleware/request-context.js";
import { notFound } from "./middleware/not-found.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(requestContext);
app.use(pinoHttp({ logger, customProps: (_req, res) => ({ requestId: res.locals.requestId }) }));

app.get("/", (_req, res) => res.json({ name: "AegisFlow API", version: "0.1.0", docs: "API documentation is coming in a later milestone." }));
app.use("/health", healthRouter);
app.use(env.API_PREFIX, healthRouter);
app.use(notFound);
app.use(errorHandler);
