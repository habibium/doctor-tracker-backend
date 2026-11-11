import { apiReference } from "@scalar/express-api-reference";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { pinoHttp } from "pino-http";
import type { Auth } from "./auth/auth.ts";
import { requireAuth } from "./auth/middleware.ts";
import { env, webOrigins } from "./config/env.ts";
import { logger } from "./lib/logger.ts";
import { mountRoutes } from "./lib/route.ts";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.ts";
import { buildOpenApiDocument } from "./openapi/document.ts";
import { API_PREFIX, routes } from "./routes.ts";

export function createApp(auth: Auth) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/health" },
      // Log the request line only: headers carry session cookies.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(cors({ origin: webOrigins, credentials: true }));

  const openApiDocument = buildOpenApiDocument(routes);
  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });
  // Mounted before helmet: Scalar loads its bundle from a CDN, which the default CSP blocks.
  app.use(
    "/docs",
    apiReference({
      pageTitle: "Doctor Tracker API",
      sources: [
        { title: "Doctor Tracker API", slug: "api", url: "/openapi.json" },
        { title: "Authentication", slug: "auth", url: "/api/auth/open-api/generate-schema" },
      ],
    }),
  );

  app.use(helmet());

  app.get("/health", (_req, res) => {
    const databaseUp = mongoose.connection.readyState === mongoose.ConnectionStates.connected;
    res.status(databaseUp ? 200 : 503).json({
      status: databaseUp ? "ok" : "degraded",
      uptime: Math.round(process.uptime()),
    });
  });

  // better-auth reads the raw request stream, so it must come before express.json().
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json({ limit: "100kb" }));

  const api = express.Router();
  api.use(requireAuth(auth));
  mountRoutes(api, routes, auth);
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
