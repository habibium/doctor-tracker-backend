import { Types } from "mongoose";
import * as z from "zod";
import { createAuth, type Role } from "../auth/auth.ts";
import { env } from "../config/env.ts";
import { Doctor, doctorSearchTokens } from "../modules/doctors/doctor.model.ts";
import { Patient, patientSearchTokens } from "../modules/patients/patient.model.ts";
import { GENDERS, PATIENT_CONDITIONS } from "../modules/patients/patient.schema.ts";
import { connectDatabase, disconnectDatabase, ensureIndexes } from "./connection.ts";
import { FAMILY_NAMES, FEMALE_NAMES, HOSPITALS, MALE_NAMES, SPECIALIZATIONS } from "./seed-data.ts";

const DOCTOR_COUNT = 300;
const PATIENT_COUNT = 30_000;
const DAY_MS = 86_400_000;
const DHAKA_OFFSET_MS = 6 * 3_600_000;

type Gender = (typeof GENDERS)[number];
type Condition = (typeof PATIENT_CONDITIONS)[number];

const accounts = z
  .object({
    SEED_ADMIN_EMAIL: z.email().default("admin@doctortracker.dev"),
    SEED_ADMIN_PASSWORD: z.string().min(8).default("Admin@12345"),
    SEED_VIEWER_EMAIL: z.email().default("viewer@doctortracker.dev"),
    SEED_VIEWER_PASSWORD: z.string().min(8).default("Viewer@12345"),
  })
  .parse(process.env);

/** mulberry32: a fixed seed keeps names and proportions identical between runs. */
function createRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const random = createRandom(20261110);
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T;

function pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T {
  let remaining = random() * items.reduce((sum, item) => sum + weight(item), 0);
  for (const item of items) {
    remaining -= weight(item);
    if (remaining <= 0) return item;
  }
  return items.at(-1) as T;
}

const phone = () => `+8801${between(3, 9)}${String(between(0, 99_999_999)).padStart(8, "0")}`;
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const CONDITION_WEIGHTS: Record<Condition, number> = {
  stable: 46,
  recovering: 30,
  under_observation: 16,
  critical: 8,
};

/** Fewer registrations on Friday and Saturday, the weekend in Bangladesh. */
function isQuietDay(date: Date) {
  const day = new Date(date.getTime() + DHAKA_OFFSET_MS).getUTCDay();
  return (day === 5 && random() < 0.6) || (day === 6 && random() < 0.3);
}

function buildDoctors(now: number) {
  return Array.from({ length: DOCTOR_COUNT }, (_, index) => {
    const specialization = pickWeighted(SPECIALIZATIONS, (item) => item.weight);
    const hospital = pick(HOSPITALS);
    const given = pick(random() < 0.5 ? MALE_NAMES : FEMALE_NAMES);
    const family = pick(FAMILY_NAMES);
    const createdAt = new Date(now - between(1, 540) * DAY_MS - between(0, DAY_MS));

    const fields = {
      name: `${given} ${family}`,
      specialization: specialization.name,
      hospital,
      phone: phone(),
      // `.example` is reserved, so no seeded address can reach a real mailbox.
      email: `${slug(given)}.${slug(family)}${index + 1}@${slug(hospital)}.example`,
    };

    return {
      doctor: {
        _id: new Types.ObjectId(),
        ...fields,
        searchTokens: doctorSearchTokens(fields),
        createdAt,
        updatedAt: createdAt,
        __v: 0,
      },
      specialization,
      // Squared so a few doctors are far busier than the rest; scaled by tenure so each
      // doctor's intake rate stays steady and totals grow only as doctors join.
      popularity: (0.15 + random() ** 2 * 3) * (now - createdAt.getTime()),
    };
  });
}

function buildPatients(doctors: ReturnType<typeof buildDoctors>, now: number) {
  return Array.from({ length: PATIENT_COUNT }, () => {
    const { doctor, specialization } = pickWeighted(doctors, (item) => item.popularity);

    const earliest = doctor.createdAt.getTime();
    let createdAt = new Date(earliest + random() * (now - earliest));
    if (isQuietDay(createdAt))
      createdAt = new Date(Math.min(now, createdAt.getTime() + 2 * DAY_MS));

    const roll = random();
    const gender: Gender = specialization.femaleOnly
      ? "female"
      : roll < 0.49
        ? "male"
        : roll < 0.99
          ? "female"
          : "other";

    const fields = {
      name: `${pick(gender === "male" ? MALE_NAMES : FEMALE_NAMES)} ${pick(FAMILY_NAMES)}`,
      // Averaging two rolls clusters ages around the middle of the range.
      age: Math.round(
        (between(...specialization.ageRange) + between(...specialization.ageRange)) / 2,
      ),
      gender,
      phone: phone(),
      condition: pickWeighted(PATIENT_CONDITIONS, (item) => CONDITION_WEIGHTS[item]),
      diagnosis: pick(specialization.diagnoses),
    };

    return {
      _id: new Types.ObjectId(),
      ...fields,
      doctor: doctor._id,
      searchTokens: patientSearchTokens(fields),
      createdAt,
      updatedAt: createdAt,
      __v: 0,
    };
  });
}

const connection = await connectDatabase(env.MONGODB_URI);
const client = connection.getClient();
const users = client.db().collection("user");
const auth = createAuth(client, { allowSignUp: true });

async function ensureAccount(name: string, email: string, password: string, role: Role) {
  if (!(await users.findOne({ email }))) {
    await auth.api.signUpEmail({ body: { name, email, password } });
  }
  // Also refreshes the name, so re-running the seed renames existing demo accounts.
  await users.updateOne({ email }, { $set: { role, name } });
  console.log(`  ${role.padEnd(6)} ${email}`);
}

console.log("Accounts");
await ensureAccount(
  "Nadia Rahman",
  accounts.SEED_ADMIN_EMAIL,
  accounts.SEED_ADMIN_PASSWORD,
  "admin",
);
await ensureAccount(
  "Tareq Hasan",
  accounts.SEED_VIEWER_EMAIL,
  accounts.SEED_VIEWER_PASSWORD,
  "viewer",
);

await ensureIndexes();

const fresh = process.argv.includes("--fresh");
if (!fresh && (await Doctor.estimatedDocumentCount()) > 0) {
  console.log("Doctors already exist; pass --fresh to replace them.");
} else {
  await Promise.all([Doctor.deleteMany({}), Patient.deleteMany({})]);

  const now = Date.now();
  const doctors = buildDoctors(now);
  const patients = buildPatients(doctors, now);

  // The native driver keeps the backdated timestamps that Mongoose would overwrite.
  await Doctor.collection.insertMany(doctors.map((item) => item.doctor));
  for (let start = 0; start < patients.length; start += 5_000) {
    await Patient.collection.insertMany(patients.slice(start, start + 5_000));
  }
  console.log(`Seeded ${doctors.length} doctors and ${patients.length} patients.`);
}

await disconnectDatabase();
