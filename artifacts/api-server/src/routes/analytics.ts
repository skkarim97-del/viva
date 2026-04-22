import { Router, type Response } from "express";
import { z } from "zod";
import { db, analyticsEventsTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";

// ----------------------------------------------------------------------
// /analytics -- pilot-grade product usage stream.
//
// One endpoint, one shape. Patient (bearer) and doctor (cookie) both
// post here -- the auth middleware exposes role + userId, which we
// trust as the user_type / user_id (the client cannot impersonate
// another user). Always returns 200 OK so analytics outages can never
// break a product flow on the client side.
// ----------------------------------------------------------------------

const router: Router = Router();

const PLATFORMS = ["ios", "android", "web", "unknown"] as const;

const eventSchema = z.object({
  eventName: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64).nullish(),
  platform: z.enum(PLATFORMS).nullish(),
  // IANA timezone string from Intl.DateTimeFormat. Loosely validated
  // (max 64 chars) -- we never index on it and it lands in a free-text
  // column. Older client builds won't send this; the column is null
  // for those rows and the server falls back to UTC at query time.
  timezone: z.string().min(1).max(64).nullish(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
});

router.post("/events", requireAuth, async (req, res: Response) => {
  const auth = (req as AuthedRequest).auth;
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    // 200 to keep clients quiet -- analytics failures must not surface
    // anywhere near a user-facing error path.
    res.status(200).json({ ok: false, ignored: "invalid_input" });
    return;
  }
  try {
    const rows = parsed.data.events.map((e) => ({
      userType: auth.role, // 'patient' | 'doctor', enforced by auth
      userId: auth.userId,
      eventName: e.eventName,
      sessionId: e.sessionId ?? null,
      platform: e.platform ?? null,
      timezone: e.timezone ?? null,
    }));
    await db.insert(analyticsEventsTable).values(rows);
    res.json({ ok: true, inserted: rows.length });
  } catch (err) {
    // Log and acknowledge: the client should never retry analytics on
    // a server error, and the user should never see anything happen.
    logger.warn({ err }, "analytics_events_insert_failed");
    res.status(200).json({ ok: false, ignored: "insert_failed" });
  }
});

export default router;
