import { type PipelineStage, Types } from "mongoose";
import { notFound } from "../../lib/errors.ts";
import { sortSpec } from "../../lib/query.ts";
import { Doctor, DOCTOR_SORTS } from "../doctors/doctor.model.ts";
import { DOCTOR_SUMMARY } from "../doctors/doctor.service.ts";
import { CONDITION_RANK, countsByCondition, Patient } from "../patients/patient.model.ts";
import {
  type ConditionCounts,
  GENDERS,
  PATIENT_CONDITIONS,
  type PatientCondition,
} from "../patients/patient.schema.ts";
import type { Grouping, Interval, Range } from "./analytics.schema.ts";
import { holidaysBetween } from "./holidays.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const RANGE_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 };

/**
 * Sorting by an indexed field before $group lets MongoDB answer from the index alone
 * (a covered scan, zero documents read) instead of scanning the whole collection.
 */
const INDEX_ORDER = {
  conditionRank: { $sort: { conditionRank: 1 } },
  doctorAndCondition: { $sort: { doctor: 1, conditionRank: 1 } },
} satisfies Record<string, PipelineStage>;

const AGE_BOUNDARIES = [0, 13, 18, 31, 46, 61] as const;
const AGE_LABELS = ["0-12", "13-17", "18-30", "31-45", "46-60", "61+"];

const WORKLOAD_BUCKETS = { min: 8, max: 12 };
/** Widths that read well on an axis. Neighbours differ by at most 1.5x, so 8 to 12 buckets fit. */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8];

const oneDecimal = (total: number, count: number) =>
  count ? Math.round((total / count) * 10) / 10 : 0;

export async function getSummary(range: Range) {
  const span = RANGE_DAYS[range] * DAY_MS;
  const now = Date.now();
  const start = new Date(now - span);
  const previousStart = new Date(now - 2 * span);

  const previous = { $gte: previousStart, $lt: start };

  const [
    totalDoctors,
    totalPatients,
    criticalPatients,
    newDoctors,
    previousNewDoctors,
    newPatients,
    previousNewPatients,
  ] = await Promise.all([
    Doctor.estimatedDocumentCount(),
    Patient.estimatedDocumentCount(),
    Patient.countDocuments({ conditionRank: CONDITION_RANK.critical }),
    Doctor.countDocuments({ createdAt: { $gte: start } }),
    Doctor.countDocuments({ createdAt: previous }),
    Patient.countDocuments({ createdAt: { $gte: start } }),
    Patient.countDocuments({ createdAt: previous }),
  ]);

  return {
    range,
    totalDoctors,
    totalPatients,
    averagePatientsPerDoctor: oneDecimal(totalPatients, totalDoctors),
    criticalPatients,
    newDoctors,
    previousNewDoctors,
    newPatients,
    previousNewPatients,
  };
}

const isoDay = (year: number, monthIndex: number, day: number) =>
  new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);

/** Today's year, month (1 to 12) and day in a time zone. */
function localToday(timeZone: string) {
  const [year = 0, month = 0, day = 0] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);
  return { year, month, day };
}

/** Calendar buckets ending today in the caller's time zone, oldest first. */
function calendar(range: Range, interval: Interval, timeZone: string) {
  const { year, month, day } = localToday(timeZone);
  const today = isoDay(year, month - 1, day);

  const resolved = interval === "auto" ? (range === "12m" ? "month" : "day") : interval;
  const days = RANGE_DAYS[range];

  if (resolved === "day") {
    const labels = Array.from({ length: days }, (_, i) =>
      isoDay(year, month - 1, day - days + 1 + i),
    );
    return { interval: resolved, labels, firstDay: labels[0] as string, today };
  }

  // 12m by month is the last 12 whole months; shorter ranges cover the months their days touch.
  const firstDay =
    range === "12m" ? isoDay(year, month - 12, 1) : isoDay(year, month - 1, day - days + 1);
  const [firstYear = 0, firstMonth = 0] = firstDay.split("-").map(Number);
  const labels = Array.from({ length: (year - firstYear) * 12 + month - firstMonth + 1 }, (_, i) =>
    isoDay(firstYear, firstMonth - 1 + i, 1).slice(0, 7),
  );
  return { interval: resolved, labels, firstDay, today };
}

type DayRow = { _id: string; count: number };

// UTC midnight minus the largest zone offset (+14h) is at or before local midnight anywhere;
// rows from those extra hours fall before `firstDay` and are dropped by label.
const sinceLocalDay = (firstDay: string) => new Date(Date.parse(firstDay) - 14 * HOUR_MS);

/** Counts per local calendar day. Reads only `createdAt` beyond `match`, so it can be covered. */
function byLocalDay(match: Record<string, unknown>, firstDay: string, timezone: string) {
  const since = sinceLocalDay(firstDay);
  return [
    { $match: { ...match, createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { date: "$createdAt", format: "%Y-%m-%d", timezone } },
        count: { $sum: 1 },
      },
    },
  ] satisfies PipelineStage[];
}

/** Every label present, gaps as zero; day rows roll up into month labels. */
function onLabels(rows: DayRow[], labels: string[], firstDay: string) {
  const counts = new Map(labels.map((label) => [label, 0]));
  const width = labels[0]?.length ?? firstDay.length;
  for (const row of rows) {
    if (row._id < firstDay) continue;
    const label = row._id.slice(0, width);
    counts.set(label, (counts.get(label) ?? 0) + row.count);
  }
  return counts;
}

export async function getRegistrations(range: Range, interval: Interval, timezone: string) {
  const { interval: resolved, labels, firstDay, today } = calendar(range, interval, timezone);
  const pipeline = byLocalDay({}, firstDay, timezone);
  const [patients, doctors] = await Promise.all([
    Patient.aggregate<DayRow>(pipeline),
    Doctor.aggregate<DayRow>(pipeline),
  ]);
  const patientCounts = onLabels(patients, labels, firstDay);
  const doctorCounts = onLabels(doctors, labels, firstDay);

  return {
    range,
    interval: resolved,
    points: labels.map((date) => ({
      date,
      patients: patientCounts.get(date) ?? 0,
      doctors: doctorCounts.get(date) ?? 0,
    })),
    holidays: holidaysBetween(firstDay, today),
  };
}

export async function getIntakeHours(range: Range, timezone: string) {
  const since = new Date(Date.now() - RANGE_DAYS[range] * DAY_MS);
  const rows = await Patient.aggregate<{
    _id: { weekday: number; hour: number };
    patients: number;
  }>([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: {
          weekday: { $dayOfWeek: { date: "$createdAt", timezone } },
          hour: { $hour: { date: "$createdAt", timezone } },
        },
        patients: { $sum: 1 },
      },
    },
  ]);

  // $dayOfWeek counts Sunday as 1.
  const counts = new Map(
    rows.map(({ _id, patients }) => [(_id.weekday - 1) * 24 + _id.hour, patients]),
  );
  const cells = Array.from({ length: 7 * 24 }, (_, i) => ({
    weekday: Math.floor(i / 24),
    hour: i % 24,
    patients: counts.get(i) ?? 0,
  }));
  return { range, cells, max: Math.max(...cells.map((cell) => cell.patients)) };
}

export async function getPatientsPerDoctor(limit: number, condition?: PatientCondition) {
  if (!condition) {
    // Straight off the stored counter's index: `limit` keys and documents, no patient read.
    const doctors = await Doctor.find({ patientCount: { $gt: 0 } })
      .select(`${DOCTOR_SUMMARY} patientCount`)
      .sort(sortSpec(DOCTOR_SORTS, "-patientCount"))
      .limit(limit)
      .lean();
    return doctors.map((doctor) => ({
      doctorId: String(doctor._id),
      name: doctor.name,
      specialization: doctor.specialization,
      hospital: doctor.hospital,
      patients: doctor.patientCount,
    }));
  }

  const rows = await Patient.aggregate<{
    _id: Types.ObjectId;
    patients: number;
    doctor: { name: string; specialization: string; hospital: string };
  }>(conditionRankingPipeline(condition, limit));

  return rows.map((row) => ({
    doctorId: String(row._id),
    name: row.doctor.name,
    specialization: row.doctor.specialization,
    hospital: row.doctor.hospital,
    patients: row.patients,
  }));
}

/** Doctors ranked by patients in one condition; exported so tests can check its plan. */
export function conditionRankingPipeline(condition: PatientCondition, limit: number) {
  return [
    // Every `doctor` is an ObjectId. Saying so bounds the leading key of the doctor, conditionRank
    // index, so the scan seeks to each doctor's slice of this condition and never fetches.
    { $match: { doctor: { $type: "objectId" }, conditionRank: CONDITION_RANK[condition] } },
    INDEX_ORDER.doctorAndCondition,
    { $group: { _id: "$doctor", patients: { $sum: 1 } } },
    { $sort: { patients: -1, _id: 1 } },
    { $limit: limit },
    // Joined after $limit, so only the top rows are looked up.
    {
      $lookup: {
        from: Doctor.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "doctor",
        pipeline: [{ $project: { name: 1, specialization: 1, hospital: 1 } }],
      },
    },
    { $unwind: "$doctor" },
  ] satisfies PipelineStage[];
}

export async function getConditionBreakdown() {
  const rows = await Patient.aggregate<{ _id: number; patients: number }>([
    INDEX_ORDER.conditionRank,
    { $group: { _id: "$conditionRank", patients: { $sum: 1 } } },
  ]);
  const counts = countsByCondition(new Map(rows.map((row) => [row._id, row.patients])));
  return PATIENT_CONDITIONS.map((condition) => ({ condition, patients: counts[condition] }));
}

export async function getSpecializationBreakdown() {
  // The stored counters make this one pass over the doctors; no patient is read.
  const rows = await Doctor.aggregate<{ _id: string; doctors: number; patients: number }>([
    {
      $group: {
        _id: "$specialization",
        doctors: { $sum: 1 },
        patients: { $sum: "$patientCount" },
      },
    },
  ]);
  return rows
    .map(({ _id, doctors, patients }) => ({ specialization: _id, doctors, patients }))
    .sort((a, b) => b.patients - a.patients || a.specialization.localeCompare(b.specialization));
}

/** The patient side of the condition mix; exported so tests can check its plan. */
export function conditionMixPipeline(by: Grouping): PipelineStage[] {
  const perCondition = (accumulator: (condition: PatientCondition) => unknown) =>
    Object.fromEntries(PATIENT_CONDITIONS.map((condition) => [condition, accumulator(condition)]));

  return [
    INDEX_ORDER.doctorAndCondition,
    // A covered scan collapses patients to one row per doctor, so the join runs per doctor.
    {
      $group: {
        _id: "$doctor",
        ...perCondition((condition) => ({
          $sum: { $cond: [{ $eq: ["$conditionRank", CONDITION_RANK[condition]] }, 1, 0] },
        })),
      },
    },
    {
      $lookup: {
        from: Doctor.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "doctor",
        pipeline: [{ $project: { [by]: 1 } }],
      },
    },
    { $unwind: "$doctor" },
    {
      $group: {
        _id: `$doctor.${by}`,
        ...perCondition((condition) => ({ $sum: `$${condition}` })),
      },
    },
  ];
}

export async function getConditionMix(by: Grouping) {
  const [doctorRows, patientRows] = await Promise.all([
    Doctor.aggregate<{ _id: string; doctors: number }>([
      { $sort: { [by]: 1 } },
      { $group: { _id: `$${by}`, doctors: { $sum: 1 } } },
    ]),
    Patient.aggregate<{ _id: string } & ConditionCounts>(conditionMixPipeline(by)),
  ]);
  const byKey = new Map(patientRows.map((row) => [row._id, row]));

  return doctorRows
    .map(({ _id: key, doctors }) => {
      const row = byKey.get(key);
      const counts = {
        stable: row?.stable ?? 0,
        recovering: row?.recovering ?? 0,
        under_observation: row?.under_observation ?? 0,
        critical: row?.critical ?? 0,
      } satisfies ConditionCounts;
      const patients = PATIENT_CONDITIONS.reduce((sum, condition) => sum + counts[condition], 0);
      return { key, doctors, patients, ...counts };
    })
    .sort((a, b) => b.patients - a.patients || a.key.localeCompare(b.key));
}

export async function getCoverage() {
  // 300 small documents, all needed. No index holds hospital, specialization and the counter
  // together, and adding one would put a third patientCount index on every patient write.
  const rows = await Doctor.aggregate<{
    _id: { hospital: string; specialization: string };
    doctors: number;
    patients: number;
  }>([
    {
      $group: {
        _id: { hospital: "$hospital", specialization: "$specialization" },
        doctors: { $sum: 1 },
        patients: { $sum: "$patientCount" },
      },
    },
  ]);

  const hospitals = new Map<string, { name: string; doctors: number; patients: number }>();
  const specializations = new Map<
    string,
    { name: string; doctors: number; patients: number; hospitals: number }
  >();
  for (const { _id, doctors, patients } of rows) {
    const hospital = hospitals.get(_id.hospital) ?? { name: _id.hospital, doctors: 0, patients: 0 };
    hospital.doctors += doctors;
    hospital.patients += patients;
    hospitals.set(_id.hospital, hospital);

    const specialization = specializations.get(_id.specialization) ?? {
      name: _id.specialization,
      doctors: 0,
      patients: 0,
      hospitals: 0,
    };
    specialization.doctors += doctors;
    specialization.patients += patients;
    specialization.hospitals += 1;
    specializations.set(_id.specialization, specialization);
  }

  const byDoctors = (a: { name: string; doctors: number }, b: { name: string; doctors: number }) =>
    b.doctors - a.doctors || a.name.localeCompare(b.name);
  return {
    hospitals: [...hospitals.values()].sort(byDoctors),
    specializations: [...specializations.values()].sort(byDoctors),
    cells: rows
      .map(({ _id, doctors, patients }) => ({ ..._id, doctors, patients }))
      .sort(
        (a, b) =>
          a.hospital.localeCompare(b.hospital) || a.specialization.localeCompare(b.specialization),
      ),
  };
}

/** Totals and the last two 30-day windows, from `createdAt` alone so an index can cover it. */
function diagnosisCounts(now: number) {
  const last30 = new Date(now - 30 * DAY_MS);
  const previous30 = new Date(now - 60 * DAY_MS);
  return {
    patients: { $sum: 1 },
    last30Days: { $sum: { $cond: [{ $gte: ["$createdAt", last30] }, 1, 0] } },
    previous30Days: {
      $sum: {
        $cond: [
          { $and: [{ $gte: ["$createdAt", previous30] }, { $lt: ["$createdAt", last30] }] },
          1,
          0,
        ],
      },
    },
  };
}

type DiagnosisRow = { _id: string; patients: number; last30Days: number; previous30Days: number };

const toDiagnosisCount = ({ _id, ...counts }: DiagnosisRow) => ({ diagnosis: _id, ...counts });

/** Exported so tests can check its plan. */
export function diagnosisRankingPipeline(limit: number, now = Date.now()): PipelineStage[] {
  return [
    { $sort: { diagnosis: 1 } },
    { $group: { _id: "$diagnosis", ...diagnosisCounts(now) } },
    { $sort: { patients: -1, _id: 1 } },
    { $limit: limit },
  ];
}

export async function getDiagnosisRanking(limit: number) {
  const rows = await Patient.aggregate<DiagnosisRow>(diagnosisRankingPipeline(limit));
  return rows.map(toDiagnosisCount);
}

const month = (timezone: string) => ({
  $dateToString: { date: "$createdAt", format: "%Y-%m", timezone },
});

/** Exported so tests can check their plans. Both read only indexed fields. */
export function diagnosisTrendPipelines(diagnoses: string[], firstDay: string, timezone: string) {
  const createdAt = { $gte: sinceLocalDay(firstDay) };
  return {
    diagnoses: [
      { $match: { diagnosis: { $in: diagnoses }, createdAt } },
      {
        $group: {
          _id: { diagnosis: "$diagnosis", month: month(timezone) },
          patients: { $sum: 1 },
        },
      },
    ],
    all: [{ $match: { createdAt } }, { $group: { _id: month(timezone), patients: { $sum: 1 } } }],
  } satisfies Record<string, PipelineStage[]>;
}

export async function getDiagnosisTrends(diagnoses: string[], timezone: string) {
  const { year, month: current } = localToday(timezone);
  const pipelines = diagnosisTrendPipelines(diagnoses, `${year - 1}-01-01`, timezone);
  const [diagnosisRows, allRows] = await Promise.all([
    Patient.aggregate<{ _id: { diagnosis: string; month: string }; patients: number }>(
      pipelines.diagnoses,
    ),
    Patient.aggregate<{ _id: string; patients: number }>(pipelines.all),
  ]);

  const label = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  const months = (counts: Map<string, number>, y: number, length: number) =>
    Array.from({ length }, (_, i) => counts.get(label(y, i + 1)) ?? 0);
  const both = (counts: Map<string, number>) => ({
    thisYear: months(counts, year, current),
    lastYear: months(counts, year - 1, 12),
  });

  const unique = [...new Set(diagnoses)];
  return {
    year,
    month: current,
    series: unique.map((diagnosis) => ({
      diagnosis,
      ...both(
        new Map(
          diagnosisRows
            .filter((row) => row._id.diagnosis === diagnosis)
            .map((row) => [row._id.month, row.patients]),
        ),
      ),
    })),
    allPatients: both(new Map(allRows.map((row) => [row._id, row.patients]))),
  };
}

/** The narrowest round width that fits 0 to `max` in at most 12 buckets, padded to at least 8. */
export function bucketLayout(max: number) {
  for (let scale = 1; ; scale *= 10) {
    for (const step of NICE_STEPS) {
      const width = step * scale;
      const needed = Math.ceil((max + 1) / width);
      if (Number.isInteger(width) && needed <= WORKLOAD_BUCKETS.max) {
        return { width, count: Math.max(WORKLOAD_BUCKETS.min, needed) };
      }
    }
  }
}

export async function getWorkload() {
  // One row per distinct count, from the patientCount index alone: exact percentiles
  // without shipping every doctor to the API.
  const rows = await Doctor.aggregate<{ _id: number; doctors: number }>([
    { $sort: { patientCount: 1 } },
    { $group: { _id: "$patientCount", doctors: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const doctors = rows.reduce((sum, row) => sum + row.doctors, 0);
  const total = rows.reduce((sum, row) => sum + row._id * row.doctors, 0);
  const max = rows.at(-1)?._id ?? 0;

  const nearestRank = (p: number) => {
    const rank = Math.ceil(p * doctors);
    let seen = 0;
    for (const row of rows) {
      seen += row.doctors;
      if (seen >= rank) return row._id;
    }
    return 0;
  };

  const { width, count } = bucketLayout(max);
  const buckets = Array.from({ length: count }, (_, i) => ({
    min: i * width,
    max: (i + 1) * width - 1,
    doctors: 0,
  }));
  for (const row of rows) {
    const bucket = buckets[Math.floor(row._id / width)];
    if (bucket) bucket.doctors += row.doctors;
  }

  return {
    doctors,
    average: oneDecimal(total, doctors),
    median: nearestRank(0.5),
    p90: nearestRank(0.9),
    max,
    buckets,
  };
}

const DEMOGRAPHIC_GROUPS = {
  genders: [{ $group: { _id: "$gender", patients: { $sum: 1 } } }],
  ages: [
    {
      $bucket: {
        groupBy: "$age",
        boundaries: [...AGE_BOUNDARIES, 131],
        output: { patients: { $sum: 1 } },
      },
    },
  ],
};

/** Feeds both groupings from one pass. */
const DEMOGRAPHICS_FACET: PipelineStage = { $facet: DEMOGRAPHIC_GROUPS };

type DemographicsRow = {
  genders: { _id: string; patients: number }[];
  ages: { _id: number; patients: number }[];
};

function toDemographics(result: DemographicsRow | undefined) {
  const genderCounts = new Map(result?.genders.map((row) => [row._id, row.patients]));
  const ageCounts = new Map(result?.ages.map((row) => [row._id, row.patients]));
  return {
    genders: GENDERS.map((gender) => ({ gender, patients: genderCounts.get(gender) ?? 0 })),
    ageGroups: AGE_BOUNDARIES.map((lower, i) => ({
      group: AGE_LABELS[i] as string,
      patients: ageCounts.get(lower) ?? 0,
    })),
  };
}

export async function getDemographics() {
  const [result] = await Patient.aggregate<DemographicsRow>([DEMOGRAPHICS_FACET]);
  return toDemographics(result);
}

/** Each starts with equality on `doctor`, so it reads only that doctor's slice of an index. */
export function doctorAnalyticsPipelines(
  doctor: Types.ObjectId,
  firstDay: string,
  timezone: string,
  now = Date.now(),
) {
  return {
    conditions: [
      { $match: { doctor } },
      INDEX_ORDER.conditionRank,
      { $group: { _id: "$conditionRank", patients: { $sum: 1 } } },
    ],
    monthly: byLocalDay({ doctor }, firstDay, timezone),
    // Diagnoses ride on the documents this pass already fetches, so they cost no extra read.
    demographics: [
      { $match: { doctor } },
      {
        $facet: {
          ...DEMOGRAPHIC_GROUPS,
          diagnoses: [
            { $group: { _id: "$diagnosis", ...diagnosisCounts(now) } },
            { $sort: { patients: -1, _id: 1 } },
          ],
        },
      },
    ],
  } satisfies Record<string, PipelineStage[]>;
}

export async function getDoctorAnalytics(id: string, timezone: string) {
  const doctor = new Types.ObjectId(id);
  const { labels, firstDay } = calendar("12m", "month", timezone);
  const pipelines = doctorAnalyticsPipelines(doctor, firstDay, timezone);

  const [exists, conditionRows, monthlyRows, [demographics]] = await Promise.all([
    Doctor.exists({ _id: doctor }),
    Patient.aggregate<{ _id: number; patients: number }>(pipelines.conditions),
    Patient.aggregate<DayRow>(pipelines.monthly),
    Patient.aggregate<DemographicsRow & { diagnoses: DiagnosisRow[] }>(pipelines.demographics),
  ]);
  if (!exists) throw notFound("Doctor");

  const monthly = onLabels(monthlyRows, labels, firstDay);
  return {
    conditions: countsByCondition(new Map(conditionRows.map((row) => [row._id, row.patients]))),
    monthly: labels.map((month) => ({ month, patients: monthly.get(month) ?? 0 })),
    ...toDemographics(demographics),
    diagnoses: demographics?.diagnoses.map(toDiagnosisCount) ?? [],
  };
}
