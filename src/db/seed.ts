import { createAuth } from "../auth/auth.ts";
import { env } from "../config/env.ts";
import { Doctor } from "../modules/doctors/doctor.model.ts";
import { Patient } from "../modules/patients/patient.model.ts";
import { connectDatabase, disconnectDatabase, syncIndexes } from "./connection.ts";
import { buildPopulation } from "./seed-population.ts";
import { readSeedAccounts, seedAccounts } from "./seed-accounts.ts";

const accounts = readSeedAccounts();

const connection = await connectDatabase(env.MONGODB_URI);
const client = connection.getClient();
await seedAccounts(createAuth(client), accounts);

await syncIndexes();

const fresh = process.argv.includes("--fresh");
if (!fresh && (await Doctor.estimatedDocumentCount()) > 0) {
  console.log("Doctors already exist; pass --fresh to replace them.");
} else {
  await Promise.all([Doctor.deleteMany({}), Patient.deleteMany({})]);

  const { doctors, patients } = buildPopulation(Date.now());

  // The native driver keeps the backdated timestamps that Mongoose would overwrite.
  await Doctor.collection.insertMany(doctors);
  for (let start = 0; start < patients.length; start += 5_000) {
    await Patient.collection.insertMany(patients.slice(start, start + 5_000));
  }
  console.log(`Seeded ${doctors.length} doctors and ${patients.length} patients.`);
}

await disconnectDatabase();
