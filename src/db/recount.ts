import { env } from "../config/env.ts";
import { connectDatabase, disconnectDatabase } from "./connection.ts";
import { recountPatients } from "./maintenance.ts";

await connectDatabase(env.MONGODB_URI);
const { doctorsCorrected } = await recountPatients();
console.log(`Patient counts recomputed; ${doctorsCorrected} doctors corrected.`);
await disconnectDatabase();
