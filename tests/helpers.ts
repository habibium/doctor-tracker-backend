import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../src/app.ts";
import { createAuth, type Role } from "../src/auth/auth.ts";
import { env } from "../src/config/env.ts";
import { connectDatabase, disconnectDatabase, ensureIndexes } from "../src/db/connection.ts";
import { createUser } from "../src/modules/users/user.service.ts";

export const PASSWORD = "Password@123";

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;

export const doctorInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Ayesha Rahman",
  specialization: "Cardiology",
  hospital: "Square Hospital",
  phone: "+8801711123456",
  email: "ayesha.rahman@example.com",
  ...overrides,
});

export const patientInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Karim Uddin",
  age: 52,
  gender: "male",
  phone: "01811222333",
  condition: "stable",
  diagnosis: "Hypertension",
  ...overrides,
});

type PlanNode = Record<string, unknown>;

/** Plan stages of a find or aggregate explain, wherever the server nests them; rejected plans are skipped. */
export function planNodes(explain: unknown): PlanNode[] {
  const nodes: PlanNode[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== "object" || value === null) return;
    const node = value as PlanNode;
    if (typeof node.stage === "string") nodes.push(node);
    for (const [key, child] of Object.entries(node)) if (key !== "rejectedPlans") walk(child);
  };
  walk(explain);
  return nodes;
}

export const planStages = (explain: unknown) => planNodes(explain).map((node) => node.stage);

type ExecutionStats = { executionStats?: { totalDocsExamined: number } };

/** Documents read by the query itself; a later $lookup is not pushed down and reports apart. */
export function docsExamined(explain: unknown) {
  const root = explain as ExecutionStats & { stages?: { $cursor?: ExecutionStats }[] };
  return (root.executionStats ?? root.stages?.[0]?.$cursor?.executionStats)?.totalDocsExamined;
}

export async function startTestApp() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const connection = await connectDatabase(mongo.getUri("doctor-tracker-test"));
  await ensureIndexes();

  const auth = createAuth(connection.getClient());
  const app = createApp(auth);

  /** A supertest agent that carries a fresh session cookie for this account. */
  async function signIn(email: string, password = PASSWORD) {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/sign-in/email")
      .set("Origin", env.WEB_ORIGIN)
      .send({ email, password })
      .expect(200);
    return agent;
  }

  async function signInAs(role: Role) {
    const email = `${role}@test.dev`;
    await createUser(auth, { name: role, email, role, password: PASSWORD });
    return signIn(email);
  }

  return {
    app,
    auth,
    signIn,
    admin: await signInAs("admin"),
    viewer: await signInAs("viewer"),
    async stop() {
      await disconnectDatabase();
      await mongo.stop();
    },
  };
}
