import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token", "*.secret"],
    censor: "[REDACTED]"
  },
  base: { service: "aegisflow-api", environment: env.NODE_ENV }
});
