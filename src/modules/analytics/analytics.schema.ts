import * as z from "zod";
import { objectId } from "../../lib/schemas.ts";
import { conditionCounts, gender, patientCondition } from "../patients/patient.schema.ts";

export const RANGES = ["7d", "30d", "90d", "12m"] as const;
export type Range = (typeof RANGES)[number];

export const INTERVALS = ["auto", "day", "month"] as const;
export type Interval = (typeof INTERVALS)[number];

export const GROUPINGS = ["specialization", "hospital"] as const;
export type Grouping = (typeof GROUPINGS)[number];

const rangeQuery = (fallback: Range) =>
  z.enum(RANGES).default(fallback).meta({ description: "Reporting window ending now" });

function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const timezoneQuery = (description: string) =>
  z
    .string()
    .refine(isTimeZone, "Must be an IANA time zone such as Asia/Dhaka")
    .default("UTC")
    .meta({ description });

const count = z.number().int();

export const summaryQuery = z.object({ range: rangeQuery("30d") });

export const registrationsQuery = z.object({
  range: rangeQuery("30d"),
  interval: z
    .enum(INTERVALS)
    .default("auto")
    .meta({ description: "`auto` groups 12m by month and shorter ranges by day" }),
  timezone: timezoneQuery("Time zone used to group records into days and months"),
});

export const intakeHoursQuery = z.object({
  range: rangeQuery("90d"),
  timezone: timezoneQuery("Time zone used to read each registration's weekday and hour"),
});

export const conditionMixQuery = z.object({
  by: z.enum(GROUPINGS).default("specialization"),
});

export const topDoctorsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(10),
  condition: patientCondition
    .optional()
    .meta({ description: "Rank by patients in this condition only" }),
});

export const diagnosesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

const diagnosisName = z.string().trim().min(1).max(200);

export const diagnosisTrendsQuery = z.object({
  // A single `?diagnosis=` arrives as a string; repeated ones arrive as an array.
  diagnosis: z
    .preprocess((value) => (typeof value === "string" ? [value] : value), z.array(diagnosisName))
    .pipe(z.array(diagnosisName).min(1).max(12))
    .meta({
      description: "Exact diagnoses to chart; repeat the parameter for each, up to 12",
      param: { required: true },
      override: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 12 },
    }),
  timezone: timezoneQuery("Time zone used to group patients into calendar months"),
});

export const doctorAnalyticsQuery = z.object({
  timezone: timezoneQuery("Time zone used to group patients into months"),
});

export const summary = z
  .object({
    range: z.enum(RANGES),
    totalDoctors: count,
    totalPatients: count,
    averagePatientsPerDoctor: z.number(),
    criticalPatients: count,
    newDoctors: count,
    previousNewDoctors: count.meta({
      description: "Doctors added in the preceding window of the same length",
    }),
    newPatients: count,
    previousNewPatients: count.meta({
      description: "New patients in the preceding window of the same length",
    }),
  })
  .meta({ id: "AnalyticsSummary" });

export const holiday = z
  .object({
    name: z.string(),
    start: z.iso.date().meta({ description: "First day, inclusive" }),
    end: z.iso.date().meta({ description: "Last day, inclusive" }),
  })
  .meta({ id: "Holiday" });

export const registrations = z
  .object({
    range: z.enum(RANGES),
    interval: z.enum(["day", "month"]),
    points: z.array(
      z.object({
        date: z.string().meta({ description: "YYYY-MM-DD for days, YYYY-MM for months" }),
        patients: count,
        doctors: count,
      }),
    ),
    holidays: z.array(holiday).meta({
      description: "Bangladesh public holidays (Dhaka calendar days) that overlap the window",
    }),
  })
  .meta({ id: "Registrations" });

export const intakeHours = z
  .object({
    range: z.enum(RANGES),
    cells: z
      .array(
        z.object({
          weekday: count.min(0).max(6).meta({ description: "0 is Sunday" }),
          hour: count.min(0).max(23),
          patients: count,
        }),
      )
      .meta({ description: "All 168 cells, Sunday 00:00 first, then by hour" }),
    max: count.meta({ description: "The largest cell, for scaling a heatmap" }),
  })
  .meta({ id: "IntakeHours" });

export const patientsPerDoctor = z
  .array(
    z.object({
      doctorId: objectId,
      name: z.string(),
      specialization: z.string(),
      hospital: z.string(),
      patients: count,
    }),
  )
  .meta({ id: "PatientsPerDoctor" });

export const conditionBreakdown = z
  .array(z.object({ condition: patientCondition, patients: count }))
  .meta({ id: "ConditionBreakdown" });

export const conditionMix = z
  .array(
    z.object({
      key: z.string().meta({ description: "The specialization or hospital" }),
      doctors: count,
      patients: count,
      ...conditionCounts.shape,
    }),
  )
  .meta({ id: "ConditionMix" });

export const coverage = z
  .object({
    hospitals: z
      .array(z.object({ name: z.string(), doctors: count, patients: count }))
      .meta({ description: "Most doctors first" }),
    specializations: z
      .array(
        z.object({
          name: z.string(),
          doctors: count,
          patients: count,
          hospitals: count.meta({ description: "Hospitals with at least one such doctor" }),
        }),
      )
      .meta({ description: "Most doctors first" }),
    cells: z
      .array(
        z.object({
          hospital: z.string(),
          specialization: z.string(),
          doctors: count,
          patients: count,
        }),
      )
      .meta({ description: "Only pairs with at least one doctor; any other pair is a gap" }),
  })
  .meta({ id: "Coverage" });

export const diagnosisCount = z
  .object({
    diagnosis: z.string(),
    patients: count,
    last30Days: count.meta({ description: "Registered in the last 30 days" }),
    previous30Days: count.meta({ description: "Registered in the 30 days before those" }),
  })
  .meta({ id: "DiagnosisCount" });

export const diagnosisRanking = z
  .array(diagnosisCount)
  .meta({ id: "DiagnosisRanking", description: "Most patients first" });

const monthlyCounts = (description: string) => z.array(count).meta({ description });

export const diagnosisTrends = z
  .object({
    year: count.meta({ description: "The current calendar year in the requested time zone" }),
    month: count.min(1).max(12).meta({ description: "The current month, 1 to 12, still running" }),
    series: z.array(
      z.object({
        diagnosis: z.string(),
        thisYear: monthlyCounts("New patients from January to the current month"),
        lastYear: monthlyCounts("New patients in each month of last year, January to December"),
      }),
    ),
    allPatients: z
      .object({
        thisYear: monthlyCounts("All new patients from January to the current month"),
        lastYear: monthlyCounts("All new patients in each month of last year"),
      })
      .meta({ description: "Every diagnosis together, the baseline for growth" }),
  })
  .meta({ id: "DiagnosisTrends" });

export const specializationBreakdown = z
  .array(z.object({ specialization: z.string(), doctors: count, patients: count }))
  .meta({ id: "SpecializationBreakdown" });

export const workload = z
  .object({
    doctors: count,
    average: z.number(),
    median: count,
    p90: count.meta({ description: "Nearest-rank 90th percentile" }),
    max: count,
    buckets: z.array(z.object({ min: count, max: count, doctors: count })).meta({
      description: "8 to 12 equal-width bins from 0 up to the busiest doctor; bounds inclusive",
    }),
  })
  .meta({ id: "Workload" });

const genderCounts = z.array(z.object({ gender, patients: count }));
const ageGroupCounts = z.array(z.object({ group: z.string(), patients: count }));

export const demographics = z
  .object({ genders: genderCounts, ageGroups: ageGroupCounts })
  .meta({ id: "Demographics" });

export const doctorAnalytics = z
  .object({
    conditions: conditionCounts,
    monthly: z
      .array(z.object({ month: z.string().meta({ description: "YYYY-MM" }), patients: count }))
      .meta({ description: "The last 12 calendar months, oldest first" }),
    ageGroups: ageGroupCounts,
    genders: genderCounts,
    diagnoses: z
      .array(diagnosisCount)
      .meta({ description: "All of the doctor's diagnoses, most patients first" }),
  })
  .meta({ id: "DoctorAnalytics" });
