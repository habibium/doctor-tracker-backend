/** Inclusive Dhaka calendar days. */
export interface Holiday {
  name: string;
  start: string;
  end: string;
}

/**
 * Bangladesh public holidays as observed, from the government lists for 2025 and 2026 and the
 * Eid breaks the cabinet extended (2025 Eid-ul-Adha to ten days; 2026 Eid-ul-Fitr and Eid-ul-Adha
 * to seven). Moon-dependent dates are the days announced by the moon sighting committee.
 */
export const HOLIDAYS: readonly Holiday[] = [
  { name: "Language Martyrs' Day", start: "2025-02-21", end: "2025-02-21" },
  { name: "Independence Day", start: "2025-03-26", end: "2025-03-26" },
  { name: "Eid-ul-Fitr", start: "2025-03-29", end: "2025-04-03" },
  { name: "Pohela Boishakh", start: "2025-04-14", end: "2025-04-14" },
  { name: "May Day", start: "2025-05-01", end: "2025-05-01" },
  { name: "Buddha Purnima", start: "2025-05-11", end: "2025-05-11" },
  { name: "Eid-ul-Adha", start: "2025-06-05", end: "2025-06-14" },
  { name: "Ashura", start: "2025-07-06", end: "2025-07-06" },
  { name: "July Mass Uprising Day", start: "2025-08-05", end: "2025-08-05" },
  { name: "Janmashtami", start: "2025-08-16", end: "2025-08-16" },
  { name: "Eid-e-Miladunnabi", start: "2025-09-05", end: "2025-09-05" },
  { name: "Durga Puja", start: "2025-10-01", end: "2025-10-02" },
  { name: "Victory Day", start: "2025-12-16", end: "2025-12-16" },
  { name: "Christmas Day", start: "2025-12-25", end: "2025-12-25" },
  { name: "Language Martyrs' Day", start: "2026-02-21", end: "2026-02-21" },
  { name: "Eid-ul-Fitr", start: "2026-03-17", end: "2026-03-23" },
  { name: "Independence Day", start: "2026-03-26", end: "2026-03-26" },
  { name: "Pohela Boishakh", start: "2026-04-14", end: "2026-04-14" },
  { name: "May Day and Buddha Purnima", start: "2026-05-01", end: "2026-05-01" },
  { name: "Eid-ul-Adha", start: "2026-05-25", end: "2026-05-31" },
  { name: "Ashura", start: "2026-06-26", end: "2026-06-26" },
  { name: "July Mass Uprising Day", start: "2026-08-05", end: "2026-08-05" },
  { name: "Eid-e-Miladunnabi", start: "2026-08-26", end: "2026-08-26" },
  { name: "Janmashtami", start: "2026-09-04", end: "2026-09-04" },
  { name: "Durga Puja", start: "2026-10-20", end: "2026-10-21" },
  { name: "Victory Day", start: "2026-12-16", end: "2026-12-16" },
  { name: "Christmas Day", start: "2026-12-25", end: "2026-12-25" },
];

export const holidaysBetween = (first: string, last: string) =>
  HOLIDAYS.filter((holiday) => holiday.end >= first && holiday.start <= last);

export const holidayOn = (day: string) =>
  HOLIDAYS.find((holiday) => holiday.start <= day && day <= holiday.end);
