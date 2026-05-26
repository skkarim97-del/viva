// =====================================================================
// careEventWriter.ts  (Treatment Intelligence Layer)
// =====================================================================
// Single helper for fire-and-forget care event inserts.
//
// All routes that write to careEventsTable should call writeCareEvents()
// so error handling and log labels are consistent. Today the three call
// sites in patientInterventions.ts inline the same pattern; Phase 2
// will migrate them here.
//
// Fire-and-forget by design: care events are an audit/analytics trail.
// They must NOT block the patient's response path. Failed writes are
// logged at warn level so persistent failures are observable in server
// logs without surfacing errors to the patient.

import { db, careEventsTable } from "@workspace/db";
import { logger } from "../../lib/logger";

export type CareEventRow = typeof careEventsTable.$inferInsert;

/**
 * Insert one or more care event rows asynchronously. Never throws;
 * logs at warn level on failure so silent data loss is observable.
 *
 * @param rows        One row or an array of rows to insert.
 * @param logLabel    Log message emitted on failure (use the same
 *                    string the call site would have used inline).
 * @param logContext  Optional extra fields merged into the warn payload
 *                    (e.g. { interventionId: id }).
 */
export function writeCareEvents(
  rows: CareEventRow | CareEventRow[],
  logLabel: string,
  logContext: Record<string, unknown> = {},
): void {
  const values = Array.isArray(rows) ? rows : [rows];
  db.insert(careEventsTable)
    .values(values)
    .catch((err) => {
      logger.warn({ err, ...logContext }, logLabel);
    });
}
