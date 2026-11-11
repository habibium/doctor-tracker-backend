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

export const doctorFields = z.object({
  name: z.string().trim().min(2).max(120),
  specialization: z.string().trim().min(2).max(80),
  hospital: z.string().trim().min(2).max(120),
  phone,
  email: z.email().max(254),
});
export type DoctorFields = z.infer<typeof doctorFields>;

export const createDoctorBody = doctorFields.meta({ id: "CreateDoctor" });

export const updateDoctorBody = doctorFields
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update")
  .meta({ id: "UpdateDoctor" });
export type UpdateDoctorBody = z.infer<typeof updateDoctorBody>;

export const doctor = doctorFields
  .extend({
    id: objectId,
    patientCount: z.number().int(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .meta({ id: "Doctor" });
export type DoctorDto = z.infer<typeof doctor>;

export const doctorList = paginated(doctor).meta({ id: "DoctorList" });

export const DOCTOR_SORT_FIELDS = [
  "createdAt",
  "name",
  "specialization",
  "hospital",
  "patientCount",
] as const;
export type DoctorSortField = (typeof DOCTOR_SORT_FIELDS)[number];

export const listDoctorsQuery = z.object({
  ...paginationQuery,
  ...searchQuery,
  specialization: z.string().trim().min(1).optional(),
  hospital: z.string().trim().min(1).optional(),
  ...dateRangeQuery,
  sort: z
    .enum(sortParams(DOCTOR_SORT_FIELDS))
    .default("-createdAt")
    .meta({ description: "A leading `-` sorts descending" }),
});
export type ListDoctorsQuery = z.infer<typeof listDoctorsQuery>;

export const doctorFilters = z
  .object({
    specializations: z.array(z.string()),
    hospitals: z.array(z.string()),
  })
  .meta({ id: "DoctorFilters" });
