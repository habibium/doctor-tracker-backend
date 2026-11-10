import { createDocument, type ZodOpenApiObject, type ZodOpenApiPathsObject } from "zod-openapi";
import type { ErrorStatus, Route } from "../lib/route.ts";
import { errorResponse } from "../lib/schemas.ts";
import { API_PREFIX } from "../routes.ts";

type DocumentedStatus = ErrorStatus | 401 | 403;

const ERROR_DESCRIPTIONS: Record<DocumentedStatus, string> = {
  400: "The request failed validation",
  401: "Not signed in",
  403: "Signed in, but not allowed to do this",
  404: "The resource does not exist",
  409: "The request conflicts with existing data",
};

const errorContent = { "application/json": { schema: errorResponse } };

export function buildOpenApiDocument(routes: readonly Route[]) {
  const paths: ZodOpenApiPathsObject = {};

  for (const route of routes) {
    const { request, response } = route;
    const statuses: DocumentedStatus[] = [...(route.errors ?? []), 401];
    if (route.roles) statuses.push(403);

    paths[`${API_PREFIX}${route.path}`] = {
      ...paths[`${API_PREFIX}${route.path}`],
      [route.method]: {
        operationId: route.operationId,
        summary: route.summary,
        tags: [route.tag],
        // zod-openapi reads every key it is given, so absent schemas must be left out entirely.
        requestParams: {
          ...(request?.params && { path: request.params }),
          ...(request?.query && { query: request.query }),
        },
        ...(request?.body && {
          requestBody: {
            required: true,
            content: { "application/json": { schema: request.body } },
          },
        }),
        responses: {
          [response.status]: {
            description: response.description,
            ...(response.schema && {
              content: { "application/json": { schema: response.schema } },
            }),
          },
          ...Object.fromEntries(
            statuses.map((status) => [
              status,
              { description: ERROR_DESCRIPTIONS[status], content: errorContent },
            ]),
          ),
        },
      },
    };
  }

  return createDocument(spec(paths), {
    // Drop Zod's generated date regexes and safe-integer bounds; `format` and `type` already say it.
    override: ({ jsonSchema }) => {
      if (jsonSchema.format === "date" || jsonSchema.format === "date-time") {
        delete jsonSchema.pattern;
      }
      if (jsonSchema.maximum === Number.MAX_SAFE_INTEGER) delete jsonSchema.maximum;
      if (jsonSchema.minimum === Number.MIN_SAFE_INTEGER) delete jsonSchema.minimum;
    },
  });
}

function spec(paths: ZodOpenApiPathsObject): ZodOpenApiObject {
  return {
    openapi: "3.1.0",
    info: {
      title: "Doctor Tracker API",
      version: "1.0.0",
      description:
        "Manage doctors and their patients, and read dashboard analytics. " +
        "Every endpoint needs a session cookie: sign in through `POST /api/auth/sign-in/email`. " +
        "Endpoints that change data need the `admin` role.",
    },
    servers: [{ url: "/" }],
    security: [{ sessionCookie: [] }],
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description:
            "Set by the sign-in endpoint. Named `__Secure-better-auth.session_token` over HTTPS.",
        },
      },
    },
  };
}
