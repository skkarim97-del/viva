// PHI-safe push notification helper (HIPAA pilot, T008).
//
// THE RULE: a push notification body is delivered to APNs / FCM in the
// clear (Apple's payload encryption protects the transport, but the
// notification text is visible on a locked screen and is logged by both
// vendors). Therefore the title and body MUST NEVER contain anything
// that ties a recipient to a specific medical fact: no medication name,
// no symptom, no dose, no clinic, no doctor name, no message preview.
//
// `sendSafePush` enforces this by accepting only one of a small allowlist
// of message templates. New templates require a code review and a one-line
// addition here. Anything off-template throws synchronously so the bug is
// caught at call time, not on the patient's lock screen.
//
// Free-form variables that ARE allowed:
//   - the patient's own first name (their device, their name, OK)
//   - a numeric count when the template requires one (e.g. unread count)
// Free-form variables NOT allowed:
//   - any field originating from coach_messages.body, doctor_notes.body,
//     care_events.metadata, intervention_events.body, etc.
//
// This file has zero dependencies (pure validation + a stub send) so it
// can be unit-tested without spinning the whole api-server.

export type PushTemplateId =
  | "daily_checkin_reminder"
  | "care_team_message_available"
  | "weekly_summary_ready"
  | "appointment_reminder_generic";

interface PushTemplateDef {
  // Title and body are rendered server-side from this template + the
  // (optional) firstName. The renderer NEVER substitutes anything else.
  title: (vars: PushVars) => string;
  body: (vars: PushVars) => string;
}

interface PushVars {
  firstName?: string;
  count?: number;
}

const TEMPLATES: Record<PushTemplateId, PushTemplateDef> = {
  daily_checkin_reminder: {
    title: () => "Time for your check-in",
    body: ({ firstName }) =>
      firstName
        ? `${firstName}, a quick check-in helps your care team support you.`
        : "A quick check-in helps your care team support you.",
  },
  care_team_message_available: {
    title: () => "Your care team has a message",
    body: ({ firstName }) =>
      firstName
        ? `${firstName}, sign in to Viva Care to read it.`
        : "Sign in to Viva Care to read it.",
  },
  weekly_summary_ready: {
    title: () => "Your weekly summary is ready",
    body: () => "Open Viva Care to review the past week.",
  },
  appointment_reminder_generic: {
    title: () => "Upcoming appointment",
    body: () => "Open Viva Care for the details.",
  },
};

export interface SafePushArgs {
  templateId: PushTemplateId;
  // Recipient. Resolution to APNs/FCM tokens is the caller's job.
  patientUserId: number;
  // Allowed substitutions only.
  firstName?: string;
  count?: number;
}

export interface SafePushPayload {
  templateId: PushTemplateId;
  patientUserId: number;
  title: string;
  body: string;
}

// Throws if the template is unknown OR if firstName looks unsafe (e.g.
// contains a digit suggesting it's actually a phone number, or contains
// a `@` suggesting an email address). Belt-and-suspenders against a
// caller accidentally piping a phi field into firstName.
function assertSafeFirstName(firstName: string | undefined): void {
  if (firstName === undefined) return;
  if (typeof firstName !== "string") {
    throw new Error("pushSafe: firstName must be a string");
  }
  if (firstName.length === 0 || firstName.length > 60) {
    throw new Error("pushSafe: firstName length out of range (1-60)");
  }
  if (/[@\d\n\r]/.test(firstName)) {
    throw new Error(
      "pushSafe: firstName contains forbidden characters (@, digits, newlines)",
    );
  }
}

// Pure renderer -- exposed so tests can assert the rendered body without
// hitting any push backend.
export function renderSafePush(args: SafePushArgs): SafePushPayload {
  const tpl = TEMPLATES[args.templateId];
  if (!tpl) {
    throw new Error(`pushSafe: unknown templateId "${args.templateId}"`);
  }
  assertSafeFirstName(args.firstName);
  if (args.count !== undefined && (!Number.isFinite(args.count) || args.count < 0)) {
    throw new Error("pushSafe: count must be a non-negative finite number");
  }
  const vars: PushVars = {
    firstName: args.firstName,
    count: args.count,
  };
  return {
    templateId: args.templateId,
    patientUserId: args.patientUserId,
    title: tpl.title(vars),
    body: tpl.body(vars),
  };
}

// The actual sender. In the pilot this just logs; wiring to APNs/FCM
// is a follow-up. Returning the rendered payload lets the caller log
// which template fired without needing to inspect the raw body.
export async function sendSafePush(
  args: SafePushArgs,
): Promise<SafePushPayload> {
  const payload = renderSafePush(args);
  // TODO(post-pilot): hand `payload` off to the APNs/FCM sender here.
  // We deliberately do NOT log title/body to keep notification copy out
  // of server logs (defense in depth -- the templates are PHI-safe but
  // logging them on every send still bloats audit volume).
  return payload;
}

// Self-check that runs at module load in dev to catch typos in the
// templates above (each template must produce a non-empty title/body
// even with no vars). Skipped in production to avoid startup overhead.
if (process.env["NODE_ENV"] !== "production") {
  for (const id of Object.keys(TEMPLATES) as PushTemplateId[]) {
    const out = renderSafePush({ templateId: id, patientUserId: 0 });
    if (!out.title || !out.body) {
      throw new Error(`pushSafe: template "${id}" produced empty title/body`);
    }
  }
}
