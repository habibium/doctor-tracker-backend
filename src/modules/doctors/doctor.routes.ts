import { defineRoute } from "../../lib/route.ts";
import { idParams } from "../../lib/schemas.ts";
import {
  createDoctorBody,
  doctor,
  doctorFilters,
  doctorList,
  listDoctorsQuery,
  updateDoctorBody,
} from "./doctor.schema.ts";
import * as doctors from "./doctor.service.ts";

const tag = "Doctors";

export const doctorRoutes = [
  defineRoute({
    method: "get",
    path: "/doctors",
    operationId: "listDoctors",
    summary: "List doctors with search, filters and pagination",
    tag,
    request: { query: listDoctorsQuery },
    response: { status: 200, description: "A page of doctors", schema: doctorList },
    errors: [400],
    handler: ({ query }) => doctors.listDoctors(query),
  }),
  defineRoute({
    method: "post",
    path: "/doctors",
    operationId: "createDoctor",
    summary: "Create a doctor",
    tag,
    roles: ["admin"],
    request: { body: createDoctorBody },
    response: { status: 201, description: "The created doctor", schema: doctor },
    errors: [400, 409],
    handler: ({ body }) => doctors.createDoctor(body),
  }),
  // Registered before /doctors/{id} so "filters" is not read as an id.
  defineRoute({
    method: "get",
    path: "/doctors/filters",
    operationId: "getDoctorFilters",
    summary: "Distinct specializations and hospitals for filter controls",
    tag,
    response: { status: 200, description: "Available filter values", schema: doctorFilters },
    handler: () => doctors.getDoctorFilters(),
  }),
  defineRoute({
    method: "get",
    path: "/doctors/{id}",
    operationId: "getDoctor",
    summary: "Get a doctor",
    tag,
    request: { params: idParams },
    response: { status: 200, description: "The doctor", schema: doctor },
    errors: [400, 404],
    handler: ({ params }) => doctors.getDoctor(params.id),
  }),
  defineRoute({
    method: "patch",
    path: "/doctors/{id}",
    operationId: "updateDoctor",
    summary: "Update a doctor",
    tag,
    roles: ["admin"],
    request: { params: idParams, body: updateDoctorBody },
    response: { status: 200, description: "The updated doctor", schema: doctor },
    errors: [400, 404, 409],
    handler: ({ params, body }) => doctors.updateDoctor(params.id, body),
  }),
  defineRoute({
    method: "delete",
    path: "/doctors/{id}",
    operationId: "deleteDoctor",
    summary: "Delete a doctor who has no patients",
    tag,
    roles: ["admin"],
    request: { params: idParams },
    response: { status: 204, description: "Doctor deleted" },
    errors: [400, 404, 409],
    handler: ({ params }) => doctors.deleteDoctor(params.id),
  }),
];
