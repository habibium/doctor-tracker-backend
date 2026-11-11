import { model, Schema, type Types } from "mongoose";
import type { SortSpec } from "../../lib/query.ts";
import type { UserSortField } from "./user.schema.ts";

export interface UserRecord {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role?: string | null;
  deactivatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Read-only view of better-auth's `user` collection for lists; every write goes through better-auth. */
const userSchema = new Schema<UserRecord>(
  {
    name: String,
    email: String,
    role: String,
    deactivatedAt: Date,
    createdAt: Date,
    updatedAt: Date,
  },
  { collection: "user" },
);

export const User = model<UserRecord>("User", userSchema);

export const USER_SORTS = {
  createdAt: { createdAt: 1, _id: 1 },
  name: { name: 1, _id: 1 },
  email: { email: 1, _id: 1 },
  role: { role: 1, createdAt: -1, _id: -1 },
} satisfies Record<UserSortField, SortSpec>;
