import mongoose from "mongoose";
import { Doctor } from "../modules/doctors/doctor.model.ts";
import { Patient } from "../modules/patients/patient.model.ts";

export async function connectDatabase(uri: string) {
  // A filter on a path missing from the schema is a bug, not something to drop silently.
  mongoose.set("strictQuery", "throw");
  // Indexes are built explicitly in ensureIndexes(), so startup can await them.
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10_000 });
  return mongoose.connection;
}

/** Idempotent: existing indexes are left alone. */
export async function ensureIndexes() {
  await Promise.all([Doctor.createIndexes(), Patient.createIndexes()]);
}

/** Also drops indexes the schemas no longer define. For maintenance scripts, not startup. */
export async function syncIndexes() {
  await Promise.all([Doctor.syncIndexes(), Patient.syncIndexes()]);
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
