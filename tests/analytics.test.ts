import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bucketLayout,
  conditionMixPipeline,
  doctorAnalyticsPipelines,
} from "../src/modules/analytics/analytics.service.ts";
import { Patient } from "../src/modules/patients/patient.model.ts";
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
let createdAt: Date[] = [];

/** Weekday (0 = Sunday) and hour of an instant in a time zone, computed independently of MongoDB. */
function localCell(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  return { weekday, hour: Number(part("hour")) };
}

const localMonth = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(date);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

beforeAll(async () => {
  ctx = await startTestApp();

  const doctorRows = [
    ["X", "Cardiology", "Square Hospital"],
    ["Y", "Cardiology", "United Hospital"],
    ["Z", "Neurology", "Square Hospital"],
    ["W", "Dermatology", "Evercare Hospital"],
  ];
  for (const [name = "", specialization, hospital] of doctorRows) {
    const res = await ctx.admin
      .post("/api/v1/doctors")
      .send(doctorInput({ name: `Dr ${name}`, specialization, hospital, email: `${name}@x.dev` }))
      .expect(201);
    doctors[name] = res.body.id;
  }

  // Ages and days ago are chosen so each one lands in a different bucket or window.
  const now = Date.now();
  const threeDaysAgoAt2030Utc = new Date(now - 3 * DAY_MS).setUTCHours(20, 30, 0, 0);
  const patientRows = [
    ["X", "critical", "male", 52, now],
    ["X", "critical", "female", 8, threeDaysAgoAt2030Utc],
    ["X", "stable", "female", 70, now - 40 * DAY_MS],
    ["Y", "recovering", "male", 30, now],
    ["Z", "under_observation", "other", 15, now],
    ["Z", "stable", "male", 45, now - 100 * DAY_MS],
  ] as const;
  for (const [doctor, condition, gender, age, at] of patientRows) {
    const res = await ctx.admin
      .post(`/api/v1/doctors/${doctors[doctor]}/patients`)
      .send(patientInput({ condition, gender, age }))
      .expect(201);
    // Backdated through the driver, which leaves Mongoose's timestamps alone.
    await Patient.collection.updateOne(
      { _id: new Types.ObjectId(res.body.id as string) },
      { $set: { createdAt: new Date(at) } },
    );
  }
  createdAt = patientRows.map((row) => new Date(row[4]));
});

afterAll(async () => {
  await ctx.stop();
});

describe("registrations", () => {
  it("returns one point per day for a year when asked", async () => {
    const res = await ctx.admin
      .get("/api/v1/analytics/registrations?range=12m&interval=day")
      .expect(200);

    expect(res.body.interval).toBe("day");
    expect(res.body.points).toHaveLength(365);
    expect(res.body.points.at(-1).date).toBe(new Date().toISOString().slice(0, 10));
    expect(sum(res.body.points.map((point: { patients: number }) => point.patients))).toBe(6);
    expect(sum(res.body.points.map((point: { doctors: number }) => point.doctors))).toBe(4);
  });

  it("rolls a short window up into months, counting only days inside it", async () => {
    const res = await ctx.admin
      .get("/api/v1/analytics/registrations?range=30d&interval=month&timezone=Asia/Dhaka")
      .expect(200);

    expect(res.body.interval).toBe("month");
    expect(res.body.points.length).toBeGreaterThanOrEqual(1);
    expect(res.body.points.at(-1).date).toBe(localMonth(new Date(), "Asia/Dhaka"));
    expect(sum(res.body.points.map((point: { patients: number }) => point.patients))).toBe(4);
  });

  it("keeps auto as months for 12m and days otherwise", async () => {
    const yearly = await ctx.admin.get("/api/v1/analytics/registrations?range=12m").expect(200);
    expect(yearly.body).toMatchObject({ interval: "month" });
    expect(yearly.body.points).toHaveLength(12);

    const quarter = await ctx.admin.get("/api/v1/analytics/registrations?range=90d").expect(200);
    expect(quarter.body.points).toHaveLength(90);
    expect(sum(quarter.body.points.map((point: { patients: number }) => point.patients))).toBe(5);

    await ctx.admin.get("/api/v1/analytics/registrations?interval=week").expect(400);
  });
});

describe("intake hours", () => {
  it.each(["UTC", "Asia/Dhaka"])("fills all 168 cells, grouped in %s", async (timezone) => {
    const res = await ctx.admin
      .get(`/api/v1/analytics/intake-hours?timezone=${timezone}`)
      .expect(200);

    const expected = new Map<string, number>();
    for (const date of createdAt.filter((at) => at.getTime() > Date.now() - 90 * DAY_MS)) {
      const { weekday, hour } = localCell(date, timezone);
      expected.set(`${weekday}:${hour}`, (expected.get(`${weekday}:${hour}`) ?? 0) + 1);
    }

    expect(res.body.range).toBe("90d");
    expect(res.body.cells).toHaveLength(168);
    expect(res.body.cells.slice(0, 2)).toEqual([
      expect.objectContaining({ weekday: 0, hour: 0 }),
      expect.objectContaining({ weekday: 0, hour: 1 }),
    ]);
    for (const cell of res.body.cells) {
      expect(cell.patients).toBe(expected.get(`${cell.weekday}:${cell.hour}`) ?? 0);
    }
    expect(res.body.max).toBe(Math.max(...expected.values()));
  });

  it("moves an evening UTC registration into the next Dhaka morning", async () => {
    const evening = createdAt[1] as Date;
    const [utc, dhaka] = await Promise.all(
      ["UTC", "Asia/Dhaka"].map((timezone) =>
        ctx.admin.get(`/api/v1/analytics/intake-hours?range=7d&timezone=${timezone}`),
      ),
    );
    const cell =
      (body: { cells: { weekday: number; hour: number; patients: number }[] }) =>
      (weekday: number, hour: number) =>
        body.cells.find((item) => item.weekday === weekday && item.hour === hour)?.patients;

    expect(cell(utc!.body)(evening.getUTCDay(), 20)).toBeGreaterThanOrEqual(1);
    expect(cell(dhaka!.body)((evening.getUTCDay() + 1) % 7, 2)).toBe(1);
  });

  it("rejects an unknown time zone", async () => {
    await ctx.admin.get("/api/v1/analytics/intake-hours?timezone=Mars/Base").expect(400);
  });
});

describe("condition mix", () => {
  it("groups by specialization, most patients first, including doctors without patients", async () => {
    const res = await ctx.admin.get("/api/v1/analytics/condition-mix").expect(200);
    expect(res.body).toEqual([
      {
        key: "Cardiology",
        doctors: 2,
        patients: 4,
        stable: 1,
        recovering: 1,
        under_observation: 0,
        critical: 2,
      },
      {
        key: "Neurology",
        doctors: 1,
        patients: 2,
        stable: 1,
        recovering: 0,
        under_observation: 1,
        critical: 0,
      },
      {
        key: "Dermatology",
        doctors: 1,
        patients: 0,
        stable: 0,
        recovering: 0,
        under_observation: 0,
        critical: 0,
      },
    ]);
  });

  it("groups by hospital", async () => {
    const res = await ctx.admin.get("/api/v1/analytics/condition-mix?by=hospital").expect(200);
    expect(res.body.map((row: { key: string }) => row.key)).toEqual([
      "Square Hospital",
      "United Hospital",
      "Evercare Hospital",
    ]);
    expect(res.body[0]).toMatchObject({ doctors: 2, patients: 5, stable: 2, critical: 2 });

    await ctx.admin.get("/api/v1/analytics/condition-mix?by=city").expect(400);
  });

  it("reads patients from the index alone", async () => {
    const explained = await Patient.aggregate(conditionMixPipeline("specialization")).explain(
      "executionStats",
    );
    const scans = planNodes(explained).filter((node) => node.stage === "IXSCAN");
    expect(scans.map((node) => node.indexName)).toContain(
      "doctor_1_conditionRank_1_createdAt_-1__id_-1",
    );
    expect(planNodes(explained).map((node) => node.stage)).not.toContain("COLLSCAN");
  });
});

describe("workload", () => {
  it("summarises the spread of patients across doctors", async () => {
    const res = await ctx.admin.get("/api/v1/analytics/workload").expect(200);
    expect(res.body).toMatchObject({ doctors: 4, average: 1.5, median: 1, p90: 3, max: 3 });
    expect(res.body.buckets).toHaveLength(8);
    expect(res.body.buckets.slice(0, 5)).toEqual([
      { min: 0, max: 0, doctors: 1 },
      { min: 1, max: 1, doctors: 1 },
      { min: 2, max: 2, doctors: 1 },
      { min: 3, max: 3, doctors: 1 },
      { min: 4, max: 4, doctors: 0 },
    ]);
  });

  it("always lays out 8 to 12 round-width buckets that reach the maximum", () => {
    for (let max = 0; max <= 20_000; max++) {
      const { width, count } = bucketLayout(max);
      expect(count).toBeGreaterThanOrEqual(8);
      expect(count).toBeLessThanOrEqual(12);
      expect(count * width).toBeGreaterThan(max);
      if (count > 8) expect((count - 1) * width).toBeLessThanOrEqual(max);
    }
    expect(bucketLayout(587)).toEqual({ width: 50, count: 12 });
  });
});

describe("patients per doctor", () => {
  it("ranks by the stored counter and skips doctors without patients", async () => {
    const res = await ctx.admin.get("/api/v1/analytics/patients-per-doctor").expect(200);
    expect(
      res.body.map((row: { name: string; patients: number }) => [row.name, row.patients]),
    ).toEqual([
      ["Dr X", 3],
      ["Dr Z", 2],
      ["Dr Y", 1],
    ]);
  });

  it("ranks by patients in one condition", async () => {
    const critical = await ctx.admin
      .get("/api/v1/analytics/patients-per-doctor?condition=critical")
      .expect(200);
    expect(critical.body).toEqual([
      expect.objectContaining({ doctorId: doctors.X, name: "Dr X", patients: 2 }),
    ]);

    const stable = await ctx.admin
      .get("/api/v1/analytics/patients-per-doctor?condition=stable&limit=1")
      .expect(200);
    expect(stable.body).toEqual([expect.objectContaining({ name: "Dr X", patients: 1 })]);

    await ctx.admin.get("/api/v1/analytics/patients-per-doctor?condition=fine").expect(400);
  });
});

describe("doctor analytics", () => {
  it("breaks one doctor's patients down", async () => {
    const res = await ctx.admin
      .get(`/api/v1/doctors/${doctors.X}/analytics?timezone=Asia/Dhaka`)
      .expect(200);

    expect(res.body.conditions).toEqual({
      stable: 1,
      recovering: 0,
      under_observation: 0,
      critical: 2,
    });
    expect(res.body.genders).toEqual([
      { gender: "male", patients: 1 },
      { gender: "female", patients: 2 },
      { gender: "other", patients: 0 },
    ]);
    expect(res.body.ageGroups).toEqual([
      { group: "0-12", patients: 1 },
      { group: "13-17", patients: 0 },
      { group: "18-30", patients: 0 },
      { group: "31-45", patients: 0 },
      { group: "46-60", patients: 1 },
      { group: "61+", patients: 1 },
    ]);

    const expectedMonths = new Map<string, number>();
    for (const date of createdAt.slice(0, 3)) {
      const month = localMonth(date, "Asia/Dhaka");
      expectedMonths.set(month, (expectedMonths.get(month) ?? 0) + 1);
    }
    expect(res.body.monthly).toHaveLength(12);
    expect(res.body.monthly.at(-1).month).toBe(localMonth(new Date(), "Asia/Dhaka"));
    for (const { month, patients } of res.body.monthly) {
      expect(patients).toBe(expectedMonths.get(month) ?? 0);
    }
  });

  it("returns zeros for a doctor without patients and 404 for a missing one", async () => {
    const empty = await ctx.admin.get(`/api/v1/doctors/${doctors.W}/analytics`).expect(200);
    expect(empty.body.conditions).toEqual({
      stable: 0,
      recovering: 0,
      under_observation: 0,
      critical: 0,
    });
    expect(sum(empty.body.monthly.map((row: { patients: number }) => row.patients))).toBe(0);

    await ctx.admin.get("/api/v1/doctors/000000000000000000000000/analytics").expect(404);
    await ctx.admin.get(`/api/v1/doctors/${doctors.X}/analytics?timezone=Nowhere`).expect(400);
  });

  it("reads only the doctor's index range in every pipeline", async () => {
    const doctor = new Types.ObjectId(doctors.X);
    const pipelines = doctorAnalyticsPipelines(doctor, "2000-01-01", "UTC");
    const point = `[ObjectId('${doctors.X}'), ObjectId('${doctors.X}')]`;

    for (const [name, pipeline] of Object.entries(pipelines)) {
      const explained = await Patient.aggregate(pipeline).explain("executionStats");
      const scans = planNodes(explained).filter((node) => node.stage === "IXSCAN");

      expect(scans.length, name).toBeGreaterThan(0);
      for (const scan of scans) {
        expect((scan.indexBounds as Record<string, string[]>).doctor, name).toEqual([point]);
      }
      expect(planNodes(explained).map((node) => node.stage)).not.toContain("COLLSCAN");
      if (name !== "demographics") expect(docsExamined(explained), name).toBe(0);
    }
  });
});
