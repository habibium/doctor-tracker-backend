import type { Request, Response, Router } from "express";
import type * as z from "zod";
import type { AuthUser, Role } from "../auth/auth.ts";
import { forbidden, validationError } from "./errors.ts";

export type ErrorStatus = 400 | 404 | 409;

interface RequestSchemas {
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
}

type Parsed<T> = T extends z.ZodType ? z.output<T> : undefined;

interface RouteContext<TReq extends RequestSchemas> {
  params: Parsed<TReq["params"]>;
  query: Parsed<TReq["query"]>;
  body: Parsed<TReq["body"]>;
  user: AuthUser;
}

interface RouteConfig<TReq extends RequestSchemas, TRes extends z.ZodType | undefined> {
  method: "get" | "post" | "patch" | "delete";
  /** OpenAPI-style path under /api/v1, e.g. `/doctors/{id}`. */
  path: string;
  operationId: string;
  summary: string;
  tag: string;
  /** Omit to allow any signed-in user. */
  roles?: readonly Role[];
  request?: TReq;
  response: { status: 200 | 201 | 204; description: string; schema?: TRes };
  errors?: readonly ErrorStatus[];
  handler: (ctx: RouteContext<TReq>) => Promise<TRes extends z.ZodType ? z.input<TRes> : void>;
}

/** A route with its handler's input type erased, so differently-typed routes share one array. */
export interface Route extends Omit<RouteConfig<RequestSchemas, z.ZodType | undefined>, "handler"> {
  handler: (ctx: never) => Promise<unknown>;
}

/**
 * One definition drives three things: request validation, the typed handler input,
 * and the route's entry in the OpenAPI document.
 */
export function defineRoute<
  TReq extends RequestSchemas,
  TRes extends z.ZodType | undefined = undefined,
>(config: RouteConfig<TReq, TRes>): Route {
  return config;
}

export function mountRoutes(router: Router, routes: readonly Route[]) {
  for (const route of routes) {
    const expressPath = route.path.replace(/\{(\w+)\}/g, ":$1");

    router[route.method](expressPath, async (req: Request, res: Response) => {
      const user = res.locals.user as AuthUser;
      if (route.roles && !route.roles.includes(user.role)) throw forbidden();

      const { request } = route;
      const ctx = {
        params: request?.params && parse(request.params, req.params, "params"),
        query: request?.query && parse(request.query, req.query, "query"),
        body: request?.body && parse(request.body, req.body, "body"),
        user,
      };

      const result = await route.handler(ctx as never);
      if (route.response.status === 204) res.status(204).end();
      else res.status(route.response.status).json(result);
    });
  }
}

function parse(schema: z.ZodType, value: unknown, source: string) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw validationError(
    result.error.issues.map((issue) => ({
      path: [source, ...issue.path].join("."),
      message: issue.message,
    })),
  );
}
