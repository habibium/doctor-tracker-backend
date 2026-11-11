import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/auth/auth.ts";
import { env } from "../src/config/env.ts";
import { parseSeedAccounts, seedAccounts } from "../src/db/seed-accounts.ts";
import { User } from "../src/modules/users/user.model.ts";
import { deleteUser, updateUser } from "../src/modules/users/user.service.ts";
import { PASSWORD, startTestApp, type TestApp } from "./helpers.ts";

const NEW_PASSWORD = "Another-pass-42";

let ctx: TestApp;
let adminId: string;
let sequence = 0;

beforeAll(async () => {
  ctx = await startTestApp();
  const session = await ctx.admin.get("/api/auth/get-session").expect(200);
  adminId = session.body.user.id;
});

afterAll(async () => {
  await ctx.stop();
});

interface UserBody {
  id: string;
  name: string;
  email: string;
  role: "admin" | "viewer";
  status: "active" | "deactivated";
  deactivatedAt: string | null;
}

async function addUser(overrides: Record<string, unknown> = {}): Promise<UserBody> {
  sequence += 1;
  const res = await ctx.admin
    .post("/api/v1/users")
    .send({
      name: "Rafiq Islam",
      email: `user${sequence}@test.dev`,
      role: "viewer",
      password: PASSWORD,
      ...overrides,
    })
    .expect(201);
  return res.body;
}

const signInAttempt = (email: string, password = PASSWORD) =>
  request(ctx.app)
    .post("/api/auth/sign-in/email")
    .set("Origin", env.WEB_ORIGIN)
    .send({ email, password });

const asActor = (user: UserBody): AuthUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
});

describe("access", () => {
  it("rejects requests without a session", async () => {
    const res = await request(ctx.app).get("/api/v1/users").expect(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("refuses viewers every users endpoint", async () => {
    const attempts = [
      ctx.viewer.get("/api/v1/users"),
      ctx.viewer.post("/api/v1/users").send({ name: "X Y", email: "x@y.dev", role: "admin" }),
      ctx.viewer.patch(`/api/v1/users/${adminId}`).send({ role: "viewer" }),
      ctx.viewer.post(`/api/v1/users/${adminId}/password`).send({ password: NEW_PASSWORD }),
      ctx.viewer.delete(`/api/v1/users/${adminId}`),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("has no public sign-up", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/sign-up/email")
      .set("Origin", env.WEB_ORIGIN)
      .send({ name: "Mallory", email: "mallory@test.dev", password: PASSWORD });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await User.exists({ email: "mallory@test.dev" })).toBeNull();
  });

  it("documents the users endpoints", async () => {
    const res = await request(ctx.app).get("/openapi.json").expect(200);
    expect(res.body.paths["/api/v1/users"].get.operationId).toBe("listUsers");
    expect(res.body.paths["/api/v1/users/{id}/password"].post.operationId).toBe(
      "resetUserPassword",
    );
  });
});

describe("creating users", () => {
  it("creates a user who can sign in with the initial password", async () => {
    const created = await addUser({ name: "  Nusrat Jahan ", email: "Nusrat.Jahan@Clinic.dev" });
    expect(created).toMatchObject({
      name: "Nusrat Jahan",
      email: "nusrat.jahan@clinic.dev",
      role: "viewer",
      status: "active",
      deactivatedAt: null,
    });
    expect(created).not.toHaveProperty("password");
    await signInAttempt("nusrat.jahan@clinic.dev").expect(200);
  });

  it("rejects a duplicate email, in any case, with 409 on the email field", async () => {
    const res = await ctx.admin
      .post("/api/v1/users")
      .send({ name: "Copy", email: "NUSRAT.JAHAN@clinic.dev", role: "viewer", password: PASSWORD })
      .expect(409);
    expect(res.body.error.details).toEqual([{ path: "body.email", message: "Already in use" }]);
  });

  it("lets only one of two simultaneous creates with the same email through", async () => {
    const body = { name: "Twin", email: "twin@test.dev", role: "viewer", password: PASSWORD };
    const results = await Promise.all([
      ctx.admin.post("/api/v1/users").send(body),
      ctx.admin.post("/api/v1/users").send(body),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await User.countDocuments({ email: "twin@test.dev" })).toBe(1);
  });

  it("applies the password policy and validates every field", async () => {
    const res = await ctx.admin
      .post("/api/v1/users")
      .send({ name: "A", email: "nope", role: "owner", password: "short-11ch" })
      .expect(400);
    expect(res.body.error.details.map((detail: { path: string }) => detail.path).sort()).toEqual([
      "body.email",
      "body.name",
      "body.password",
      "body.role",
    ]);
  });
});

describe("listing users", () => {
  beforeAll(async () => {
    await addUser({ name: "Tanvir Hossain", email: "tanvir@ward.dev", role: "admin" });
    const sadia = await addUser({ name: "Sadia Karim", email: "s.karim@ward.dev" });
    await ctx.admin.patch(`/api/v1/users/${sadia.id}`).send({ status: "deactivated" }).expect(200);
  });

  it("searches the start of words in names and emails", async () => {
    const byName = await ctx.admin.get("/api/v1/users?search=tan%20hoss").expect(200);
    expect(byName.body.data.map((user: UserBody) => user.name)).toEqual(["Tanvir Hossain"]);

    const byEmail = await ctx.admin.get("/api/v1/users?search=karim%20ward").expect(200);
    expect(byEmail.body.data.map((user: UserBody) => user.name)).toEqual(["Sadia Karim"]);

    const midWord = await ctx.admin.get("/api/v1/users?search=nvir").expect(200);
    expect(midWord.body.meta.total).toBe(0);
  });

  it("filters by role and status", async () => {
    const admins = await ctx.admin.get("/api/v1/users?role=admin&limit=100").expect(200);
    expect(admins.body.data.every((user: UserBody) => user.role === "admin")).toBe(true);
    expect(admins.body.data.map((user: UserBody) => user.name)).toContain("Tanvir Hossain");

    const deactivated = await ctx.admin.get("/api/v1/users?status=deactivated").expect(200);
    expect(deactivated.body.data).toEqual([
      expect.objectContaining({ name: "Sadia Karim", status: "deactivated" }),
    ]);
    expect(deactivated.body.data[0].deactivatedAt).toEqual(expect.any(String));

    const active = await ctx.admin.get("/api/v1/users?status=active&limit=100").expect(200);
    expect(active.body.meta.total).toBe((await User.countDocuments()) - 1);
  });

  it("sorts and paginates", async () => {
    const all = await ctx.admin.get("/api/v1/users?sort=name&limit=100").expect(200);
    const names = all.body.data.map((user: UserBody) => user.name);
    expect(names).toEqual([...names].sort());

    const reversed = await ctx.admin.get("/api/v1/users?sort=-name&limit=100").expect(200);
    expect(reversed.body.data.map((user: UserBody) => user.name)).toEqual([...names].reverse());

    const second = await ctx.admin.get("/api/v1/users?sort=name&limit=1&page=2").expect(200);
    expect(second.body.meta).toMatchObject({ page: 2, limit: 1, total: names.length });
    expect(second.body.data[0].name).toBe(names[1]);
  });

  it("rejects unknown filter values", async () => {
    await ctx.admin.get("/api/v1/users?role=owner").expect(400);
    await ctx.admin.get("/api/v1/users?status=banned").expect(400);
    await ctx.admin.get("/api/v1/users?sort=password").expect(400);
  });
});

describe("updating users", () => {
  it("renames a user", async () => {
    const user = await addUser();
    const res = await ctx.admin
      .patch(`/api/v1/users/${user.id}`)
      .send({ name: "Rafiq Uddin" })
      .expect(200);
    expect(res.body).toMatchObject({ name: "Rafiq Uddin", role: "viewer", status: "active" });
  });

  it("ends a user's sessions when their role changes", async () => {
    const user = await addUser();
    const session = await ctx.signIn(user.email);
    await session.get("/api/v1/doctors").expect(200);

    await ctx.admin.patch(`/api/v1/users/${user.id}`).send({ role: "admin" }).expect(200);
    await session.get("/api/v1/doctors").expect(401);

    const fresh = await ctx.signIn(user.email);
    await fresh.get("/api/v1/users").expect(200);
  });

  it("blocks a deactivated user at once and explains why at sign-in", async () => {
    const user = await addUser();
    const session = await ctx.signIn(user.email);

    const res = await ctx.admin
      .patch(`/api/v1/users/${user.id}`)
      .send({ status: "deactivated" })
      .expect(200);
    expect(res.body).toMatchObject({ status: "deactivated", deactivatedAt: expect.any(String) });

    await session.get("/api/v1/doctors").expect(401);
    await session.get("/api/auth/get-session").expect(200, "null");

    const refused = await signInAttempt(user.email).expect(403);
    expect(refused.body.code).toBe("ACCOUNT_DEACTIVATED");
    // The wrong password gets the usual answer, so the status is no hint to a stranger.
    await signInAttempt(user.email, NEW_PASSWORD).expect(401);

    await ctx.admin.patch(`/api/v1/users/${user.id}`).send({ status: "active" }).expect(200);
    await signInAttempt(user.email).expect(200);
  });

  it("keeps an admin from changing their own role or deactivating themselves", async () => {
    const demote = await ctx.admin
      .patch(`/api/v1/users/${adminId}`)
      .send({ role: "viewer" })
      .expect(403);
    expect(demote.body.error.code).toBe("OWN_ACCOUNT");

    const deactivate = await ctx.admin
      .patch(`/api/v1/users/${adminId}`)
      .send({ status: "deactivated" })
      .expect(403);
    expect(deactivate.body.error.code).toBe("OWN_ACCOUNT");

    const rename = await ctx.admin
      .patch(`/api/v1/users/${adminId}`)
      .send({ name: "Head Admin", role: "admin", status: "active" })
      .expect(200);
    expect(rename.body).toMatchObject({ name: "Head Admin", role: "admin", status: "active" });
    await ctx.admin.get("/api/v1/users").expect(200);
  });

  it("rejects an empty change and an unknown user", async () => {
    const user = await addUser();
    await ctx.admin.patch(`/api/v1/users/${user.id}`).send({}).expect(400);
    await ctx.admin
      .patch("/api/v1/users/0123456789abcdef01234567")
      .send({ name: "Nobody" })
      .expect(404);
  });
});

describe("resetting a password", () => {
  it("replaces the password and ends the user's sessions", async () => {
    const user = await addUser();
    const session = await ctx.signIn(user.email);

    await ctx.admin
      .post(`/api/v1/users/${user.id}/password`)
      .send({ password: NEW_PASSWORD })
      .expect(204);

    await session.get("/api/v1/doctors").expect(401);
    await signInAttempt(user.email).expect(401);
    await signInAttempt(user.email, NEW_PASSWORD).expect(200);
  });

  it("applies the password policy, and refuses your own account", async () => {
    const user = await addUser();
    const short = await ctx.admin
      .post(`/api/v1/users/${user.id}/password`)
      .send({ password: "eleven-char" })
      .expect(400);
    expect(short.body.error.details[0].path).toBe("body.password");

    const own = await ctx.admin
      .post(`/api/v1/users/${adminId}/password`)
      .send({ password: NEW_PASSWORD })
      .expect(403);
    expect(own.body.error.code).toBe("OWN_ACCOUNT");

    await ctx.admin
      .post("/api/v1/users/0123456789abcdef01234567/password")
      .send({ password: NEW_PASSWORD })
      .expect(404);
  });
});

describe("deleting users", () => {
  it("removes the user, their sign-in and their sessions", async () => {
    const user = await addUser();
    const session = await ctx.signIn(user.email);

    await ctx.admin.delete(`/api/v1/users/${user.id}`).expect(204);

    await session.get("/api/v1/doctors").expect(401);
    await signInAttempt(user.email).expect(401);
    await ctx.admin.delete(`/api/v1/users/${user.id}`).expect(404);
  });

  it("refuses to delete your own account", async () => {
    const res = await ctx.admin.delete(`/api/v1/users/${adminId}`).expect(403);
    expect(res.body.error.code).toBe("OWN_ACCOUNT");
  });
});

describe("the last active admin", () => {
  const isActiveAdmin = async (id: string) =>
    Boolean(await User.exists({ _id: id, role: "admin", deactivatedAt: null }));

  // Both requests start before either commits, so only the transaction can stop the second.
  it.each([
    [
      "demote",
      (actor: UserBody, target: UserBody) =>
        updateUser(ctx.auth, asActor(actor), target.id, { role: "viewer" }),
    ],
    [
      "deactivate",
      (actor: UserBody, target: UserBody) =>
        updateUser(ctx.auth, asActor(actor), target.id, { status: "deactivated" }),
    ],
    [
      "delete",
      (actor: UserBody, target: UserBody) => deleteUser(ctx.auth, asActor(actor), target.id),
    ],
  ])("survives two admins trying to %s each other at once", async (_, remove) => {
    const first = await addUser({ role: "admin" });
    const second = await addUser({ role: "admin" });

    const results = await Promise.allSettled([remove(first, second), remove(second, first)]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ status: 403, code: "FORBIDDEN" });
    const remaining = await Promise.all([isActiveAdmin(first.id), isActiveAdmin(second.id)]);
    expect(remaining.filter(Boolean)).toHaveLength(1);
  });

  it("holds over HTTP too, where the loser may already be signed out", async () => {
    const first = await addUser({ role: "admin" });
    const second = await addUser({ role: "admin" });
    const [firstSession, secondSession] = await Promise.all([
      ctx.signIn(first.email),
      ctx.signIn(second.email),
    ]);

    const results = await Promise.all([
      firstSession.patch(`/api/v1/users/${second.id}`).send({ role: "viewer" }),
      secondSession.patch(`/api/v1/users/${first.id}`).send({ role: "viewer" }),
    ]);

    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    expect(results.find((res) => res.status !== 200)?.status).toBeOneOf([401, 403]);
    const remaining = await Promise.all([isActiveAdmin(first.id), isActiveAdmin(second.id)]);
    expect(remaining.filter(Boolean)).toHaveLength(1);
  });

  it("leaves a sole admin unable to remove themselves by any route", async () => {
    const results = await Promise.all([
      ctx.admin.patch(`/api/v1/users/${adminId}`).send({ role: "viewer" }),
      ctx.admin.patch(`/api/v1/users/${adminId}`).send({ status: "deactivated" }),
      ctx.admin.delete(`/api/v1/users/${adminId}`),
    ]);
    expect(results.map((res) => res.status)).toEqual([403, 403, 403]);
    expect(await isActiveAdmin(adminId)).toBe(true);
  });
});

describe("changing your own password", () => {
  it("needs the current password, follows the policy and signs out other devices", async () => {
    const user = await addUser();
    const [here, elsewhere] = await Promise.all([ctx.signIn(user.email), ctx.signIn(user.email)]);
    const change = (body: Record<string, unknown>) =>
      here.post("/api/auth/change-password").set("Origin", env.WEB_ORIGIN).send(body);

    const wrong = await change({ currentPassword: NEW_PASSWORD, newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("INVALID_PASSWORD");

    const short = await change({ currentPassword: PASSWORD, newPassword: "eleven-char" });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe("PASSWORD_TOO_SHORT");

    // Asking to keep other sessions is overridden.
    await change({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: false,
    }).expect(200);

    await here.get("/api/v1/doctors").expect(200);
    await elsewhere.get("/api/v1/doctors").expect(401);
    await signInAttempt(user.email).expect(401);
    await signInAttempt(user.email, NEW_PASSWORD).expect(200);
  });
});

describe("seed accounts", () => {
  it("has no defaults and seeds only complete pairs", () => {
    expect(parseSeedAccounts({})).toEqual({ accounts: [], errors: [] });
    expect(parseSeedAccounts({ SEED_ADMIN_EMAIL: "", SEED_ADMIN_PASSWORD: "" })).toEqual({
      accounts: [],
      errors: [],
    });

    const { accounts } = parseSeedAccounts({
      SEED_ADMIN_EMAIL: " Owner@Clinic.dev ",
      SEED_ADMIN_PASSWORD: NEW_PASSWORD,
    });
    expect(accounts).toEqual([
      { role: "admin", name: "Nadia Rahman", email: "owner@clinic.dev", password: NEW_PASSWORD },
    ]);
  });

  it("reports half-set and invalid values by variable name", () => {
    const { accounts, errors } = parseSeedAccounts({
      SEED_ADMIN_EMAIL: "owner@clinic.dev",
      SEED_VIEWER_EMAIL: "not-an-email",
      SEED_VIEWER_PASSWORD: "short",
    });
    expect(accounts).toEqual([]);
    expect(errors).toEqual([
      "Set both SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD, or neither.",
      "SEED_VIEWER_EMAIL is not a valid email address.",
      "SEED_VIEWER_PASSWORD: Must be at least 12 characters.",
    ]);
  });

  it("brings an existing account back to the configured role and password", async () => {
    const user = await addUser({ email: "rotated@test.dev" });
    const session = await ctx.signIn(user.email);
    await ctx.admin.patch(`/api/v1/users/${user.id}`).send({ status: "deactivated" }).expect(200);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await seedAccounts(ctx.auth, [
      { role: "admin", name: "Rotated Admin", email: user.email, password: NEW_PASSWORD },
    ]);

    log.mockRestore();
    await session.get("/api/v1/doctors").expect(401);
    await signInAttempt(user.email).expect(401);
    const fresh = await ctx.signIn(user.email, NEW_PASSWORD);
    await fresh.get("/api/v1/users").expect(200);
  });
});
