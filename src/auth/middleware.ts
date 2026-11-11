import { fromNodeHeaders } from "better-auth/node";
import type { RequestHandler } from "express";
import { unauthenticated } from "../lib/errors.ts";
import { type Auth, type AuthUser, ROLES, type Role } from "./auth.ts";

const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);

export function requireAuth(auth: Auth): RequestHandler {
  return async (req, res, next) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    // Deactivation deletes the sessions too; this also covers a sign-in that raced it.
    if (!session || session.user.deactivatedAt) throw unauthenticated();

    const { id, name, email, role } = session.user;
    res.locals.user = { id, name, email, role: isRole(role) ? role : "viewer" } satisfies AuthUser;
    next();
  };
}
