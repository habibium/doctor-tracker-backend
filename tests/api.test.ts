import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sortSpec } from "../src/lib/query.ts";
import { CONDITION_RANK, Patient, PATIENT_SORTS } from "../src/modules/patients/patient.model.ts";
import { buildOpenApiDocument } from "../src/openapi/document.ts";
import { routes } from "../src/routes.ts";
import { doctorInput, patientInput, planStages, startTestApp, type TestApp } from "./helpers.ts";

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
});

afterAll(async () => {
  await ctx.stop();
});

describe("access control", () => {
  it("rejects requests without a session", async () => {
    const res = await request(ctx.app).get("/api/v1/doctors").expect(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("lets a viewer read but not write", async () => {
    await ctx.viewer.get("/api/v1/doctors").expect(200);
    const res = await ctx.viewer.post("/api/v1/doctors").send(doctorInput()).expect(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("serves health and the OpenAPI document publicly", async () => {
    await request(ctx.app).get("/health").expect(200);
    const res = await request(ctx.app).get("/openapi.json").expect(200);
    expect(res.body.paths["/api/v1/doctors"].get.operationId).toBe("listDoctors");
  });
});

describe("doctors", () => {
  let doctorId: string;

  it("creates a doctor and normalises the input", async () => {
    const res = await ctx.admin
      .post("/api/v1/doctors")
      .send(doctorInput({ name: "  Ayesha Rahman ", email: "Ayesha.Rahman@Example.com" }))
      .expect(201);

    expect(res.body).toMatchObject({
      name: "Ayesha Rahman",
      email: "ayesha.rahman@example.com",
      patientCount: 0,
    });
    expect(res.body).not.toHaveProperty("searchTokens");
    doctorId = res.body.id;
  });

  it("rejects a duplicate email with 409", async () => {
    const res = await ctx.admin.post("/api/v1/doctors").send(doctorInput()).expect(409);
    expect(res.body.error.details).toEqual([{ path: "body.email", message: "Already in use" }]);
  });

  it("reports every invalid field with 400", async () => {
    const res = await ctx.admin
      .post("/api/v1/doctors")
      .send({ name: "A", email: "nope" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((detail: { path: string }) => detail.path)).toEqual(
      expect.arrayContaining(["body.name", "body.email", "body.phone"]),
    );
  });

  it("searches by word prefix across name, specialization and phone", async () => {
    await ctx.admin
      .post("/api/v1/doctors")
      .send(doctorInput({ name: "Tanvir Hossain", specialization: "Neurology", email: "t@x.dev" }))
      .expect(201);

    const byWords = await ctx.admin.get("/api/v1/doctors?search=rah%20card").expect(200);
    expect(byWords.body.data.map((doctor: { name: string }) => doctor.name)).toEqual([
      "Ayesha Rahman",
    ]);

    const byPhone = await ctx.admin.get("/api/v1/doctors?search=01711").expect(200);
    expect(byPhone.body.meta.total).toBe(2);

    const noMatch = await ctx.admin.get("/api/v1/doctors?search=zzz").expect(200);
    expect(noMatch.body.data).toEqual([]);
  });

  it("filters, sorts and paginates", async () => {
    const filtered = await ctx.admin.get("/api/v1/doctors?specialization=Neurology").expect(200);
    expect(filtered.body.meta.total).toBe(1);

    const paged = await ctx.admin.get("/api/v1/doctors?sort=name&limit=1&page=2").expect(200);
    expect(paged.body.meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect(paged.body.data[0].name).toBe("Tanvir Hossain");

    const future = await ctx.admin.get("/api/v1/doctors?from=2999-01-01").expect(200);
    expect(future.body.meta.total).toBe(0);
  });

  it("rejects out-of-range query parameters", async () => {
    await ctx.admin.get("/api/v1/doctors?limit=500").expect(400);
    await ctx.admin.get("/api/v1/doctors/not-an-id").expect(400);
  });

  it("lists filter values", async () => {
    const res = await ctx.admin.get("/api/v1/doctors/filters").expect(200);
    expect(res.body).toEqual({
      specializations: ["Cardiology", "Neurology"],
      hospitals: ["Square Hospital"],
    });
  });

  it("refuses to delete a doctor who still has patients", async () => {
    const patient = await ctx.admin
      .post(`/api/v1/doctors/${doctorId}/patients`)
      .send(patientInput())
      .expect(201);

    await ctx.admin.delete(`/api/v1/doctors/${doctorId}`).expect(409);

    await ctx.admin.delete(`/api/v1/doctors/${doctorId}/patients/${patient.body.id}`).expect(204);
    await ctx.admin.delete(`/api/v1/doctors/${doctorId}`).expect(204);
    await ctx.admin.get(`/api/v1/doctors/${doctorId}`).expect(404);
  });
});

describe("patients", () => {
  let firstDoctorId: string;
  let secondDoctorId: string;
  let patientId: string;

  beforeAll(async () => {
    const first = await ctx.admin
      .post("/api/v1/doctors")
      .send(doctorInput({ name: "Nusrat Islam", email: "nusrat@x.dev" }));
    const second = await ctx.admin
      .post("/api/v1/doctors")
      .send(doctorInput({ name: "Imran Khan", email: "imran@x.dev" }));
    firstDoctorId = first.body.id;
    secondDoctorId = second.body.id;
  });

  it("adds a patient under a doctor", async () => {
    const res = await ctx.admin
      .post(`/api/v1/doctors/${firstDoctorId}/patients`)
      .send(patientInput({ condition: "critical" }))
      .expect(201);

    expect(res.body.doctor).toMatchObject({ id: firstDoctorId, name: "Nusrat Islam" });
    patientId = res.body.id;

    const doctor = await ctx.admin.get(`/api/v1/doctors/${firstDoctorId}`).expect(200);
    expect(doctor.body.patientCount).toBe(1);
  });

  it("returns 404 when the doctor does not exist", async () => {
    await ctx.admin
      .post("/api/v1/patients")
      .send(patientInput({ doctorId: "000000000000000000000000" }))
      .expect(404);
  });

  it("filters by condition, doctor and search", async () => {
    await ctx.admin
      .post("/api/v1/patients")
      .send(patientInput({ name: "Salma Begum", gender: "female", doctorId: secondDoctorId }))
      .expect(201);

    const critical = await ctx.admin.get("/api/v1/patients?condition=critical").expect(200);
    expect(critical.body.data.map((patient: { id: string }) => patient.id)).toEqual([patientId]);

    const ofDoctor = await ctx.admin.get(`/api/v1/doctors/${secondDoctorId}/patients`).expect(200);
    expect(ofDoctor.body.data.map((patient: { name: string }) => patient.name)).toEqual([
      "Salma Begum",
    ]);

    const searched = await ctx.admin.get("/api/v1/patients?search=hyper&gender=female").expect(200);
    expect(searched.body.meta.total).toBe(1);
  });

  it("updates a patient, moves them to another doctor and re-indexes the search", async () => {
    const res = await ctx.admin
      .patch(`/api/v1/patients/${patientId}`)
      .send({ name: "Karim Chowdhury", condition: "recovering", doctorId: secondDoctorId })
      .expect(200);
    expect(res.body).toMatchObject({ condition: "recovering", doctor: { id: secondDoctorId } });

    const found = await ctx.admin.get("/api/v1/patients?search=chow").expect(200);
    expect(found.body.meta.total).toBe(1);
    const stale = await ctx.admin.get("/api/v1/patients?search=uddin").expect(200);
    expect(stale.body.meta.total).toBe(0);
  });

  it("rejects an empty update", async () => {
    await ctx.admin.patch(`/api/v1/patients/${patientId}`).send({}).expect(400);
  });

  it("deletes a patient", async () => {
    await ctx.admin.delete(`/api/v1/patients/${patientId}`).expect(204);
    await ctx.admin.get(`/api/v1/patients/${patientId}`).expect(404);
  });
});

describe("analytics", () => {
  it("summarises totals", async () => {
    const res = await ctx.admin.get("/api/v1/analytics/summary?range=7d").expect(200);
    expect(res.body).toMatchObject({ range: "7d", totalDoctors: 3, totalPatients: 1 });
  });

  it("returns a gap-free series in the requested time zone", async () => {
    const daily = await ctx.admin
      .get("/api/v1/analytics/registrations?range=30d&timezone=Asia/Dhaka")
      .expect(200);
    expect(daily.body.interval).toBe("day");
    expect(daily.body.points).toHaveLength(30);
    expect(daily.body.points.at(-1)).toMatchObject({ patients: 1, doctors: 3 });

    const monthly = await ctx.admin.get("/api/v1/analytics/registrations?range=12m").expect(200);
    expect(monthly.body.points).toHaveLength(12);

    await ctx.admin.get("/api/v1/analytics/registrations?timezone=Mars/Base").expect(400);
  });

  it("ranks doctors and breaks patients down", async () => {
    const top = await ctx.admin.get("/api/v1/analytics/patients-per-doctor").expect(200);
    expect(top.body).toEqual([expect.objectContaining({ name: "Imran Khan", patients: 1 })]);

    const conditions = await ctx.admin.get("/api/v1/analytics/conditions").expect(200);
    expect(conditions.body).toHaveLength(4);

    const specializations = await ctx.admin.get("/api/v1/analytics/specializations").expect(200);
    expect(specializations.body[0]).toEqual({
      specialization: "Cardiology",
      doctors: 2,
      patients: 1,
    });

    const demographics = await ctx.admin.get("/api/v1/analytics/demographics").expect(200);
    expect(demographics.body.genders).toContainEqual({ gender: "female", patients: 1 });
  });
});

describe("query plans", () => {
  it("serves a filtered, sorted page from the index without sorting in memory", async () => {
    const explained = await Patient.find({ conditionRank: CONDITION_RANK.critical })
      .sort(sortSpec(PATIENT_SORTS, "-createdAt"))
      .limit(10)
      .explain("queryPlanner");
    const stages = planStages(explained);

    expect(stages).toContain("IXSCAN");
    expect(stages).not.toContain("SORT");
    expect(stages).not.toContain("COLLSCAN");
  });
});

describe("OpenAPI document", () => {
  it("gives every operation a unique id", () => {
    const document = buildOpenApiDocument(routes);
    const ids = Object.values(document.paths ?? {}).flatMap((path) =>
      Object.values(path as Record<string, { operationId?: string }>).map(
        (operation) => operation.operationId,
      ),
    );

    expect(ids).toHaveLength(routes.length);
    expect(new Set(ids).size).toBe(routes.length);
  });
});
