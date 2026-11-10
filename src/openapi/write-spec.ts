import { writeFile } from "node:fs/promises";
import { routes } from "../routes.ts";
import { buildOpenApiDocument } from "./document.ts";

const target = process.argv[2] ?? "openapi.json";
await writeFile(target, `${JSON.stringify(buildOpenApiDocument(routes), null, 2)}\n`);
console.log(`OpenAPI document written to ${target}`);
