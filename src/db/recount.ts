import { env } from "../config/env.ts";
import { connectDatabase, disconnectDatabase } from "./connection.ts";
import { fillConditionRanks, recountPatients } from "./maintenance.ts";

await connectDatabase(env.MONGODB_URI);
const { patientsCorrected } = await fillConditionRanks();
console.log(`Condition ranks checked; ${patientsCorrected} patients corrected.`);
const { doctorsCorrected } = await recountPatients();
console.log(`Patient counts recomputed; ${doctorsCorrected} doctors corrected.`);
await disconnectDatabase();
