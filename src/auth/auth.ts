import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { betterAuth } from "better-auth";
import { openAPI } from "better-auth/plugins";
import type { MongoClient } from "mongodb";
import { env, isProduction } from "../config/env.ts";

export const ROLES = ["admin", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

interface AuthOptions {
  /** Only the seed script enables this; the portal has no public registration. */
  allowSignUp?: boolean;
}

export function createAuth(client: MongoClient, options: AuthOptions = {}) {
  return betterAuth({
    appName: "Doctor Tracker",
    // The browser reaches auth through the Next.js proxy, so cookies belong to the web origin.
    baseURL: env.WEB_ORIGIN,
    trustedOrigins: [env.WEB_ORIGIN, env.API_URL],
    secret: env.BETTER_AUTH_SECRET,
    database: mongodbAdapter(client.db(), { client }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.allowSignUp,
      minPasswordLength: 8,
    },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "viewer" satisfies Role, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Signed cookie copy of the session: most requests skip the session lookup.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: { enabled: isProduction },
    plugins: [openAPI()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
