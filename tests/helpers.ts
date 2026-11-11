import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../src/app.ts";
import { createAuth, type Role } from "../src/auth/auth.ts";
import { env } from "../src/config/env.ts";
import { connectDatabase, disconnectDatabase, ensureIndexes } from "../src/db/connection.ts";

const PASSWORD = "Password@123";

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

export const docsExamined = (explain: unknown) =>
  (explain as { executionStats: { totalDocsExamined: number } }).executionStats.totalDocsExamined;

export async function startTestApp() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const connection = await connectDatabase(mongo.getUri("doctor-tracker-test"));
  await ensureIndexes();

  const client = connection.getClient();
  const auth = createAuth(client, { allowSignUp: true });
  const app = createApp(auth);

  /** A supertest agent that carries the session cookie of a user with the given role. */
  async function signInAs(role: Role) {
    const email = `${role}@test.dev`;
    await auth.api.signUpEmail({ body: { name: role, email, password: PASSWORD } });
    await client.db().collection("user").updateOne({ email }, { $set: { role } });

    const agent = request.agent(app);
    await agent
      .post("/api/auth/sign-in/email")
      .set("Origin", env.WEB_ORIGIN)
      .send({ email, password: PASSWORD })
      .expect(200);
    return agent;
  }

  return {
    app,
    admin: await signInAs("admin"),
    viewer: await signInAs("viewer"),
    async stop() {
      await disconnectDatabase();
      await mongo.stop();
    },
  };
}
