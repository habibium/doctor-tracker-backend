import type { ErrorRequestHandler, RequestHandler } from "express";
import mongoose from "mongoose";
import { AppError, conflict, validationError } from "../lib/errors.ts";

export const notFoundHandler: RequestHandler = (req) => {
  throw new AppError(404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const error = toAppError(err);
  if (error.status >= 500) req.log.error({ err }, "Unhandled error");

  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
  });
};

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof mongoose.Error.ValidationError) {
    return validationError(
      Object.values(err.errors).map((issue) => ({
        path: `body.${issue.path}`,
        message: issue.message,
      })),
    );
  }

  if (err instanceof mongoose.Error.CastError) {
    return validationError([{ path: err.path, message: "Invalid value" }]);
  }

  if (isRecord(err)) {
    // E11000: a unique index (doctor email) rejected the write.
    if (err.code === 11000) {
      const field = Object.keys(isRecord(err.keyPattern) ? err.keyPattern : {})[0] ?? "value";
      return conflict(`A record with this ${field} already exists`, [
        { path: `body.${field}`, message: "Already in use" },
      ]);
    }
    if (err.type === "entity.parse.failed") {
      return new AppError(400, "INVALID_JSON", "The request body is not valid JSON");
    }
    if (err.type === "entity.too.large") {
      return new AppError(413, "PAYLOAD_TOO_LARGE", "The request body is too large");
    }
  }

  return new AppError(500, "INTERNAL_ERROR", "Something went wrong on our side");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
