import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().regex(/^\/[a-zA-Z0-9/_-]+$/).default("/api/v1"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must contain at least 32 characters"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  SECRETS_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional()
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
