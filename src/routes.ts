import type { Route } from "./lib/route.ts";
import { analyticsRoutes } from "./modules/analytics/analytics.routes.ts";
import { doctorRoutes } from "./modules/doctors/doctor.routes.ts";
import { doctorPatientRoutes, patientRoutes } from "./modules/patients/patient.routes.ts";
import { userRoutes } from "./modules/users/user.routes.ts";

export const API_PREFIX = "/api/v1";

export const routes: readonly Route[] = [
  ...doctorRoutes,
  ...doctorPatientRoutes,
  ...patientRoutes,
  ...analyticsRoutes,
  ...userRoutes,
];
