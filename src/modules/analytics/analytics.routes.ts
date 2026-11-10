import { defineRoute } from "../../lib/route.ts";
import {
  conditionBreakdown,
  demographics,
  patientsPerDoctor,
  registrations,
  registrationsQuery,
  specializationBreakdown,
  summary,
  summaryQuery,
  topDoctorsQuery,
} from "./analytics.schema.ts";
import * as analytics from "./analytics.service.ts";

const tag = "Analytics";

export const analyticsRoutes = [
  defineRoute({
    method: "get",
    path: "/analytics/summary",
    operationId: "getAnalyticsSummary",
    summary: "Headline totals and growth for the dashboard",
    tag,
    request: { query: summaryQuery },
    response: { status: 200, description: "Dashboard totals", schema: summary },
    errors: [400],
    handler: ({ query }) => analytics.getSummary(query.range),
  }),
  defineRoute({
    method: "get",
    path: "/analytics/registrations",
    operationId: "getRegistrations",
    summary: "Patients and doctors added per day or month",
    tag,
    request: { query: registrationsQuery },
    response: { status: 200, description: "A gap-free time series", schema: registrations },
    errors: [400],
    handler: ({ query }) => analytics.getRegistrations(query.range, query.timezone),
  }),
  defineRoute({
    method: "get",
    path: "/analytics/patients-per-doctor",
    operationId: "getPatientsPerDoctor",
    summary: "Doctors with the most patients",
    tag,
    request: { query: topDoctorsQuery },
    response: {
      status: 200,
      description: "Top doctors by patient count",
      schema: patientsPerDoctor,
    },
    errors: [400],
    handler: ({ query }) => analytics.getPatientsPerDoctor(query.limit),
  }),
  defineRoute({
    method: "get",
    path: "/analytics/conditions",
    operationId: "getConditionBreakdown",
    summary: "Patients by condition",
    tag,
    response: {
      status: 200,
      description: "Patient count per condition",
      schema: conditionBreakdown,
    },
    handler: () => analytics.getConditionBreakdown(),
  }),
  defineRoute({
    method: "get",
    path: "/analytics/specializations",
    operationId: "getSpecializationBreakdown",
    summary: "Doctors and patients by specialization",
    tag,
    response: {
      status: 200,
      description: "Doctor and patient counts per specialization",
      schema: specializationBreakdown,
    },
    handler: () => analytics.getSpecializationBreakdown(),
  }),
  defineRoute({
    method: "get",
    path: "/analytics/demographics",
    operationId: "getDemographics",
    summary: "Patients by gender and age group",
    tag,
    response: { status: 200, description: "Gender and age distribution", schema: demographics },
    handler: () => analytics.getDemographics(),
  }),
];
