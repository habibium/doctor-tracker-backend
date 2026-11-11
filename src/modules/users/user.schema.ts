import * as z from "zod";
import { PASSWORD_LENGTH, ROLES } from "../../auth/auth.ts";
import { sortParams } from "../../lib/query.ts";
import {
  dateRangeQuery,
  objectId,
  paginated,
  paginationQuery,
  searchQuery,
  timestamp,
} from "../../lib/schemas.ts";

export const USER_STATUSES = ["active", "deactivated"] as const;

export const password = z
  .string()
  .min(PASSWORD_LENGTH.min, `Must be at least ${PASSWORD_LENGTH.min} characters`)
  .max(PASSWORD_LENGTH.max, `Must be at most ${PASSWORD_LENGTH.max} characters`)
  .meta({ description: `${PASSWORD_LENGTH.min} to ${PASSWORD_LENGTH.max} characters` });

const name = z.string().trim().min(2).max(120);
const role = z.enum(ROLES).meta({ description: "`viewer` can read; `admin` can also change data" });
const status = z.enum(USER_STATUSES);

export const createUserBody = z
  .object({ name, email: z.email().max(254), role, password })
  .meta({ id: "CreateUser" });
export type CreateUserBody = z.infer<typeof createUserBody>;

export const updateUserBody = z
  .object({
    name: name.optional(),
    role: role.optional(),
    status: status.optional().meta({
      description: "`deactivated` blocks sign-in and ends every session at once",
    }),
  })
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update")
  .meta({ id: "UpdateUser" });
export type UpdateUserBody = z.infer<typeof updateUserBody>;

export const resetPasswordBody = z.object({ password }).meta({ id: "ResetUserPassword" });

export const user = z
  .object({
    id: objectId,
    name: z.string(),
    email: z.email(),
    role,
    status,
    deactivatedAt: timestamp.nullable(),
    createdAt: timestamp,
  })
  .meta({ id: "User" });
export type UserDto = z.infer<typeof user>;

export const userList = paginated(user).meta({ id: "UserList" });

export const USER_SORT_FIELDS = ["createdAt", "name", "email", "role"] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export const listUsersQuery = z.object({
  ...paginationQuery,
  ...searchQuery,
  role: role.optional(),
  status: status.optional(),
  ...dateRangeQuery,
  sort: z
    .enum(sortParams(USER_SORT_FIELDS))
    .default("-createdAt")
    .meta({ description: "A leading `-` sorts descending" }),
});
export type ListUsersQuery = z.infer<typeof listUsersQuery>;
