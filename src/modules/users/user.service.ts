import { runWithTransaction } from "@better-auth/core/context";
import type { Auth, AuthUser, Role } from "../../auth/auth.ts";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors.ts";
import { countMatching, dateRange, page, sortSpec } from "../../lib/query.ts";
import { wordStartFilter } from "../../lib/search.ts";
import { User, USER_SORTS } from "./user.model.ts";
import type { CreateUserBody, ListUsersQuery, UpdateUserBody, UserDto } from "./user.schema.ts";

type AuthContext = Awaited<Auth["$context"]>;

/** better-auth's user record with this app's additional fields. */
interface StoredUser {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  deactivatedAt?: Date | null;
  createdAt: Date;
}

const asRole = (role: unknown): Role => (role === "admin" ? "admin" : "viewer");
const isActiveAdmin = (user: StoredUser) => user.role === "admin" && !user.deactivatedAt;

function toDto(user: StoredUser): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: asRole(user.role),
    status: user.deactivatedAt ? "deactivated" : "active",
    deactivatedAt: user.deactivatedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

const emailTaken = () =>
  conflict("A user with this email already exists", [
    { path: "body.email", message: "Already in use" },
  ]);

/** Changes an admin may make to others but not to their own account. */
const ownAccount = (message: string) => new AppError(403, "OWN_ACCOUNT", message);

async function findUser(ctx: AuthContext, id: string) {
  const user = (await ctx.internalAdapter.findUserById(id)) as StoredUser | null;
  if (!user) throw notFound("User");
  return user;
}

/**
 * Only another active admin can remove an admin. Writing the actor's record makes two admins
 * removing each other conflict; MongoDB retries the later one, which then fails this check.
 */
async function lockActingAdmin(ctx: AuthContext, actorId: string) {
  const actor = (await ctx.internalAdapter.findUserById(actorId)) as StoredUser | null;
  if (!actor || !isActiveAdmin(actor)) throw forbidden();
  await ctx.internalAdapter.updateUser(actorId, { updatedAt: new Date() });
}

export async function listUsers(query: ListUsersQuery) {
  const createdAt = dateRange(query.from, query.to);
  const filter = {
    ...wordStartFilter(query.search, ["name", "email"]),
    ...(query.role && { role: query.role }),
    ...(query.status === "active" && { deactivatedAt: null }),
    ...(query.status === "deactivated" && { deactivatedAt: { $ne: null } }),
    ...(createdAt && { createdAt }),
  };

  const [docs, total] = await Promise.all([
    User.find(filter)
      .sort(sortSpec(USER_SORTS, query.sort))
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    countMatching(User, filter),
  ]);

  return page(
    docs.map((doc) => toDto({ ...doc, id: String(doc._id) })),
    total,
    query,
  );
}

export async function createUser(auth: Auth, body: CreateUserBody) {
  const ctx = await auth.$context;
  const email = body.email.toLowerCase();
  if (await ctx.internalAdapter.findUserByEmail(email)) throw emailTaken();

  // Hashed before the transaction: scrypt is deliberately slow.
  const hash = await ctx.password.hash(body.password);
  // A concurrent create with the same email fails on the unique index and becomes a 409.
  const user = await runWithTransaction(ctx.adapter, async () => {
    const created = await ctx.internalAdapter.createUser(
      { name: body.name, email, emailVerified: false, role: body.role },
      { method: "admin" },
    );
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: hash,
    });
    return created as StoredUser;
  });
  return toDto(user);
}

export async function updateUser(auth: Auth, actor: AuthUser, id: string, changes: UpdateUserBody) {
  if (id === actor.id) {
    if (changes.role && changes.role !== actor.role) {
      throw ownAccount("You can't change your own role. Another admin can.");
    }
    if (changes.status === "deactivated") {
      throw ownAccount("You can't deactivate your own account.");
    }
  }

  const ctx = await auth.$context;
  return runWithTransaction(ctx.adapter, async () => {
    const target = await findUser(ctx, id);
    const roleChanges = changes.role !== undefined && changes.role !== asRole(target.role);
    const deactivates = changes.status === "deactivated" && !target.deactivatedAt;
    const reactivates = changes.status === "active" && Boolean(target.deactivatedAt);

    if (isActiveAdmin(target) && ((roleChanges && changes.role !== "admin") || deactivates)) {
      await lockActingAdmin(ctx, actor.id);
    }

    const data = {
      ...(changes.name !== undefined && { name: changes.name }),
      ...(roleChanges && { role: changes.role }),
      ...(deactivates && { deactivatedAt: new Date() }),
      ...(reactivates && { deactivatedAt: null }),
    };
    const updated =
      Object.keys(data).length > 0
        ? ((await ctx.internalAdapter.updateUser(id, data)) as StoredUser)
        : target;

    // The API reads the role per request; signing out also resets pages built for the old one.
    if (roleChanges || deactivates) await ctx.internalAdapter.deleteUserSessions(id);
    return toDto(updated);
  });
}

/** Replaces a user's password and ends their sessions. */
export async function setUserPassword(auth: Auth, id: string, password: string) {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  await runWithTransaction(ctx.adapter, async () => {
    await findUser(ctx, id);
    if (await ctx.internalAdapter.findCredentialAccount(id)) {
      await ctx.internalAdapter.updatePassword(id, hash);
    } else {
      await ctx.internalAdapter.createAccount({
        userId: id,
        providerId: "credential",
        accountId: id,
        password: hash,
      });
    }
    await ctx.internalAdapter.deleteUserSessions(id);
  });
}

/** Without the current password, so not for your own account: that is a change, not a reset. */
export async function resetPassword(auth: Auth, actor: AuthUser, id: string, password: string) {
  if (id === actor.id) throw ownAccount("Change your own password from your account menu.");
  await setUserPassword(auth, id, password);
}

export async function deleteUser(auth: Auth, actor: AuthUser, id: string) {
  if (id === actor.id) throw ownAccount("You can't delete your own account.");

  const ctx = await auth.$context;
  await runWithTransaction(ctx.adapter, async () => {
    const target = await findUser(ctx, id);
    if (isActiveAdmin(target)) await lockActingAdmin(ctx, actor.id);
    // Removes the user's sessions and accounts too.
    await ctx.internalAdapter.deleteUser(id);
  });
}
