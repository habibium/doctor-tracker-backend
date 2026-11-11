import type { ClientSession, Types } from "mongoose";
import { conflict, notFound } from "../../lib/errors.ts";
import { countMatching, dateRange, page, sortSpec } from "../../lib/query.ts";
import { searchFilter } from "../../lib/search.ts";
import { Doctor, DOCTOR_SORTS, type DoctorAttrs } from "./doctor.model.ts";
import type {
  DoctorDto,
  DoctorFields,
  ListDoctorsQuery,
  UpdateDoctorBody,
} from "./doctor.schema.ts";

export const DOCTOR_SUMMARY = "name specialization hospital";

type DoctorRecord = Omit<DoctorAttrs, "searchTokens"> & { _id: Types.ObjectId };

export type DoctorSummary = Pick<DoctorAttrs, "name" | "specialization" | "hospital"> & {
  _id: Types.ObjectId;
};

function toDto(doc: DoctorRecord): DoctorDto {
  return {
    id: String(doc._id),
    name: doc.name,
    specialization: doc.specialization,
    hospital: doc.hospital,
    phone: doc.phone,
    email: doc.email,
    patientCount: doc.patientCount,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
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
      .sort(sortSpec(DOCTOR_SORTS, query.sort))
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    countMatching(Doctor, filter),
  ]);

  return page(docs.map(toDto), total, query);
}

export async function getDoctorFilters() {
  const [specializations, hospitals] = await Promise.all([
    Doctor.distinct("specialization"),
    Doctor.distinct("hospital"),
  ]);
  return { specializations: specializations.sort(), hospitals: hospitals.sort() };
}

export async function getDoctor(id: string) {
  const doc = await Doctor.findById(id).lean();
  if (!doc) throw notFound("Doctor");
  return toDto(doc);
}

export async function createDoctor(fields: DoctorFields) {
  return toDto(await Doctor.create(fields));
}

export async function updateDoctor(id: string, changes: UpdateDoctorBody) {
  const doc = await Doctor.findById(id);
  if (!doc) throw notFound("Doctor");

  // save() rather than updateOne() so the pre-save hook rebuilds the search tokens.
  doc.set(changes);
  await doc.save();
  return toDto(doc);
}

export async function deleteDoctor(id: string) {
  // One conditional delete: a concurrent patient create either finds the doctor gone
  // (and aborts) or has already raised the count above zero.
  const { deletedCount } = await Doctor.deleteOne({ _id: id, patientCount: 0 });
  if (deletedCount === 1) return;
  if (!(await Doctor.exists({ _id: id }))) throw notFound("Doctor");
  throw conflict("This doctor still has patients. Reassign or remove them first.");
}

/** Runs inside the transaction that writes the patient; a 404 here aborts it. */
export async function incrementPatientCount(
  doctorId: string | Types.ObjectId,
  session: ClientSession,
): Promise<DoctorSummary> {
  const doctor = await Doctor.findByIdAndUpdate(
    doctorId,
    { $inc: { patientCount: 1 } },
    { session, projection: DOCTOR_SUMMARY },
  ).lean();
  if (!doctor) throw notFound("Doctor");
  return doctor;
}

/** A missing doctor is ignored, so a patient left without one can still be moved or removed. */
export async function decrementPatientCount(doctorId: Types.ObjectId, session: ClientSession) {
  await Doctor.updateOne({ _id: doctorId }, { $inc: { patientCount: -1 } }, { session });
}

export async function findDoctorSummary(
  doctorId: string | Types.ObjectId,
  session?: ClientSession,
): Promise<DoctorSummary> {
  const doctor = await Doctor.findById(doctorId, DOCTOR_SUMMARY, { session }).lean();
  if (!doctor) throw notFound("Doctor");
  return doctor;
}
