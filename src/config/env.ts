import * as z from "zod";

const origin = z.url().transform((value) => value.replace(/\/+$/, ""));

/** A comma-separated list of origins; empty by default. */
const originList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(origin));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  MONGODB_URI: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  WEB_ORIGIN: origin,
  API_URL: origin,
  TRUSTED_ORIGINS: originList,
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  CLIENT_IP_HEADER: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]*$/, "must be a header name")
    .default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";

/** Every origin a browser may use the app from: the main one, then any extras. */
export const webOrigins = [env.WEB_ORIGIN, ...env.TRUSTED_ORIGINS];
