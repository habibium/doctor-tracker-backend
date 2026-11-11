import { model, Schema } from "mongoose";
import { phoneTokens, tokenize } from "../../lib/search.ts";
import type { DoctorFields } from "./doctor.schema.ts";

export interface DoctorAttrs extends DoctorFields {
  /** Changed only inside the transactions that write patients; `pnpm db:recount` repairs it. */
  patientCount: number;
  searchTokens: string[];
  createdAt: Date;
  updatedAt: Date;
}

// `satisfies` fails the build if a field is added to the Zod contract but not here.
const fields = {
  name: { type: String, required: true, trim: true },
  specialization: { type: String, required: true, trim: true },
  hospital: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
} satisfies Record<keyof DoctorFields, object>;

const doctorSchema = new Schema<DoctorAttrs>(
  {
    ...fields,
    patientCount: { type: Number, required: true, default: 0, min: 0 },
    searchTokens: { type: [String], select: false },
  },
  { timestamps: true },
);

doctorSchema.index({ email: 1 }, { unique: true });
doctorSchema.index({ createdAt: -1, _id: -1 });
doctorSchema.index({ specialization: 1, createdAt: -1, _id: -1 });
doctorSchema.index({ hospital: 1, createdAt: -1, _id: -1 });
doctorSchema.index({ name: 1, _id: 1 });
doctorSchema.index({ patientCount: 1, createdAt: -1, _id: -1 });
doctorSchema.index({ searchTokens: 1 });

export function doctorSearchTokens(doctor: DoctorFields): string[] {
  return [
    ...tokenize(doctor.name, doctor.specialization, doctor.hospital, doctor.email),
    ...phoneTokens(doctor.phone),
  ];
}

doctorSchema.pre("save", function () {
  this.searchTokens = doctorSearchTokens(this);
});

export const Doctor = model<DoctorAttrs>("Doctor", doctorSchema);
