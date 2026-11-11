import { model, Schema, type Types } from "mongoose";
import type { SortSpec } from "../../lib/query.ts";
import { phoneTokens, tokenize } from "../../lib/search.ts";
import {
  type ConditionCounts,
  GENDERS,
  PATIENT_CONDITIONS,
  type PatientCondition,
  type PatientFields,
  type PatientSortField,
} from "./patient.schema.ts";

/** Severity order. Stored on each patient so one index serves the condition filter and sort. */
export const CONDITION_RANK = {
  stable: 1,
  recovering: 2,
  under_observation: 3,
  critical: 4,
} as const satisfies Record<PatientCondition, number>;

/** Zero-filled counts per condition from aggregation rows keyed by conditionRank. */
export function countsByCondition(byRank: ReadonlyMap<number, number>): ConditionCounts {
  return {
    stable: byRank.get(CONDITION_RANK.stable) ?? 0,
    recovering: byRank.get(CONDITION_RANK.recovering) ?? 0,
    under_observation: byRank.get(CONDITION_RANK.under_observation) ?? 0,
    critical: byRank.get(CONDITION_RANK.critical) ?? 0,
  };
}

export interface PatientAttrs extends PatientFields {
  doctor: Types.ObjectId;
  conditionRank: number;
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
    conditionRank: { type: Number, select: false },
    searchTokens: { type: [String], select: false },
  },
  { timestamps: true },
);

patientSchema.index({ createdAt: -1, _id: -1 });
patientSchema.index({ doctor: 1, createdAt: -1, _id: -1 });
// Also covers per-doctor condition counts, which read only these two keys.
patientSchema.index({ doctor: 1, conditionRank: 1, createdAt: -1, _id: -1 });
patientSchema.index({ conditionRank: 1, createdAt: -1, _id: -1 });
patientSchema.index({ name: 1, _id: 1 });
patientSchema.index({ age: 1, createdAt: -1, _id: -1 });
patientSchema.index({ searchTokens: 1 });

/** Each sort is the order of one index above, so an unfiltered page never sorts in memory. */
export const PATIENT_SORTS = {
  createdAt: { createdAt: 1, _id: 1 },
  name: { name: 1, _id: 1 },
  age: { age: 1, createdAt: -1, _id: -1 },
  condition: { conditionRank: 1, createdAt: -1, _id: -1 },
} satisfies Record<PatientSortField, SortSpec>;

export function patientSearchTokens(patient: PatientFields): string[] {
  return [...tokenize(patient.name, patient.diagnosis), ...phoneTokens(patient.phone)];
}

patientSchema.pre("save", function () {
  this.searchTokens = patientSearchTokens(this);
  this.conditionRank = CONDITION_RANK[this.condition];
});

export const Patient = model<PatientAttrs>("Patient", patientSchema);
