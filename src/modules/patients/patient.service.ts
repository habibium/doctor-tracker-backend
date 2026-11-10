import type { Types } from "mongoose";
import { notFound } from "../../lib/errors.ts";
import { countMatching, dateRange, page, SORTS } from "../../lib/query.ts";
import { searchFilter } from "../../lib/search.ts";
import { Doctor, type DoctorAttrs } from "../doctors/doctor.model.ts";
import { Patient, type PatientAttrs } from "./patient.model.ts";
import type {
  ListPatientsQuery,
  PatientDto,
  PatientFields,
  UpdatePatientBody,
} from "./patient.schema.ts";

const DOCTOR_SUMMARY = "name specialization hospital";

type DoctorSummary = Pick<DoctorAttrs, "name" | "specialization" | "hospital"> & {
  _id: Types.ObjectId;
};

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

async function findDoctorSummary(doctorId: string | Types.ObjectId) {
  const doctor = await Doctor.findById(doctorId).select(DOCTOR_SUMMARY).lean();
  if (!doctor) throw notFound("Doctor");
  return doctor;
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

export async function createPatient(doctorId: string, fields: PatientFields) {
  const doctor = await findDoctorSummary(doctorId);
  const doc = await Patient.create({ ...fields, doctor: doctor._id });
  return toDto(doc, doctor);
}

export async function updatePatient(id: string, { doctorId, ...changes }: UpdatePatientBody) {
  const doc = await Patient.findById(id);
  if (!doc) throw notFound("Patient");

  const doctor = await findDoctorSummary(doctorId ?? doc.doctor);
  // save() rather than updateOne() so the pre-save hook rebuilds the search tokens.
  doc.set({ ...changes, doctor: doctor._id });
  await doc.save();
  return toDto(doc, doctor);
}

export async function deletePatient(id: string) {
  const deleted = await Patient.findByIdAndDelete(id).select("_id").lean();
  if (!deleted) throw notFound("Patient");
}

export async function deleteDoctorPatient(doctorId: string, patientId: string) {
  const deleted = await Patient.findOneAndDelete({ _id: patientId, doctor: doctorId })
    .select("_id")
    .lean();
  if (!deleted) throw notFound("Patient");
}
