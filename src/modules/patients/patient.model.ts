import { model, Schema, type Types } from "mongoose";
import { phoneTokens, tokenize } from "../../lib/search.ts";
import { GENDERS, PATIENT_CONDITIONS, type PatientFields } from "./patient.schema.ts";

export interface PatientAttrs extends PatientFields {
  doctor: Types.ObjectId;
  searchTokens: string[];
  createdAt: Date;
  updatedAt: Date;
}

// `satisfies` fails the build if a field is added to the Zod contract but not here.
const fields = {
  name: { type: String, required: true, trim: true },
  age: { type: Number, required: true, min: 0, max: 130 },
  gender: { type: String, required: true, enum: GENDERS },
  phone: { type: String, required: true, trim: true },
  condition: { type: String, required: true, enum: PATIENT_CONDITIONS },
  diagnosis: { type: String, required: true, trim: true },
} satisfies Record<keyof PatientFields, object>;

const patientSchema = new Schema<PatientAttrs>(
  {
    ...fields,
    doctor: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    searchTokens: { type: [String], select: false },
  },
  { timestamps: true },
);

patientSchema.index({ createdAt: -1, _id: -1 });
patientSchema.index({ doctor: 1, createdAt: -1, _id: -1 });
patientSchema.index({ condition: 1, createdAt: -1, _id: -1 });
patientSchema.index({ name: 1, _id: 1 });
patientSchema.index({ searchTokens: 1 });

export function patientSearchTokens(patient: PatientFields): string[] {
  return [...tokenize(patient.name, patient.diagnosis), ...phoneTokens(patient.phone)];
}

patientSchema.pre("save", function () {
  this.searchTokens = patientSearchTokens(this);
});

export const Patient = model<PatientAttrs>("Patient", patientSchema);
