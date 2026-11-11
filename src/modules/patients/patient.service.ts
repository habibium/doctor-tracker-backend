import type { Types } from "mongoose";
import { notFound } from "../../lib/errors.ts";
import { countMatching, dateRange, page, SORTS } from "../../lib/query.ts";
import { searchFilter } from "../../lib/search.ts";
import { Doctor } from "../doctors/doctor.model.ts";
import {
  decrementPatientCount,
  DOCTOR_SUMMARY,
  type DoctorSummary,
  findDoctorSummary,
  incrementPatientCount,
} from "../doctors/doctor.service.ts";
import { Patient, type PatientAttrs } from "./patient.model.ts";
import type {
  ListPatientsQuery,
  PatientDto,
  PatientFields,
  UpdatePatientBody,
} from "./patient.schema.ts";

type PatientRecord = Omit<PatientAttrs, "searchTokens" | "doctor"> & { _id: Types.ObjectId };

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

export async function listPatients(query: ListPatientsQuery) {
  const createdAt = dateRange(query.from, query.to);
  const filter = {
    ...searchFilter(query.search),
    ...(query.doctorId && { doctor: query.doctorId }),
    ...(query.condition && { condition: query.condition }),
    ...(query.gender && { gender: query.gender }),
    ...(createdAt && { createdAt }),
  };

  const [docs, total] = await Promise.all([
    Patient.find(filter)
      .sort(SORTS[query.sort])
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .populate<{ doctor: DoctorSummary | null }>("doctor", DOCTOR_SUMMARY)
      .lean(),
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
