export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const validationError = (details: ErrorDetail[]) =>
  new AppError(400, "VALIDATION_ERROR", "Request validation failed", details);

export const unauthenticated = () =>
  new AppError(401, "UNAUTHENTICATED", "Authentication required");

export const forbidden = () =>
  new AppError(403, "FORBIDDEN", "You do not have permission to perform this action");

export const notFound = (resource: string) =>
  new AppError(404, "NOT_FOUND", `${resource} not found`);

export const conflict = (message: string, details?: ErrorDetail[]) =>
  new AppError(409, "CONFLICT", message, details);
