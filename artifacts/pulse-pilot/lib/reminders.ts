// Local-only daily check-in reminders.
//
// Patient app posts at most two reminders per day:
//   12:00 PM  -- "Log your daily check-in"
//    7:00 PM  -- "Don't forget your check-in today"
//
// The product rule is: don't fire either reminder if the patient has
// already submitted today's check-in. We achieve that with one-off
// scheduled local notifications, not repeating triggers, so we can
// cancel the rest of today's reminders the moment a check-in lands.
//
// Lifecycle:
//   * On app launch, after a check-in, after toggling the setting, and
//     on sign-out, we call rescheduleReminders(...) which cancels every
//     viva-tagged scheduled notification and re-creates the upcoming
//     window from current state.
//   * The "current state" is: enabled flag + whether today's check-in
//     has already been recorded. The latter comes straight from the
//     same `todayCheckIn` value the dashboard uses, so the two views
//     can never disagree about whether today is already done.
//
// We schedule a 7-day forward window. Past day cancel-and-replace on
// every app foreground keeps the window fresh, so a missed launch only
// affects future days, not today.

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

const TAG = "viva-reminder";
const STORAGE_KEY = "viva.reminders.enabled";
const FORWARD_DAYS = 7;

export const REMINDER_TIMES: { hour: number; minute: number; label: string; body: string }[] = [
  { hour: 12, minute: 0, label: "12:00 PM", body: "Log your daily check-in" },
  { hour: 19, minute: 0, label: "7:00 PM", body: "Don't forget your check-in today" },
];

// True on platforms where local notifications are actually supported.
// Web and the Expo dev preview in a browser don't have the native API,
// so every reminder call short-circuits there.
function supported(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

let handlerInstalled = false;
function ensureHandler() {
  if (handlerInstalled || !supported()) return;
  handlerInstalled = true;
  // Show the banner + sound even when the app is foregrounded so a
  // user with the app open at noon still sees their reminder.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function getRemindersEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    // Default ON for new installs per spec. We only treat an explicit
    // "false" string as opted-out.
    return v !== "false";
  } catch {
    return true;
  }
}

export async function setRemindersEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    /* AsyncStorage write failed -- non-fatal; in-memory state still
       drives the next reschedule call. */
  }
}

export type PermissionState = "granted" | "denied" | "undetermined" | "unsupported";

export async function getPermissionState(): Promise<PermissionState> {
  if (!supported()) return "unsupported";
  ensureHandler();
  try {
    const res = await Notifications.getPermissionsAsync();
    if (res.granted) return "granted";
    if (res.canAskAgain === false) return "denied";
    return "undetermined";
  } catch {
    return "unsupported";
  }
}

export async function requestPermission(): Promise<PermissionState> {
  if (!supported()) return "unsupported";
  ensureHandler();
  try {
    const res = await Notifications.requestPermissionsAsync();
    if (res.granted) return "granted";
    if (res.canAskAgain === false) return "denied";
    return "undetermined";
  } catch {
    return "unsupported";
  }
}

// Cancel every notification we previously scheduled with our tag. We
// filter by content.data.tag so we never delete unrelated scheduled
// notifications a future feature might add.
async function cancelOurScheduled() {
  if (!supported()) return;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of all) {
      const data = n.content?.data as Record<string, unknown> | undefined;
      if (data && data.tag === TAG) {
        try {
          await Notifications.cancelScheduledNotificationAsync(n.identifier);
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    /* no-op */
  }
}

interface RescheduleInput {
  enabled: boolean;
  // Whether the patient has already submitted today's check-in. When
  // true, today's remaining reminders are skipped entirely.
  hasCheckedInToday: boolean;
}

// Single-flight guard. Every call to rescheduleReminders/clearAllReminders
// captures a monotonically increasing runId; if a newer call has been
// issued, the older call bails before it can write stale state. This
// matters because rescheduleReminders is invoked from four overlapping
// places (app foreground, signed-in user effect, post check-in,
// settings toggle, sign-out) and the wrong winner could either re-queue
// reminders we just canceled (e.g. after sign-out) or leave today's
// reminders alive after a check-in.
let currentRunId = 0;
function nextRunId(): number {
  currentRunId += 1;
  return currentRunId;
}
function isStale(myRunId: number): boolean {
  return myRunId !== currentRunId;
}

// Cancel + re-create the upcoming reminder window from current state.
// Safe to call repeatedly (e.g. on every app foreground, after every
// check-in). Returns the count of reminders actually scheduled, which
// the settings UI uses to render a quiet confirmation line. If a newer
// reschedule arrives mid-flight, this call exits early and lets the
// newer call own the schedule.
export async function rescheduleReminders(input: RescheduleInput): Promise<number> {
  if (!supported()) return 0;
  ensureHandler();
  const myRun = nextRunId();
  await cancelOurScheduled();
  if (isStale(myRun)) return 0;
  if (!input.enabled) return 0;
  // We only schedule into a granted permission state. Without it,
  // expo-notifications would silently drop them on iOS anyway.
  const perm = await Notifications.getPermissionsAsync();
  if (isStale(myRun)) return 0;
  if (!perm.granted) return 0;

  const now = new Date();
  let scheduled = 0;

  for (let dayOffset = 0; dayOffset < FORWARD_DAYS; dayOffset++) {
    if (isStale(myRun)) return scheduled;
    const isToday = dayOffset === 0;
    if (isToday && input.hasCheckedInToday) continue;
    for (const t of REMINDER_TIMES) {
      if (isStale(myRun)) return scheduled;
      const fireAt = new Date(now);
      fireAt.setDate(now.getDate() + dayOffset);
      fireAt.setHours(t.hour, t.minute, 0, 0);
      // Already passed -- skip. Without this guard expo-notifications
      // would either fire immediately or reject the trigger.
      if (fireAt.getTime() <= now.getTime() + 5_000) continue;
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Viva",
            body: t.body,
            data: { tag: TAG, slot: `${t.hour}:${t.minute}` },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: fireAt,
          },
        });
        scheduled += 1;
      } catch {
        /* one bad slot shouldn't kill the rest of the schedule */
      }
    }
  }
  return scheduled;
}

// Convenience used on sign-out. We must NOT leave reminders queued
// against a stale user; the next sign-in might be a different patient
// on the same device. Bumping the runId here also poisons any
// in-flight rescheduleReminders so it cannot re-queue after we clear.
export async function clearAllReminders(): Promise<void> {
  nextRunId();
  await cancelOurScheduled();
}
