import type { Types } from "mongoose";
import { conflict, notFound } from "../../lib/errors.ts";
import { countMatching, dateRange, page, SORTS } from "../../lib/query.ts";
import { searchFilter } from "../../lib/search.ts";
import { Patient } from "../patients/patient.model.ts";
import { Doctor, type DoctorAttrs } from "./doctor.model.ts";
import type {
  DoctorDto,
  DoctorFields,
  ListDoctorsQuery,
  UpdateDoctorBody,
} from "./doctor.schema.ts";

type DoctorRecord = Omit<DoctorAttrs, "searchTokens"> & { _id: Types.ObjectId };

function toDto(doc: DoctorRecord, patientCount: number): DoctorDto {
  return {
    id: String(doc._id),
    name: doc.name,
    specialization: doc.specialization,
    hospital: doc.hospital,
    phone: doc.phone,
    email: doc.email,
    patientCount,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** One indexed aggregation for the whole page instead of a count query per doctor. */
async function patientCounts(doctorIds: Types.ObjectId[]) {
  if (doctorIds.length === 0) return new Map<string, number>();
  const rows = await Patient.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { doctor: { $in: doctorIds } } },
    { $group: { _id: "$doctor", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

export async function listDoctors(query: ListDoctorsQuery) {
  const createdAt = dateRange(query.from, query.to);
  const filter = {
    ...searchFilter(query.search),
    ...(query.specialization && { specialization: query.specialization }),
    ...(query.hospital && { hospital: query.hospital }),
    ...(createdAt && { createdAt }),
  };

  const [docs, total] = await Promise.all([
    Doctor.find(filter)
      .sort(SORTS[query.sort])
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    countMatching(Doctor, filter),
  ]);

  const counts = await patientCounts(docs.map((doc) => doc._id));
  return page(
    docs.map((doc) => toDto(doc, counts.get(String(doc._id)) ?? 0)),
    total,
    query,
  );
}

export async function getDoctorFilters() {
  const [specializations, hospitals] = await Promise.all([
    Doctor.distinct("specialization"),
    Doctor.distinct("hospital"),
  ]);
  return { specializations: specializations.sort(), hospitals: hospitals.sort() };
}

export async function getDoctor(id: string) {
  const [doc, patientCount] = await Promise.all([
    Doctor.findById(id).lean(),
    Patient.countDocuments({ doctor: id }),
  ]);
  if (!doc) throw notFound("Doctor");
  return toDto(doc, patientCount);
}

export async function createDoctor(fields: DoctorFields) {
  const doc = await Doctor.create(fields);
  return toDto(doc, 0);
}

export async function updateDoctor(id: string, changes: UpdateDoctorBody) {
  const doc = await Doctor.findById(id);
  if (!doc) throw notFound("Doctor");

  // save() rather than updateOne() so the pre-save hook rebuilds the search tokens.
  doc.set(changes);
  await doc.save();
  return toDto(doc, await Patient.countDocuments({ doctor: id }));
}

export async function deleteDoctor(id: string) {
  if (!(await Doctor.exists({ _id: id }))) throw notFound("Doctor");
  if (await Patient.exists({ doctor: id })) {
    throw conflict("This doctor still has patients. Reassign or remove them first.");
  }
  await Doctor.deleteOne({ _id: id });
}
