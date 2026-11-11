import { Types } from "mongoose";
import { createAuth } from "../auth/auth.ts";
import { env } from "../config/env.ts";
import { Doctor, doctorSearchTokens } from "../modules/doctors/doctor.model.ts";
import { CONDITION_RANK, Patient, patientSearchTokens } from "../modules/patients/patient.model.ts";
import { GENDERS, PATIENT_CONDITIONS } from "../modules/patients/patient.schema.ts";
import { connectDatabase, disconnectDatabase, syncIndexes } from "./connection.ts";
import { readSeedAccounts, seedAccounts } from "./seed-accounts.ts";
import { FAMILY_NAMES, FEMALE_NAMES, HOSPITALS, MALE_NAMES, SPECIALIZATIONS } from "./seed-data.ts";

const DOCTOR_COUNT = 300;
const PATIENT_COUNT = 30_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DHAKA_OFFSET_MS = 6 * HOUR_MS;

type Gender = (typeof GENDERS)[number];
type Condition = (typeof PATIENT_CONDITIONS)[number];

const accounts = readSeedAccounts();

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

/** Relative registrations per Dhaka hour, 00 to 23: a late-morning peak and a smaller evening one. */
// prettier-ignore
const INTAKE_BY_HOUR = [
  0.2, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 1.2,
  4, 8, 12, 13, 10, 7, 6, 6,
  7, 8.5, 9, 7.5, 4.5, 1.5, 0.6, 0.3,
];
const HOURS = INTAKE_BY_HOUR.map((_, hour) => hour);

/** Fewer registrations on Friday and Saturday, the weekend in Bangladesh. */
function isQuietDay(date: Date) {
  const day = new Date(date.getTime() + DHAKA_OFFSET_MS).getUTCDay();
  return (day === 5 && random() < 0.6) || (day === 6 && random() < 0.3);
}

/** A random day in the window, at a clinic hour in Dhaka. Draws outside the window are redrawn. */
function registrationTime(earliest: number, latest: number) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const instant = earliest + random() * (latest - earliest);
    let midnight = instant - ((instant + DHAKA_OFFSET_MS) % DAY_MS);
    if (isQuietDay(new Date(midnight))) midnight += 2 * DAY_MS;
    const hour = pickWeighted(HOURS, (item) => INTAKE_BY_HOUR[item] ?? 0);
    const time = midnight + (hour + random()) * HOUR_MS;
    if (time >= earliest && time <= latest) return new Date(time);
  }
  return new Date(earliest + random() * (latest - earliest));
}

function buildDoctors(now: number) {
  return Array.from({ length: DOCTOR_COUNT }, (_, index) => {
    const specialization = pickWeighted(SPECIALIZATIONS, (item) => item.weight);
    const hospital = pick(HOSPITALS);
    const given = pick(random() < 0.5 ? MALE_NAMES : FEMALE_NAMES);
    const family = pick(FAMILY_NAMES);
    const createdAt = registrationTime(now - 541 * DAY_MS, now - DAY_MS);

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

    const createdAt = registrationTime(doctor.createdAt.getTime(), now);

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
      conditionRank: CONDITION_RANK[fields.condition],
      searchTokens: patientSearchTokens(fields),
      createdAt,
      updatedAt: createdAt,
      __v: 0,
    };
  });
}

const connection = await connectDatabase(env.MONGODB_URI);
const client = connection.getClient();
await seedAccounts(createAuth(client), accounts);

await syncIndexes();

const fresh = process.argv.includes("--fresh");
if (!fresh && (await Doctor.estimatedDocumentCount()) > 0) {
  console.log("Doctors already exist; pass --fresh to replace them.");
} else {
  await Promise.all([Doctor.deleteMany({}), Patient.deleteMany({})]);

  const now = Date.now();
  const doctors = buildDoctors(now);
  const patients = buildPatients(doctors, now);

  const patientCounts = new Map<Types.ObjectId, number>();
  for (const patient of patients) {
    patientCounts.set(patient.doctor, (patientCounts.get(patient.doctor) ?? 0) + 1);
  }

  // The native driver keeps the backdated timestamps that Mongoose would overwrite.
  await Doctor.collection.insertMany(
    doctors.map(({ doctor }) => ({ ...doctor, patientCount: patientCounts.get(doctor._id) ?? 0 })),
  );
  for (let start = 0; start < patients.length; start += 5_000) {
    await Patient.collection.insertMany(patients.slice(start, start + 5_000));
  }
  console.log(`Seeded ${doctors.length} doctors and ${patients.length} patients.`);
}

await disconnectDatabase();
