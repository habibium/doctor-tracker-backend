import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fillConditionRanks } from "../src/db/maintenance.ts";
import { sortParams, sortSpec } from "../src/lib/query.ts";
import { Doctor, DOCTOR_SORTS } from "../src/modules/doctors/doctor.model.ts";
import { DOCTOR_SORT_FIELDS } from "../src/modules/doctors/doctor.schema.ts";
import { Patient, PATIENT_SORTS } from "../src/modules/patients/patient.model.ts";
import { PATIENT_SORT_FIELDS } from "../src/modules/patients/patient.schema.ts";
import { doctorInput, patientInput, planStages, startTestApp, type TestApp } from "./helpers.ts";

let ctx: TestApp;
const doctors: Record<string, string> = {};
const patients: Record<string, string> = {};

const names = (body: { data: { name: string }[] }) => body.data.map((item) => item.name);

beforeAll(async () => {
  ctx = await startTestApp();

  // Created in this order, so A is the oldest doctor and D the newest.
  const doctorRows = [
    ["A", "Cardiology", "Square Hospital"],
    ["B", "Neurology", "United Hospital"],
    ["C", "Dermatology", "Evercare Hospital"],
    ["D", "Oncology", "Labaid Hospital"],
  ];
  for (const [name = "", specialization, hospital] of doctorRows) {
    const res = await ctx.admin
      .post("/api/v1/doctors")
      .send(doctorInput({ name: `Dr ${name}`, specialization, hospital, email: `${name}@x.dev` }))
      .expect(201);
    doctors[name] = res.body.id;
  }

  // Patient counts: A 0, B 2, C 1, D 1.
  const patientRows = [
    ["Pia", "B", 30, "critical"],
    ["Rafi", "B", 70, "stable"],
    ["Sumi", "C", 5, "under_observation"],
    ["Tuli", "D", 45, "recovering"],
  ] as const;
  for (const [name, doctor, age, condition] of patientRows) {
    const res = await ctx.admin
      .post(`/api/v1/doctors/${doctors[doctor]}/patients`)
      .send(patientInput({ name, age, condition }))
      .expect(201);
    patients[name] = res.body.id;
  }
});

afterAll(async () => {
  await ctx.stop();
});

describe("doctor sorting", () => {
  it.each([
    ["specialization", ["Dr A", "Dr C", "Dr B", "Dr D"]],
    ["-specialization", ["Dr D", "Dr B", "Dr C", "Dr A"]],
    ["hospital", ["Dr C", "Dr D", "Dr A", "Dr B"]],
    ["-hospital", ["Dr B", "Dr A", "Dr D", "Dr C"]],
    // Ties break newest first ascending; descending is the exact reverse.
    ["patientCount", ["Dr A", "Dr D", "Dr C", "Dr B"]],
    ["-patientCount", ["Dr B", "Dr C", "Dr D", "Dr A"]],
  ])("sorts by %s", async (sort, expected) => {
    const res = await ctx.admin.get(`/api/v1/doctors?sort=${sort}`).expect(200);
    expect(names(res.body)).toEqual(expected);
  });

  it("rejects a patient-only sort key", async () => {
    await ctx.admin.get("/api/v1/doctors?sort=age").expect(400);
  });
});

describe("patient sorting", () => {
  it.each([
    ["age", ["Sumi", "Pia", "Tuli", "Rafi"]],
    ["-age", ["Rafi", "Tuli", "Pia", "Sumi"]],
    ["condition", ["Rafi", "Tuli", "Sumi", "Pia"]],
    ["-condition", ["Pia", "Sumi", "Tuli", "Rafi"]],
  ])("sorts by %s", async (sort, expected) => {
    const res = await ctx.admin.get(`/api/v1/patients?sort=${sort}`).expect(200);
    expect(names(res.body)).toEqual(expected);
  });

  it("sorts a doctor's patients by severity", async () => {
    const res = await ctx.admin
      .get(`/api/v1/doctors/${doctors.B}/patients?sort=-condition`)
      .expect(200);
    expect(names(res.body)).toEqual(["Pia", "Rafi"]);
  });

  it.each([
    ["sort=-age", ["Rafi", "Pia"]],
    ["sort=name", ["Pia", "Rafi"]],
    ["sort=age&condition=critical", ["Pia"]],
    ["sort=-condition&search=rafi", ["Rafi"]],
    ["sort=createdAt&gender=male", ["Pia", "Rafi"]],
  ])("filters and sorts one doctor's patients with %s", async (params, expected) => {
    const res = await ctx.admin.get(`/api/v1/doctors/${doctors.B}/patients?${params}`).expect(200);
    expect(names(res.body)).toEqual(expected);
  });

  it("rejects a doctor-only sort key", async () => {
    await ctx.admin.get("/api/v1/patients?sort=patientCount").expect(400);
  });

  it("keeps the severity rank in step when the condition changes", async () => {
    await ctx.admin
      .patch(`/api/v1/patients/${patients.Rafi}`)
      .send({ condition: "critical" })
      .expect(200);

    const sorted = await ctx.admin.get("/api/v1/patients?sort=-condition&limit=2").expect(200);
    expect(names(sorted.body)).toEqual(["Pia", "Rafi"]);
    const critical = await ctx.admin.get("/api/v1/patients?condition=critical").expect(200);
    expect(critical.body.meta.total).toBe(2);
  });

  it("backfills ranks that are missing", async () => {
    await Patient.updateMany({}, { $unset: { conditionRank: 1 } });
    expect(await fillConditionRanks()).toEqual({ patientsCorrected: 4 });

    const res = await ctx.admin.get("/api/v1/patients?condition=recovering").expect(200);
    expect(names(res.body)).toEqual(["Tuli"]);
    expect(await fillConditionRanks()).toEqual({ patientsCorrected: 0 });
  });
});

describe("unfiltered list plans", () => {
  const expectIndexOrder = (explained: unknown) => {
    const stages = planStages(explained);
    expect(stages).toContain("IXSCAN");
    expect(stages).not.toContain("SORT");
    expect(stages).not.toContain("COLLSCAN");
  };

  it.each(sortParams(DOCTOR_SORT_FIELDS))("walks an index for doctors by %s", async (sort) => {
    expectIndexOrder(
      await Doctor.find().sort(sortSpec(DOCTOR_SORTS, sort)).limit(10).explain("queryPlanner"),
    );
  });

  it.each(sortParams(PATIENT_SORT_FIELDS))("walks an index for patients by %s", async (sort) => {
    expectIndexOrder(
      await Patient.find().sort(sortSpec(PATIENT_SORTS, sort)).limit(10).explain("queryPlanner"),
    );
  });

  it.each(["condition", "-condition"] as const)(
    "walks an index for one doctor's patients by %s",
    async (sort) => {
      expectIndexOrder(
        await Patient.find({ doctor: doctors.B })
          .sort(sortSpec(PATIENT_SORTS, sort))
          .limit(10)
          .explain("queryPlanner"),
      );
    },
  );
});
