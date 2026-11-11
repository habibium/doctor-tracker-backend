import type { PipelineStage, Types } from "mongoose";
import { Doctor } from "../doctors/doctor.model.ts";
import { CONDITION_RANK, Patient } from "../patients/patient.model.ts";
import { GENDERS, PATIENT_CONDITIONS } from "../patients/patient.schema.ts";
import type { Range } from "./analytics.schema.ts";

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 };

/**
 * Sorting by an indexed field before $group lets MongoDB answer from the index alone
 * (a covered scan, zero documents read) instead of scanning the whole collection.
 */
const INDEX_ORDER = {
  doctor: { $sort: { doctor: 1 } },
  conditionRank: { $sort: { conditionRank: 1 } },
} satisfies Record<string, PipelineStage>;

const AGE_BOUNDARIES = [0, 13, 18, 31, 46, 61] as const;
const AGE_LABELS = ["0-12", "13-17", "18-30", "31-45", "46-60", "61+"];

export async function getSummary(range: Range) {
  const span = RANGE_DAYS[range] * DAY_MS;
  const now = Date.now();
  const start = new Date(now - span);
  const previousStart = new Date(now - 2 * span);

  const [
    totalDoctors,
    totalPatients,
    criticalPatients,
    newDoctors,
    newPatients,
    previousNewPatients,
  ] = await Promise.all([
    Doctor.estimatedDocumentCount(),
    Patient.estimatedDocumentCount(),
    Patient.countDocuments({ conditionRank: CONDITION_RANK.critical }),
    Doctor.countDocuments({ createdAt: { $gte: start } }),
    Patient.countDocuments({ createdAt: { $gte: start } }),
    Patient.countDocuments({ createdAt: { $gte: previousStart, $lt: start } }),
  ]);

  return {
    range,
    totalDoctors,
    totalPatients,
    averagePatientsPerDoctor: totalDoctors
      ? Math.round((totalPatients / totalDoctors) * 10) / 10
      : 0,
    criticalPatients,
    newDoctors,
    newPatients,
    previousNewPatients,
  };
}

/** Calendar buckets ending today in the caller's time zone, oldest first. */
function buckets(range: Range, timeZone: string) {
  const [year = 0, month = 0, day = 0] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);

  if (range === "12m") {
    const labels = Array.from({ length: 12 }, (_, i) =>
      new Date(Date.UTC(year, month - 12 + i, 1)).toISOString().slice(0, 7),
    );
    return { interval: "month" as const, format: "%Y-%m", labels, first: `${labels[0]}-01` };
  }

  const days = RANGE_DAYS[range];
  const labels = Array.from({ length: days }, (_, i) =>
    new Date(Date.UTC(year, month - 1, day - days + 1 + i)).toISOString().slice(0, 10),
  );
  return { interval: "day" as const, format: "%Y-%m-%d", labels, first: labels[0] as string };
}

export async function getRegistrations(range: Range, timezone: string) {
  const { interval, format, labels, first } = buckets(range, timezone);

  // UTC midnight minus the largest zone offset (+14h) is at or before the first local bucket;
  // rows that land in an earlier bucket are dropped when mapping onto `labels`.
  const since = new Date(Date.parse(first) - 14 * 3_600_000);
  const pipeline: PipelineStage[] = [
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { date: "$createdAt", format, timezone } },
        count: { $sum: 1 },
      },
    },
  ];

  type Row = { _id: string; count: number };
  const [patients, doctors] = await Promise.all([
    Patient.aggregate<Row>(pipeline),
    Doctor.aggregate<Row>(pipeline),
  ]);
  const patientCounts = new Map(patients.map((row) => [row._id, row.count]));
  const doctorCounts = new Map(doctors.map((row) => [row._id, row.count]));

  return {
    range,
    interval,
    points: labels.map((date) => ({
      date,
      patients: patientCounts.get(date) ?? 0,
      doctors: doctorCounts.get(date) ?? 0,
    })),
  };
}

export async function getPatientsPerDoctor(limit: number) {
  const rows = await Patient.aggregate<{
    _id: Types.ObjectId;
    patients: number;
    doctor: { name: string; specialization: string; hospital: string };
  }>([
    INDEX_ORDER.doctor,
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
  ]);

  return rows.map((row) => ({
    doctorId: String(row._id),
    name: row.doctor.name,
    specialization: row.doctor.specialization,
    hospital: row.doctor.hospital,
    patients: row.patients,
  }));
}

export async function getConditionBreakdown() {
  const rows = await Patient.aggregate<{ _id: number; patients: number }>([
    INDEX_ORDER.conditionRank,
    { $group: { _id: "$conditionRank", patients: { $sum: 1 } } },
  ]);
  const counts = new Map(rows.map((row) => [row._id, row.patients]));
  return PATIENT_CONDITIONS.map((condition) => ({
    condition,
    patients: counts.get(CONDITION_RANK[condition]) ?? 0,
  }));
}

export async function getSpecializationBreakdown() {
  type Row = { _id: string; count: number };
  const [doctors, patients] = await Promise.all([
    Doctor.aggregate<Row>([{ $group: { _id: "$specialization", count: { $sum: 1 } } }]),
    Patient.aggregate<Row>([
      INDEX_ORDER.doctor,
      // Collapse to one row per doctor first, so the join runs per doctor, not per patient.
      { $group: { _id: "$doctor", count: { $sum: 1 } } },
      {
        $lookup: {
          from: Doctor.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "doctor",
          pipeline: [{ $project: { specialization: 1 } }],
        },
      },
      { $unwind: "$doctor" },
      { $group: { _id: "$doctor.specialization", count: { $sum: "$count" } } },
    ]),
  ]);
  const patientCounts = new Map(patients.map((row) => [row._id, row.count]));

  return doctors
    .map((row) => ({
      specialization: row._id,
      doctors: row.count,
      patients: patientCounts.get(row._id) ?? 0,
    }))
    .sort((a, b) => b.patients - a.patients || a.specialization.localeCompare(b.specialization));
}

export async function getDemographics() {
  // $facet feeds both groupings from a single pass over the collection.
  const [result] = await Patient.aggregate<{
    genders: { _id: string; patients: number }[];
    ages: { _id: number; patients: number }[];
  }>([
    {
      $facet: {
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
      },
    },
  ]);

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
