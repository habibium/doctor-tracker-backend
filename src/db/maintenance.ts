import mongoose, { type Types } from "mongoose";
import { Doctor } from "../modules/doctors/doctor.model.ts";
import { Patient } from "../modules/patients/patient.model.ts";

/**
 * Recomputes every doctor's patientCount: one covered aggregation, one bulk write that touches
 * only wrong counters. The transaction makes a concurrent patient write conflict and retry.
 */
export async function recountPatients() {
  return mongoose.connection.transaction(async (session) => {
    const counts = await Patient.aggregate<{ _id: Types.ObjectId; patients: number }>([
      { $sort: { doctor: 1 } },
      { $group: { _id: "$doctor", patients: { $sum: 1 } } },
    ]).session(session);

    const { modifiedCount } = await Doctor.bulkWrite(
      [
        {
          updateMany: {
            filter: { _id: { $nin: counts.map((row) => row._id) }, patientCount: { $ne: 0 } },
            update: { $set: { patientCount: 0 } },
          },
        },
        ...counts.map((row) => ({
          updateOne: {
            filter: { _id: row._id, patientCount: { $ne: row.patients } },
            update: { $set: { patientCount: row.patients } },
          },
        })),
      ],
      { session },
    );
    return { doctorsCorrected: modifiedCount };
  });
}
