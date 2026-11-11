import { Types } from "mongoose";
import { holidayOn } from "../modules/analytics/holidays.ts";
import { doctorSearchTokens } from "../modules/doctors/doctor.model.ts";
import { CONDITION_RANK, patientSearchTokens } from "../modules/patients/patient.model.ts";
import { GENDERS, PATIENT_CONDITIONS } from "../modules/patients/patient.schema.ts";
import {
  FAMILY_NAMES,
  FEMALE_NAMES,
  HOSPITALS,
  MALE_NAMES,
  SEASONS,
  SEVERITY,
  SPECIALIZATIONS,
} from "./seed-data.ts";

const DOCTOR_COUNT = 300;
const PATIENT_COUNT = 30_000;
/** Share of doctors already on the roster when the patient history starts. */
const FOUNDING_SHARE = 0.8;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DHAKA_OFFSET_MS = 6 * HOUR_MS;

type Gender = (typeof GENDERS)[number];
type Condition = (typeof PATIENT_CONDITIONS)[number];

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

const CONDITION_WEIGHTS: Record<"base" | "high" | "low", Record<Condition, number>> = {
  base: { stable: 46, recovering: 30, under_observation: 16, critical: 8 },
  high: { stable: 28, recovering: 32, under_observation: 22, critical: 18 },
  low: { stable: 64, recovering: 28, under_observation: 6, critical: 2 },
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

/** Clinics see a fraction of their usual intake on public holidays, least of all over Eid. */
function holidayFactor(day: string) {
  const holiday = holidayOn(day);
  if (!holiday) return 1;
  return holiday.name.startsWith("Eid-ul") ? 0.3 : 0.5;
}

function seasonFactor(diagnosis: string, year: number, month: number) {
  const season = SEASONS[diagnosis];
  if (!season) return 1;
  return (season.months[month] ?? 1) * (season.years?.[year] ?? 1);
}

function seasonCeiling(diagnosis: string) {
  const season = SEASONS[diagnosis];
  if (!season) return 1;
  return Math.max(...season.months) * Math.max(1, ...Object.values(season.years ?? {}));
}

/**
 * A registration time shaped by the diagnosis's season and by public holidays: candidates are
 * drawn as before and kept in proportion to both factors, so quiet days and months get fewer.
 */
function patientTime(diagnosis: string, earliest: number, latest: number) {
  const ceiling = seasonCeiling(diagnosis);
  let time = registrationTime(earliest, latest);
  for (let attempt = 0; attempt < 60; attempt++) {
    const local = new Date(time.getTime() + DHAKA_OFFSET_MS);
    const factor =
      seasonFactor(diagnosis, local.getUTCFullYear(), local.getUTCMonth()) *
      holidayFactor(local.toISOString().slice(0, 10));
    if (random() * ceiling < factor) return time;
    time = registrationTime(earliest, latest);
  }
  return time;
}

function buildDoctors(now: number, historyStart: number) {
  return Array.from({ length: DOCTOR_COUNT }, (_, index) => {
    const specialization = pickWeighted(SPECIALIZATIONS, (item) => item.weight);
    const hospital = pickWeighted(
      HOSPITALS,
      (item) => item.size * (item.focus?.includes(specialization.name) ? 3 : 1),
    ).name;
    const given = pick(random() < 0.5 ? MALE_NAMES : FEMALE_NAMES);
    const family = pick(FAMILY_NAMES);
    const createdAt =
      random() < FOUNDING_SHARE
        ? registrationTime(historyStart - 730 * DAY_MS, historyStart - DAY_MS)
        : registrationTime(historyStart, now - DAY_MS);

    const fields = {
      name: `${given} ${family}`,
      specialization: specialization.name,
      hospital,
      phone: phone(),
      // `.example` is reserved, so no seeded address can reach a real mailbox.
      email: `${slug(given)}.${slug(family)}${index + 1}@${slug(hospital)}.example`,
    };
    const activeFrom = Math.max(createdAt.getTime(), historyStart);

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
      activeFrom,
      // Squared so a few doctors are far busier than the rest; scaled by time in the history so
      // each doctor's intake rate stays steady and totals grow only as doctors join.
      popularity: (0.15 + random() ** 2 * 3) * (now - activeFrom),
    };
  });
}

function buildPatients(doctors: ReturnType<typeof buildDoctors>, now: number) {
  return Array.from({ length: PATIENT_COUNT }, () => {
    const { doctor, specialization, activeFrom } = pickWeighted(doctors, (item) => item.popularity);
    const diagnosis = pick(specialization.diagnoses);
    const createdAt = patientTime(diagnosis, activeFrom, now);

    const roll = random();
    const gender: Gender = specialization.femaleOnly
      ? "female"
      : roll < 0.49
        ? "male"
        : roll < 0.99
          ? "female"
          : "other";
    const weights = CONDITION_WEIGHTS[SEVERITY[diagnosis] ?? "base"];

    const fields = {
      name: `${pick(gender === "male" ? MALE_NAMES : FEMALE_NAMES)} ${pick(FAMILY_NAMES)}`,
      // Averaging two rolls clusters ages around the middle of the range.
      age: Math.round(
        (between(...specialization.ageRange) + between(...specialization.ageRange)) / 2,
      ),
      gender,
      phone: phone(),
      condition: pickWeighted(PATIENT_CONDITIONS, (item) => weights[item]),
      diagnosis,
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

/**
 * 300 doctors and 30,000 patients registered from 1 January of last year (Dhaka) to `now`, so
 * every month this year has the same month a year earlier to compare against. Each doctor
 * carries the exact `patientCount` of the patients generated for them.
 */
export function buildPopulation(now: number) {
  const dhakaYear = new Date(now + DHAKA_OFFSET_MS).getUTCFullYear();
  const historyStart = Date.UTC(dhakaYear - 1, 0, 1) - DHAKA_OFFSET_MS;

  const doctors = buildDoctors(now, historyStart);
  const patients = buildPatients(doctors, now);

  const patientCounts = new Map<Types.ObjectId, number>();
  for (const patient of patients) {
    patientCounts.set(patient.doctor, (patientCounts.get(patient.doctor) ?? 0) + 1);
  }

  return {
    doctors: doctors.map(({ doctor }) => ({
      ...doctor,
      patientCount: patientCounts.get(doctor._id) ?? 0,
    })),
    patients,
  };
}
