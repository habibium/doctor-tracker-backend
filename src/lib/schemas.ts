import * as z from "zod";
import "zod-openapi";

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Must be a 24-character hex id");

export const idParams = z.object({ id: objectId });

export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{6,18}$/, "Must be a valid phone number");

export const timestamp = z.iso.datetime();

/** `YYYY-MM-DD` (whole UTC day) or a full ISO timestamp with offset. */
export const dateParam = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

export const dateRangeQuery = {
  from: dateParam.optional().meta({ description: "Created on or after this date" }),
  to: dateParam.optional().meta({ description: "Created on or before this date" }),
};

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
};

export const searchQuery = {
  search: z.string().trim().max(100).optional().meta({
    description: "Matches the start of any word; several words must all match",
  }),
};

export const paginationMeta = z
  .object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({ id: "PaginationMeta" });

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), meta: paginationMeta });

export const errorResponse = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    }),
  })
  .meta({ id: "ErrorResponse" });
