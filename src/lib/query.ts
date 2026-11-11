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

export type SortSpec = Record<string, 1 | -1>;
export type SortParam<F extends string> = F | `-${F}`;

/** The values a list's `sort` parameter accepts: each field, then its descending form. */
export function sortParams<const F extends string>(fields: readonly [F, ...F[]]) {
  return fields.flatMap((field) => [field, `-${field}` as const]) as [
    SortParam<F>,
    ...SortParam<F>[],
  ];
}

/**
 * `-field` is the exact reverse of `field`, so one index serves both directions.
 * Every spec ends in `_id` so offset pages never repeat or skip rows.
 */
export function sortSpec<F extends string>(specs: Record<F, SortSpec>, param: SortParam<F>) {
  if (!param.startsWith("-")) return specs[param as F];
  const ascending = Object.entries(specs[param.slice(1) as F]);
  return Object.fromEntries(ascending.map(([field, order]) => [field, -order])) as SortSpec;
}

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
