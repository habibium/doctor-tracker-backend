import { pino } from "pino";
import { env } from "../config/env.ts";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  ...(env.NODE_ENV === "development" && {
    transport: { target: "pino-pretty", options: { ignore: "pid,hostname" } },
  }),
});
