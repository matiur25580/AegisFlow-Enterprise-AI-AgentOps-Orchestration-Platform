import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (res.headersSent) return;
  const requestId = res.locals.requestId as string | undefined;

  if (error instanceof ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Request validation failed.", details: error.flatten().fieldErrors },
      requestId
    });
    return;
  }

  if (typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === 11000) {
    res.status(409).json({ error: { code: "RESOURCE_CONFLICT", message: "A resource with the same unique value already exists." }, requestId });
    return;
  }

  logger.error({ err: error, requestId, method: req.method, path: req.path }, "Unhandled request error");
  const status = typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode: unknown }).statusCode) : 500;

  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: env.NODE_ENV === "production" ? "An unexpected error occurred." : error instanceof Error ? error.message : "Unknown error"
    },
    requestId
  });
};
