import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The first run downloads a MongoDB binary for the in-memory replica set.
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://replaced-by-the-in-memory-server",
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
      WEB_ORIGIN: "http://localhost:3000",
      API_URL: "http://localhost:4000",
    },
  },
});
