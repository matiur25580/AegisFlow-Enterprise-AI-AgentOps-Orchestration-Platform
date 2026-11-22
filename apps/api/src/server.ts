import { app } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { startExecutionWorker, stopExecutionWorker } from "./execution/worker.js";

async function bootstrap(): Promise<void> {
  await connectDatabase();
  startExecutionWorker();
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, "AegisFlow API listening"));

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Graceful shutdown started");
    stopExecutionWorker();
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, "API bootstrap failed");
  process.exit(1);
});
