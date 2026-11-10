import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";
import { env } from "./config/env.ts";
import { connectDatabase, disconnectDatabase, ensureIndexes } from "./db/connection.ts";
import { logger } from "./lib/logger.ts";

const connection = await connectDatabase(env.MONGODB_URI);
await ensureIndexes();

const app = createApp(createAuth(connection.getClient()));
const server = app.listen(env.PORT, () => {
  logger.info(`API listening on ${env.API_URL} (docs at ${env.API_URL}/docs)`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
  // Open keep-alive connections can stall close(); do not hang the deploy.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
