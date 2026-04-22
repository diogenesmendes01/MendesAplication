/**
 * SLA calculation utilities.
 *
 * Business hours support: when a BusinessHours config is provided,
 * deadlines only count minutes inside the working window.
 */

export interface BusinessHours {
  enabled: boolean;
  startHour: number; // 0-23
  endHour: number; // 0-23, must be > startHour
  workDays: number[]; // 0=Sun … 6=Sat
}

export type SlaStatusValue = "ok" | "at_risk" | "breached";

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

function isWorkingTime(date: Date, bh: BusinessHours): boolean {
  if (!bh.enabled) return true;
  const day = date.getDay();
  if (!bh.workDays.includes(day)) return false;
  const hour = date.getHours();
  return hour >= bh.startHour && hour < bh.endHour;
}

function nextWorkingStart(date: Date, bh: BusinessHours): Date {
  const d = new Date(date);
  // Move to start of next working period
  // First try same day if before startHour
  for (let i = 0; i < 8; i++) {
    if (i > 0) {
      // Advance to next day at startHour
      d.setDate(d.getDate() + 1);
    }
    d.setHours(bh.startHour, 0, 0, 0);
    if (bh.workDays.includes(d.getDay()) && d > date) {
      return d;
    }
  }
  // Fallback — shouldn't happen with valid config (at least 1 work day)
  return date;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate SLA deadline from a start time and a number of minutes,
 * optionally skipping non-business hours.
 */
export function calculateSlaDeadline(
  startTime: Date,
  minutes: number,
  businessHours?: BusinessHours
): Date {
  if (!businessHours || !businessHours.enabled) {
    return new Date(startTime.getTime() + minutes * 60_000);
  }

  const bh = businessHours;
  let remaining = minutes;
  const cursor = new Date(startTime);

  // If we start outside working hours, jump to next working start
  if (!isWorkingTime(cursor, bh)) {
    const next = nextWorkingStart(cursor, bh);
    cursor.setTime(next.getTime());
  }

  while (remaining > 0) {
    // Minutes left in current working window
    const endOfDay = new Date(cursor);
    endOfDay.setHours(bh.endHour, 0, 0, 0);

    const minutesLeftToday = Math.max(
      0,
      (endOfDay.getTime() - cursor.getTime()) / 60_000
    );

    if (remaining <= minutesLeftToday) {
      cursor.setTime(cursor.getTime() + remaining * 60_000);
      remaining = 0;
    } else {
      remaining -= minutesLeftToday;
      // Jump to next working start
      const next = nextWorkingStart(endOfDay, bh);
      cursor.setTime(next.getTime());
    }
  }

  return cursor;
}

/**
 * Returns true if the SLA deadline has passed.
 */
export function isSlaBreached(deadline: Date): boolean {
  return new Date() > deadline;
}

/**
 * Returns the current SLA status given a deadline and an alert threshold.
 */
export function getSlaStatus(
  deadline: Date,
  alertBeforeMinutes: number
): SlaStatusValue {
  const now = new Date();
  if (now > deadline) return "breached";

  const alertThreshold = new Date(
    deadline.getTime() - alertBeforeMinutes * 60_000
  );
  if (now >= alertThreshold) return "at_risk";

  return "ok";
}

/**
 * Returns a progress percentage (0–100) representing how much of the
 * total SLA window has elapsed. 0 = just created, 100 = deadline reached.
 * Can exceed 100 if breached.
 */
export function getSlaProgress(createdAt: Date, deadline: Date): number {
  const total = deadline.getTime() - createdAt.getTime();
  if (total <= 0) return 100;

  const elapsed = new Date().getTime() - createdAt.getTime();
  const pct = (elapsed / total) * 100;
  return Math.min(Math.max(Math.round(pct), 0), 100);
}
