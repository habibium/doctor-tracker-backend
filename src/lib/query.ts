import type { Model } from "mongoose";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A date-only `to` is inclusive of that whole UTC day. */
export function dateRange(from: string | undefined, to: string | undefined) {
  if (!from && !to) return undefined;
  const range: { $gte?: Date; $lt?: Date; $lte?: Date } = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    if (DATE_ONLY.test(to)) {
      end.setUTCDate(end.getUTCDate() + 1);
      range.$lt = end;
    } else {
      range.$lte = end;
    }
  }
  return range;
}

/** `_id` breaks ties so offset pages never repeat or skip rows; every list index ends in it. */
export const SORTS = {
  "-createdAt": { createdAt: -1, _id: -1 },
  createdAt: { createdAt: 1, _id: 1 },
  name: { name: 1, _id: 1 },
  "-name": { name: -1, _id: -1 },
} as const;

export const SORT_KEYS = ["-createdAt", "createdAt", "name", "-name"] as const;

/** Unfiltered totals come from collection metadata instead of a scan. */
export function countMatching<T>(model: Model<T>, filter: Record<string, unknown>) {
  return Object.keys(filter).length === 0
    ? model.estimatedDocumentCount()
    : model.countDocuments(filter);
}

export function page<T>(data: T[], total: number, query: { page: number; limit: number }) {
  return {
    data,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}
