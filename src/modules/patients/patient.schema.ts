import * as z from "zod";
import {
  dateRangeQuery,
  objectId,
  paginated,
  paginationQuery,
  phone,
  searchQuery,
  timestamp,
} from "../../lib/schemas.ts";
import { sortParams } from "../../lib/query.ts";

export const PATIENT_CONDITIONS = [
  "stable",
  "recovering",
  "under_observation",
  "critical",
] as const;
export const GENDERS = ["male", "female", "other"] as const;

export const patientCondition = z.enum(PATIENT_CONDITIONS).meta({ id: "PatientCondition" });
export type PatientCondition = z.infer<typeof patientCondition>;
export const gender = z.enum(GENDERS).meta({ id: "Gender" });

export const patientFields = z.object({
  name: z.string().trim().min(2).max(120),
  age: z.number().int().min(0).max(130),
  gender,
  phone,
  condition: patientCondition,
  diagnosis: z.string().trim().min(2).max(200),
});
export type PatientFields = z.infer<typeof patientFields>;

/** Used under `/doctors/{id}/patients`, where the doctor comes from the path. */
export const createDoctorPatientBody = patientFields.meta({ id: "CreateDoctorPatient" });

export const createPatientBody = patientFields
  .extend({ doctorId: objectId })
  .meta({ id: "CreatePatient" });

export const updatePatientBody = patientFields
  .extend({ doctorId: objectId })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update")
  .meta({ id: "UpdatePatient" });
export type UpdatePatientBody = z.infer<typeof updatePatientBody>;

export const patientDoctor = z
  .object({
    id: objectId,
    name: z.string(),
    specialization: z.string(),
    hospital: z.string(),
  })
  .meta({ id: "PatientDoctor" });

export const patient = patientFields
  .extend({
    id: objectId,
    doctor: patientDoctor.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .meta({ id: "Patient" });
export type PatientDto = z.infer<typeof patient>;

export const patientList = paginated(patient).meta({ id: "PatientList" });

export const PATIENT_SORT_FIELDS = ["createdAt", "name", "age", "condition"] as const;
export type PatientSortField = (typeof PATIENT_SORT_FIELDS)[number];

const patientFilters = {
  ...paginationQuery,
  ...searchQuery,
  condition: patientCondition.optional(),
  gender: gender.optional(),
  ...dateRangeQuery,
  sort: z.enum(sortParams(PATIENT_SORT_FIELDS)).default("-createdAt").meta({
    description:
      "A leading `-` sorts descending. `condition` sorts by severity, so `-condition` lists critical first",
  }),
};

export const listPatientsQuery = z.object({ ...patientFilters, doctorId: objectId.optional() });
export type ListPatientsQuery = z.infer<typeof listPatientsQuery>;

export const listDoctorPatientsQuery = z.object(patientFilters);

export const doctorPatientParams = z.object({ id: objectId, patientId: objectId });
