import type { Types } from "mongoose";
import { notFound } from "../../lib/errors.ts";
import { countMatching, dateRange, page, sortSpec } from "../../lib/query.ts";
import { searchFilter } from "../../lib/search.ts";
import { Doctor } from "../doctors/doctor.model.ts";
import {
  decrementPatientCount,
  DOCTOR_SUMMARY,
  type DoctorSummary,
  findDoctorSummary,
  incrementPatientCount,
} from "../doctors/doctor.service.ts";
import {
  CONDITION_RANK,
  DOCTOR_INDEXES,
  Patient,
  PATIENT_SORTS,
  type PatientAttrs,
} from "./patient.model.ts";
import type {
  ListPatientsQuery,
  PatientDto,
  PatientFields,
  UpdatePatientBody,
} from "./patient.schema.ts";

type PatientRecord = Omit<PatientAttrs, "searchTokens" | "conditionRank" | "doctor"> & {
  _id: Types.ObjectId;
};

function toDto(doc: PatientRecord, doctor: DoctorSummary | null): PatientDto {
  return {
    id: String(doc._id),
    name: doc.name,
    age: doc.age,
    gender: doc.gender,
    phone: doc.phone,
    condition: doc.condition,
    diagnosis: doc.diagnosis,
    doctor: doctor && {
      id: String(doctor._id),
      name: doctor.name,
      specialization: doctor.specialization,
      hospital: doctor.hospital,
    },
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Keeps one doctor's list inside that doctor's index range. Left to the planner, a name plan
 * cached for a busy doctor would walk the whole name index for a quiet one until it replans.
 */
function doctorIndexFor(query: ListPatientsQuery) {
  const byCondition = query.condition !== undefined || query.sort.endsWith("condition");
  return byCondition ? DOCTOR_INDEXES.byCondition : DOCTOR_INDEXES.byDate;
}

export async function listPatients(query: ListPatientsQuery) {
  const createdAt = dateRange(query.from, query.to);
  const filter = {
    ...searchFilter(query.search),
    ...(query.doctorId && { doctor: query.doctorId }),
    ...(query.condition && { conditionRank: CONDITION_RANK[query.condition] }),
    ...(query.gender && { gender: query.gender }),
    ...(createdAt && { createdAt }),
  };

  const find = Patient.find(filter)
    .sort(sortSpec(PATIENT_SORTS, query.sort))
    .skip((query.page - 1) * query.limit)
    .limit(query.limit);
  if (query.doctorId) find.hint(doctorIndexFor(query));

  const [docs, total] = await Promise.all([
    find.populate<{ doctor: DoctorSummary | null }>("doctor", DOCTOR_SUMMARY).lean(),
    countMatching(Patient, filter),
  ]);

  return page(
    docs.map((doc) => toDto(doc, doc.doctor)),
    total,
    query,
  );
}

export async function listDoctorPatients(doctorId: string, query: ListPatientsQuery) {
  if (!(await Doctor.exists({ _id: doctorId }))) throw notFound("Doctor");
  return listPatients({ ...query, doctorId });
}

export async function getPatient(id: string) {
  const doc = await Patient.findById(id)
    .populate<{ doctor: DoctorSummary | null }>("doctor", DOCTOR_SUMMARY)
    .lean();
  if (!doc) throw notFound("Patient");
  return toDto(doc, doc.doctor);
}

// Each write changes the patient and the affected patientCount in one transaction. Concurrent
// writes for one doctor conflict on its document, so that write goes last to keep the window short.

export async function createPatient(doctorId: string, fields: PatientFields) {
  return Patient.db.transaction(async (session) => {
    const doc = await new Patient({ ...fields, doctor: doctorId }).save({ session });
    return toDto(doc, await incrementPatientCount(doctorId, session));
  });
}

export async function updatePatient(id: string, { doctorId, ...changes }: UpdatePatientBody) {
  return Patient.db.transaction(async (session) => {
    const doc = await Patient.findById(id).session(session);
    if (!doc) throw notFound("Patient");

    const previous = doc.doctor;
    const moving = doctorId !== undefined && !previous.equals(doctorId);
    // save() rather than updateOne() so the pre-save hook rebuilds the search tokens.
    doc.set({ ...changes, ...(moving && { doctor: doctorId }) });
    await doc.save({ session });

    if (!moving) return toDto(doc, await findDoctorSummary(previous, session));
    await decrementPatientCount(previous, session);
    return toDto(doc, await incrementPatientCount(doctorId, session));
  });
}

export async function deletePatient(id: string) {
  await removePatient({ _id: id });
}

export async function deleteDoctorPatient(doctorId: string, patientId: string) {
  await removePatient({ _id: patientId, doctor: doctorId });
}

async function removePatient(filter: { _id: string; doctor?: string }) {
  await Patient.db.transaction(async (session) => {
    const deleted = await Patient.findOneAndDelete(filter, {
      session,
      projection: "doctor",
    }).lean();
    if (!deleted) throw notFound("Patient");
    await decrementPatientCount(deleted.doctor, session);
  });
}
