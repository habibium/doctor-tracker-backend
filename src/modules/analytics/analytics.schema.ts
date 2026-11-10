import * as z from "zod";
import { objectId } from "../../lib/schemas.ts";
import { gender, patientCondition } from "../patients/patient.schema.ts";

export const RANGES = ["7d", "30d", "90d", "12m"] as const;
export type Range = (typeof RANGES)[number];

const range = z.enum(RANGES).default("30d").meta({ description: "Reporting window ending now" });

function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const summaryQuery = z.object({ range });

export const registrationsQuery = z.object({
  range,
  timezone: z
    .string()
    .refine(isTimeZone, "Must be an IANA time zone such as Asia/Dhaka")
    .default("UTC")
    .meta({ description: "Time zone used to group records into days and months" }),
});

export const topDoctorsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export const summary = z
  .object({
    range: z.enum(RANGES),
    totalDoctors: z.number().int(),
    totalPatients: z.number().int(),
    averagePatientsPerDoctor: z.number(),
    criticalPatients: z.number().int(),
    newDoctors: z.number().int(),
    newPatients: z.number().int(),
    previousNewPatients: z
      .number()
      .int()
      .meta({ description: "New patients in the preceding window of the same length" }),
  })
  .meta({ id: "AnalyticsSummary" });

export const registrations = z
  .object({
    range: z.enum(RANGES),
    interval: z.enum(["day", "month"]),
    points: z.array(
      z.object({
        date: z.string().meta({ description: "YYYY-MM-DD for days, YYYY-MM for months" }),
        patients: z.number().int(),
        doctors: z.number().int(),
      }),
    ),
  })
  .meta({ id: "Registrations" });

export const patientsPerDoctor = z
  .array(
    z.object({
      doctorId: objectId,
      name: z.string(),
      specialization: z.string(),
      hospital: z.string(),
      patients: z.number().int(),
    }),
  )
  .meta({ id: "PatientsPerDoctor" });

export const conditionBreakdown = z
  .array(z.object({ condition: patientCondition, patients: z.number().int() }))
  .meta({ id: "ConditionBreakdown" });

export const specializationBreakdown = z
  .array(
    z.object({
      specialization: z.string(),
      doctors: z.number().int(),
      patients: z.number().int(),
    }),
  )
  .meta({ id: "SpecializationBreakdown" });

export const demographics = z
  .object({
    genders: z.array(z.object({ gender, patients: z.number().int() })),
    ageGroups: z.array(z.object({ group: z.string(), patients: z.number().int() })),
  })
  .meta({ id: "Demographics" });
