import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recountPatients } from "../src/db/maintenance.ts";
import { Doctor } from "../src/modules/doctors/doctor.model.ts";
import { conditionCountsPipeline } from "../src/modules/doctors/doctor.service.ts";
import { Patient } from "../src/modules/patients/patient.model.ts";
import {
  docsExamined,
  doctorInput,
  patientInput,
  planNodes,
  startTestApp,
  type TestApp,
} from "./helpers.ts";

let ctx: TestApp;
let first: string;
let second: string;

async function createDoctor(email: string) {
  const res = await ctx.admin.post("/api/v1/doctors").send(doctorInput({ email })).expect(201);
  return res.body.id as string;
}

async function patientCount(doctorId: string) {
  const res = await ctx.admin.get(`/api/v1/doctors/${doctorId}`).expect(200);
  return res.body.patientCount as number;
}

beforeAll(async () => {
  ctx = await startTestApp();
  first = await createDoctor("first@x.dev");
  second = await createDoctor("second@x.dev");
});

afterAll(async () => {
  await ctx.stop();
});

describe("stored patient counts", () => {
  let patientId: string;

  it("counts patients created through either endpoint", async () => {
    const created = await ctx.admin
      .post("/api/v1/patients")
      .send(patientInput({ doctorId: first }))
      .expect(201);
    patientId = created.body.id;
    await ctx.admin.post(`/api/v1/doctors/${first}/patients`).send(patientInput()).expect(201);

    expect(await patientCount(first)).toBe(2);
    const list = await ctx.admin.get("/api/v1/doctors?search=first").expect(200);
    expect(list.body.data[0].patientCount).toBe(2);
  });

  it("leaves counts and patients untouched when the doctor does not exist", async () => {
    const before = await Patient.countDocuments();
    await ctx.admin
      .post("/api/v1/patients")
      .send(patientInput({ doctorId: "000000000000000000000000" }))
      .expect(404);
    expect(await Patient.countDocuments()).toBe(before);
  });

  it("moves the count with the patient, and only when the doctor changes", async () => {
    await ctx.admin.patch(`/api/v1/patients/${patientId}`).send({ doctorId: first }).expect(200);
    expect(await patientCount(first)).toBe(2);

    await ctx.admin.patch(`/api/v1/patients/${patientId}`).send({ doctorId: second }).expect(200);
    expect([await patientCount(first), await patientCount(second)]).toEqual([1, 1]);

    await ctx.admin
      .patch(`/api/v1/patients/${patientId}`)
      .send({ doctorId: "000000000000000000000000" })
      .expect(404);
    expect([await patientCount(first), await patientCount(second)]).toEqual([1, 1]);
    const unchanged = await ctx.admin.get(`/api/v1/patients/${patientId}`).expect(200);
    expect(unchanged.body.doctor.id).toBe(second);
  });

  it("decrements on delete through either endpoint", async () => {
    await ctx.admin.delete(`/api/v1/doctors/${first}/patients/${patientId}`).expect(404);
    await ctx.admin.delete(`/api/v1/doctors/${second}/patients/${patientId}`).expect(204);
    expect(await patientCount(second)).toBe(0);

    const { body } = await ctx.admin.get(`/api/v1/doctors/${first}/patients`).expect(200);
    await ctx.admin.delete(`/api/v1/patients/${body.data[0].id}`).expect(204);
    await ctx.admin.delete(`/api/v1/patients/${body.data[0].id}`).expect(404);
    expect(await patientCount(first)).toBe(0);
  });

  it("stays exact under a burst of concurrent creates for one doctor", async () => {
    const burst = await createDoctor("burst@x.dev");
    const responses = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        ctx.admin.post(`/api/v1/doctors/${burst}/patients`).send(patientInput({ age: i })),
      ),
    );

    expect(responses.map((res) => res.status)).toEqual(Array(25).fill(201));
    expect(await patientCount(burst)).toBe(25);
    expect(await Patient.countDocuments({ doctor: burst })).toBe(25);
  });

  it("blocks deleting a doctor until the count reaches zero", async () => {
    const doctorId = await createDoctor("busy@x.dev");
    const patient = await ctx.admin
      .post(`/api/v1/doctors/${doctorId}/patients`)
      .send(patientInput())
      .expect(201);

    await ctx.admin.delete(`/api/v1/doctors/${doctorId}`).expect(409);
    await ctx.admin.delete(`/api/v1/patients/${patient.body.id}`).expect(204);
    await ctx.admin.delete(`/api/v1/doctors/${doctorId}`).expect(204);
    await ctx.admin.delete(`/api/v1/doctors/${doctorId}`).expect(404);
  });
});

describe("recount", () => {
  it("repairs drifted counters and leaves correct ones alone", async () => {
    const expected = await Doctor.find().select("patientCount").lean();
    await Doctor.updateOne({ _id: first }, { $set: { patientCount: 7 } });
    await Doctor.updateOne({ email: "burst@x.dev" }, { $set: { patientCount: 3 } });

    expect(await recountPatients()).toEqual({ doctorsCorrected: 2 });
    expect(await Doctor.find().select("patientCount").lean()).toEqual(expected);
    expect(await recountPatients()).toEqual({ doctorsCorrected: 0 });
  });
});

describe("condition counts", () => {
  let doctorId: string;

  beforeAll(async () => {
    doctorId = await createDoctor("conditions@x.dev");
    for (const condition of ["critical", "critical", "stable", "recovering"]) {
      await ctx.admin
        .post(`/api/v1/doctors/${doctorId}/patients`)
        .send(patientInput({ condition }))
        .expect(201);
    }
  });

  it("returns zero-filled counts on the detail and the list", async () => {
    const expected = { stable: 1, recovering: 1, under_observation: 0, critical: 2 };
    const detail = await ctx.admin.get(`/api/v1/doctors/${doctorId}`).expect(200);
    expect(detail.body).toMatchObject({ patientCount: 4, conditionCounts: expected });

    const list = await ctx.admin.get("/api/v1/doctors?sort=-patientCount&limit=100").expect(200);
    const row = list.body.data.find((doctor: { id: string }) => doctor.id === doctorId);
    expect(row.conditionCounts).toEqual(expected);
    const empty = list.body.data.find((doctor: { id: string }) => doctor.id === first);
    expect(empty.conditionCounts).toEqual({
      stable: 0,
      recovering: 0,
      under_observation: 0,
      critical: 0,
    });
  });

  it("is a covered index scan for a page of doctors", async () => {
    const ids = (await Doctor.find().select("_id").lean()).map((doctor) => doctor._id);
    const explained = await Patient.aggregate(conditionCountsPipeline(ids)).explain(
      "executionStats",
    );
    const stages = planNodes(explained).map((node) => node.stage);

    expect(stages).toContain("IXSCAN");
    expect(stages).not.toContain("FETCH");
    expect(stages).not.toContain("SORT");
    expect(planNodes(explained).find((node) => node.stage === "IXSCAN")?.indexName).toBe(
      "doctor_1_conditionRank_1_createdAt_-1__id_-1",
    );
    expect(docsExamined(explained)).toBe(0);
  });
});
