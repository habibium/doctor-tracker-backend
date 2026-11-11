import { defineRoute } from "../../lib/route.ts";
import { idParams } from "../../lib/schemas.ts";
import {
  createUserBody,
  listUsersQuery,
  resetPasswordBody,
  updateUserBody,
  user,
  userList,
} from "./user.schema.ts";
import * as users from "./user.service.ts";

const tag = "Users";
const roles = ["admin"] as const;

export const userRoutes = [
  defineRoute({
    method: "get",
    path: "/users",
    operationId: "listUsers",
    summary: "List users with search, filters and pagination",
    tag,
    roles,
    request: { query: listUsersQuery },
    response: { status: 200, description: "A page of users", schema: userList },
    errors: [400],
    handler: ({ query }) => users.listUsers(query),
  }),
  defineRoute({
    method: "post",
    path: "/users",
    operationId: "createUser",
    summary: "Create a user with an initial password",
    tag,
    roles,
    request: { body: createUserBody },
    response: { status: 201, description: "The created user", schema: user },
    errors: [400, 409],
    handler: ({ auth, body }) => users.createUser(auth, body),
  }),
  defineRoute({
    method: "patch",
    path: "/users/{id}",
    operationId: "updateUser",
    summary: "Rename, change the role of, deactivate or reactivate a user",
    tag,
    roles,
    request: { params: idParams, body: updateUserBody },
    response: { status: 200, description: "The updated user", schema: user },
    errors: [400, 404],
    handler: ({ auth, user: actor, params, body }) =>
      users.updateUser(auth, actor, params.id, body),
  }),
  defineRoute({
    method: "post",
    path: "/users/{id}/password",
    operationId: "resetUserPassword",
    summary: "Set a new password for a user and end their sessions",
    tag,
    roles,
    request: { params: idParams, body: resetPasswordBody },
    response: { status: 204, description: "Password replaced" },
    errors: [400, 404],
    handler: ({ auth, user: actor, params, body }) =>
      users.resetPassword(auth, actor, params.id, body.password),
  }),
  defineRoute({
    method: "delete",
    path: "/users/{id}",
    operationId: "deleteUser",
    summary: "Delete a user and end their sessions",
    tag,
    roles,
    request: { params: idParams },
    response: { status: 204, description: "User deleted" },
    errors: [400, 404],
    handler: ({ auth, user: actor, params }) => users.deleteUser(auth, actor, params.id),
  }),
];
