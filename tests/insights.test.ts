import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  diagnosisRankingPipeline,
  diagnosisTrendPipelines,
} from "../src/modules/analytics/analytics.service.ts";
import { HOLIDAYS } from "../src/modules/analytics/holidays.ts";
import { Doctor } from "../src/modules/doctors/doctor.model.ts";
import { DIAGNOSIS_INDEX, Patient } from "../src/modules/patients/patient.model.ts";
import {
  docsExamined,
  doctorInput,
  patientInput,
  planNodes,
  startTestApp,
  type TestApp,
} from "./helpers.ts";

const DAY_MS = 86_400_000;

let ctx: TestApp;
const doctors: Record<string, string> = {};

const thisYear = (timeZone: string) =>
  Number(new Intl.DateTimeFormat("en", { timeZone, year: "numeric" }).format(new Date()));
const thisMonth = (timeZone: string) =>
  Number(new Intl.DateTimeFormat("en", { timeZone, month: "numeric" }).format(new Date()));

/** Expected monthly counts for this year so far and all of last year, grouped with `Intl`. */
function expectedMonths(dates: number[], timeZone: string) {
  const year = thisYear(timeZone);
  const counts = { thisYear: Array(thisMonth(timeZone)).fill(0), lastYear: Array(12).fill(0) };
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" });
  for (const date of dates) {
    const [y = 0, m = 0] = format.format(new Date(date)).split("-").map(Number);
    if (y === year) counts.thisYear[m - 1] += 1;
    if (y === year - 1) counts.lastYear[m - 1] += 1;
  }
  return counts;
}

const dengueDates: number[] = [];

const backdate = (id: string, at: number) =>
  Patient.collection.updateOne(
    { _id: new Types.ObjectId(id) },
    { $set: { createdAt: new Date(at) } },
  );

beforeAll(async () => {
  ctx = await startTestApp();

  const doctorRows = [
    ["A", "Cardiology", "Square Hospital"],
    ["B", "Cardiology", "Square Hospital"],
    ["C", "Pediatrics", "Square Hospital"],
    ["D", "Pediatrics", "United Hospital"],
    ["E", "Neurology", "Ibn Sina Hospital"],
  ];
  for (const [name = "", specialization, hospital] of doctorRows) {
    const res = await ctx.admin
      .post("/api/v1/doctors")
      .send(doctorInput({ name: `Dr ${name}`, specialization, hospital, email: `${name}@x.dev` }))
      .expect(201);
    doctors[name] = res.body.id;
  }

  const year = thisYear("Asia/Dhaka");
  const now = Date.now();
  // 19:00 UTC on 31 December is 01:00 on 1 January in Dhaka.
  const newYearInDhaka = Date.UTC(year - 1, 11, 31, 19);
  const patientRows: [string, string, number][] = [
    ["C", "Dengue fever", now],
    ["C", "Dengue fever", now - 10 * DAY_MS],
    ["C", "Dengue fever", now - 40 * DAY_MS],
    ["C", "Dengue fever", newYearInDhaka],
    ["C", "Dengue fever", Date.UTC(year - 1, 6, 15, 6)],
    ["C", "Dengue fever", Date.UTC(year - 2, 6, 15, 6)],
    ["D", "Bronchiolitis", now - 45 * DAY_MS],
    ["A", "Hypertension", now],
    ["A", "Hypertension", now - 50 * DAY_MS],
    ["E", "Migraine", now - 100 * DAY_MS],
  ];
  for (const [doctor, diagnosis, at] of patientRows) {
    const res = await ctx.admin
      .post(`/api/v1/doctors/${doctors[doctor]}/patients`)
      .send(patientInput({ diagnosis }))
      .expect(201);
    await backdate(res.body.id, at);
    if (diagnosis === "Dengue fever") dengueDates.push(at);
  }
});

afterAll(async () => {
  await ctx.stop();
});

describe("coverage", () => {
  it("counts doctors and patients per hospital and specialization, listing only staffed pairs", async () => {
    const res = await ctx.admin.get("/api/v1/analytics/coverage").expect(200);

    expect(res.body.hospitals).toEqual([
      { name: "Square Hospital", doctors: 3, patients: 8 },
      { name: "Ibn Sina Hospital", doctors: 1, patients: 1 },
      { name: "United Hospital", doctors: 1, patients: 1 },
    ]);
    expect(res.body.specializations).toEqual([
      { name: "Cardiology", doctors: 2, patients: 2, hospitals: 1 },
      { name: "Pediatrics", doctors: 2, patients: 7, hospitals: 2 },
      { name: "Neurology", doctors: 1, patients: 1, hospitals: 1 },
    ]);
    expect(res.body.cells).toEqual([
      { hospital: "Ibn Sina Hospital", specialization: "Neurology", doctors: 1, patients: 1 },
      { hospital: "Square Hospital", specialization: "Cardiology", doctors: 2, patients: 2 },
      { hospital: "Square Hospital", specialization: "Pediatrics", doctors: 1, patients: 6 },
      { hospital: "United Hospital", specialization: "Pediatrics", doctors: 1, patients: 1 },
    ]);
  });
});

describe("diagnosis ranking", () => {
  it("ranks diagnoses by patients and counts the last two 30-day windows", async () => {
    const res = await ctx.admin.get("/api/v1/analytics/diagnoses").expect(200);
    expect(res.body).toEqual([
      { diagnosis: "Dengue fever", patients: 6, last30Days: 2, previous30Days: 1 },
      { diagnosis: "Hypertension", patients: 2, last30Days: 1, previous30Days: 1 },
      { diagnosis: "Bronchiolitis", patients: 1, last30Days: 0, previous30Days: 1 },
      { diagnosis: "Migraine", patients: 1, last30Days: 0, previous30Days: 0 },
    ]);

    const top = await ctx.admin.get("/api/v1/analytics/diagnoses?limit=1").expect(200);
    expect(top.body).toHaveLength(1);
    await ctx.admin.get("/api/v1/analytics/diagnoses?limit=0").expect(400);
  });

  it("reads the diagnosis index alone", async () => {
    const explained = await Patient.aggregate(diagnosisRankingPipeline(10)).explain(
      "executionStats",
    );
    const scan = planNodes(explained).find((node) => node.stage === "IXSCAN");
    expect(scan?.indexName).toBe("diagnosis_1_createdAt_-1__id_-1");
    expect(docsExamined(explained)).toBe(0);
  });
});

describe("diagnosis trends", () => {
  it("splits this year from last year by calendar month in the requested time zone", async () => {
    const year = thisYear("Asia/Dhaka");
    const month = thisMonth("Asia/Dhaka");
    const res = await ctx.admin
      .get("/api/v1/analytics/diagnosis-trends")
      .query({ diagnosis: ["Dengue fever", "Bronchiolitis"], timezone: "Asia/Dhaka" })
      .expect(200);

    expect(res.body).toMatchObject({ year, month });
    const [dengue, bronchiolitis] = res.body.series;
    expect(dengue).toEqual({
      diagnosis: "Dengue fever",
      ...expectedMonths(dengueDates, "Asia/Dhaka"),
    });
    // The new-year registration is this January in Dhaka; the one two years back is left out.
    expect(dengue.thisYear[0]).toBeGreaterThanOrEqual(1);
    expect(sum(dengue.thisYear) + sum(dengue.lastYear)).toBe(5);
    expect(sum(bronchiolitis.thisYear) + sum(bronchiolitis.lastYear)).toBe(1);
    expect(sum(res.body.allPatients.thisYear) + sum(res.body.allPatients.lastYear)).toBe(9);
  });

  it("puts the same instant in last December when read in UTC", async () => {
    const res = await ctx.admin
      .get("/api/v1/analytics/diagnosis-trends?diagnosis=Dengue%20fever&timezone=UTC")
      .expect(200);
    const { thisYear: current, lastYear } = expectedMonths(dengueDates, "UTC");
    expect(res.body.series[0]).toMatchObject({ thisYear: current, lastYear });
    expect(lastYear[11]).toBeGreaterThanOrEqual(1);
  });

  it("requires one to twelve diagnoses", async () => {
    await ctx.admin.get("/api/v1/analytics/diagnosis-trends").expect(400);
    const thirteen = Array.from({ length: 13 }, (_, i) => `Diagnosis ${i}`);
    await ctx.admin
      .get("/api/v1/analytics/diagnosis-trends")
      .query({ diagnosis: thirteen })
      .expect(400);
  });

  it("reads only the chosen diagnoses' index range, covered", async () => {
    const pipelines = diagnosisTrendPipelines(["Dengue fever"], "2000-01-01", "UTC");
    const explained = await Patient.aggregate(pipelines.diagnoses).explain("executionStats");
    const scan = planNodes(explained).find((node) => node.stage === "IXSCAN");
    expect(scan?.indexName).toBe("diagnosis_1_createdAt_-1__id_-1");
    expect(scan?.indexBounds).toMatchObject({ diagnosis: ['["Dengue fever", "Dengue fever"]'] });
    expect(docsExamined(explained)).toBe(0);
    expect(docsExamined(await Patient.aggregate(pipelines.all).explain("executionStats"))).toBe(0);
  });
});

describe("calendar and comparisons", () => {
  it("returns the public holidays that overlap a registrations window", async () => {
    const res = await ctx.admin
      .get("/api/v1/analytics/registrations?range=12m&interval=day&timezone=Asia/Dhaka")
      .expect(200);
    const first = res.body.points[0].date;
    const last = res.body.points.at(-1).date;
    expect(res.body.holidays).toEqual(
      HOLIDAYS.filter((holiday) => holiday.end >= first && holiday.start <= last),
    );
  });

  it("compares new doctors with the window before", async () => {
    await Doctor.collection.updateOne(
      { _id: new Types.ObjectId(doctors.E) },
      { $set: { createdAt: new Date(Date.now() - 40 * DAY_MS) } },
    );
    const res = await ctx.admin.get("/api/v1/analytics/summary?range=30d").expect(200);
    expect(res.body).toMatchObject({ newDoctors: 4, previousNewDoctors: 1 });
  });
});

describe("a doctor's diagnoses", () => {
  it("ranks the doctor's own diagnoses with the same windows", async () => {
    const res = await ctx.admin.get(`/api/v1/doctors/${doctors.C}/analytics`).expect(200);
    expect(res.body.diagnoses).toEqual([
      { diagnosis: "Dengue fever", patients: 6, last30Days: 2, previous30Days: 1 },
    ]);
  });
});

describe("diagnosis filter", () => {
  it("lists the patients with one exact diagnosis", async () => {
    const res = await ctx.admin.get("/api/v1/patients?diagnosis=Dengue%20fever").expect(200);
    expect(res.body.meta.total).toBe(6);
    expect(
      res.body.data.every((row: { diagnosis: string }) => row.diagnosis === "Dengue fever"),
    ).toBe(true);

    const scoped = await ctx.admin
      .get(`/api/v1/doctors/${doctors.A}/patients?diagnosis=Dengue%20fever`)
      .expect(200);
    expect(scoped.body.meta.total).toBe(0);
  });

  it("serves a diagnosis page in date order straight from its index", async () => {
    const explained = await Patient.find({ diagnosis: "Dengue fever" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .hint(DIAGNOSIS_INDEX)
      .explain("executionStats");
    const stages = planNodes(explained).map((node) => node.stage);
    expect(stages).toContain("IXSCAN");
    expect(stages).not.toContain("SORT");
  });
});

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
