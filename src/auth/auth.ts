import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { openAPI } from "better-auth/plugins";
import type { MongoClient } from "mongodb";
import { env, isProduction, webOrigins } from "../config/env.ts";

export const ROLES = ["admin", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** The one rule for every way a password is set: seed, create, reset and change. */
export const PASSWORD_LENGTH = { min: 12, max: 128 } as const;

export const ACCOUNT_DEACTIVATED = {
  code: "ACCOUNT_DEACTIVATED",
  message: "This account has been deactivated. Ask an administrator to restore access.",
} as const;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function createAuth(client: MongoClient) {
  return betterAuth({
    appName: "Doctor Tracker",
    // The browser reaches auth through the Next.js proxy, so cookies belong to the web origin.
    baseURL: env.WEB_ORIGIN,
    trustedOrigins: [...webOrigins, env.API_URL],
    secret: env.BETTER_AUTH_SECRET,
    database: mongodbAdapter(client.db(), { client }),
    // No public sign-up: admins create accounts through /api/v1/users.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_LENGTH.min,
      maxPasswordLength: PASSWORD_LENGTH.max,
    },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "viewer" satisfies Role, input: false },
        deactivatedAt: { type: "date", required: false, input: false },
      },
    },
    // No cookie cache: every request reads its session from MongoDB, so a revoked session
    // or a changed role takes effect on the next request rather than minutes later.
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    databaseHooks: {
      session: {
        create: {
          // Runs after the password check, so only the account's owner learns it is deactivated.
          async before(session, ctx) {
            const user = await ctx?.context.internalAdapter.findUserById(session.userId);
            if (user && "deactivatedAt" in user && user.deactivatedAt) {
              throw new APIError("FORBIDDEN", ACCOUNT_DEACTIVATED);
            }
          },
        },
      },
    },
    hooks: {
      // A password change signs out every other device, whatever the client asked for.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/change-password") return;
        return { context: { body: { ...ctx.body, revokeOtherSessions: true } } };
      }),
    },
    rateLimit: { enabled: isProduction },
    plugins: [openAPI()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
