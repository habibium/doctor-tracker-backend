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
  await Promise.all([Doctor.createIndexes(), Patient.createIndexes(), ensureAuthIndexes()]);
}

/**
 * better-auth's MongoDB adapter builds none of its schema's indexes. These serve the
 * per-request session lookup and sign-in, and make emails unique; names follow its scheme.
 */
export async function ensureAuthIndexes() {
  const collection = (name: string) => mongoose.connection.collection(name);
  await Promise.all([
    collection("user").createIndex({ email: 1 }, { name: "user_email_uidx", unique: true }),
    collection("session").createIndex({ token: 1 }, { name: "session_token_uidx", unique: true }),
    collection("session").createIndex({ userId: 1 }, { name: "session_userId_idx" }),
    collection("account").createIndex({ userId: 1 }, { name: "account_userId_idx" }),
  ]);
}

/** Also drops indexes the schemas no longer define. For maintenance scripts, not startup. */
export async function syncIndexes() {
  await Promise.all([Doctor.syncIndexes(), Patient.syncIndexes()]);
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
