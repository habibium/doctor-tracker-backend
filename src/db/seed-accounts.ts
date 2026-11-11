import { runWithTransaction } from "@better-auth/core/context";
import * as z from "zod";
import { type Auth, ROLES, type Role } from "../auth/auth.ts";
import { User } from "../modules/users/user.model.ts";
import { password as passwordRule } from "../modules/users/user.schema.ts";
import { createUser, setUserPassword } from "../modules/users/user.service.ts";
import { disconnectDatabase, ensureAuthIndexes } from "./connection.ts";

export interface SeedAccount {
  role: Role;
  name: string;
  email: string;
  password: string;
}

const DEFAULT_NAMES: Record<Role, string> = { admin: "Nadia Rahman", viewer: "Tareq Hasan" };

/**
 * Reads `SEED_ADMIN_*` and `SEED_VIEWER_*`. Nothing has a default: an account is seeded
 * only when both its email and password are set, and setting just one is an error.
 */
export function parseSeedAccounts(source: Record<string, string | undefined>) {
  const accounts: SeedAccount[] = [];
  const errors: string[] = [];

  for (const role of ROLES) {
    const prefix = `SEED_${role.toUpperCase()}`;
    const email = source[`${prefix}_EMAIL`]?.trim().toLowerCase() || undefined;
    const password = source[`${prefix}_PASSWORD`] || undefined;
    if (!email && !password) continue;
    if (!email || !password) {
      errors.push(`Set both ${prefix}_EMAIL and ${prefix}_PASSWORD, or neither.`);
      continue;
    }

    const emailCheck = z.email().safeParse(email);
    const passwordCheck = passwordRule.safeParse(password);
    if (!emailCheck.success) errors.push(`${prefix}_EMAIL is not a valid email address.`);
    if (!passwordCheck.success) {
      errors.push(`${prefix}_PASSWORD: ${passwordCheck.error.issues[0]?.message}.`);
    }
    if (emailCheck.success && passwordCheck.success) {
      const name = source[`${prefix}_NAME`]?.trim() || DEFAULT_NAMES[role];
      accounts.push({ role, name, email, password });
    }
  }
  return { accounts, errors };
}

/** Fails before anything is written, so a typo never leaves half-seeded data behind. */
export function readSeedAccounts() {
  const { accounts, errors } = parseSeedAccounts(process.env);
  if (errors.length > 0) {
    console.error(`Seed accounts are misconfigured:\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }
  return accounts;
}

/**
 * Creates each account, or brings an existing one back to the configured name, role and
 * password. With no admin configured, an active admin must already exist, or nobody
 * could sign in to the seeded data.
 */
export async function seedAccounts(auth: Auth, accounts: SeedAccount[]) {
  await ensureAuthIndexes();
  console.log("Accounts");
  if (!accounts.some((account) => account.role === "admin")) {
    const admins = await User.countDocuments({ role: "admin", deactivatedAt: null });
    if (admins === 0) {
      console.error(
        "  No admin account exists yet. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env, then run pnpm seed again.",
      );
      await disconnectDatabase();
      process.exit(1);
    }
    console.log(`  SEED_ADMIN_* not set; keeping the ${admins} existing admin account(s).`);
  }

  for (const account of accounts) {
    const outcome = await ensureAccount(auth, account);
    console.log(`  ${account.role.padEnd(6)} ${account.email} (${outcome})`);
  }
}

async function ensureAccount(auth: Auth, account: SeedAccount) {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(account.email, { includeAccounts: true });
  if (!found) {
    await createUser(auth, account);
    return "created";
  }

  const { user, accounts } = found;
  const stored = accounts.find((item) => item.providerId === "credential")?.password;
  const passwordMatches = stored
    ? await ctx.password.verify({ hash: stored, password: account.password })
    : false;

  await runWithTransaction(ctx.adapter, async () => {
    await ctx.internalAdapter.updateUser(user.id, {
      name: account.name,
      role: account.role,
      deactivatedAt: null,
    });
    if ("role" in user && user.role !== account.role) {
      await ctx.internalAdapter.deleteUserSessions(user.id);
    }
  });
  if (passwordMatches) return "unchanged password";
  await setUserPassword(auth, user.id, account.password);
  return "password replaced";
}
