// ============================================================
// Dialo AI — Callback Time Resolution
// ============================================================
//
// Turns what a customer said into an exact instant, or reports honestly that
// they did not give one.
//
// The distinction this module exists to make:
//
//   "call me in 5 minutes"        -> exact    (a duration from now)
//   "call me tomorrow at 4 PM"    -> exact    (a date and a time)
//   "call me tomorrow"            -> dateOnly (a date, no time)
//   "call me later"               -> vague    (neither)
//
// Only `exact` may be scheduled. A `dateOnly` or `vague` request is recorded and
// surfaced for a time to be asked for — Dialo never picks one. Choosing 11am
// because the customer said "tomorrow" produces a call they did not agree to.
// ============================================================

export type ResolvedKind = "exact" | "dateOnly" | "vague";

export interface ResolvedCallbackTime {
  kind: ResolvedKind;
  /** ISO instant. Present only when `kind` is "exact". */
  instant: string | null;
  /** Local calendar date in the customer's timezone, when one was given. */
  date: string | null;
  /** Local wall-clock time in the customer's timezone, when one was given. */
  time: string | null;
  timezone: string;
  /** What the request was understood as, for display next to the raw wording. */
  interpretation: string;
}

// ------------------------------------------------------------
// Timezone arithmetic
// ------------------------------------------------------------

/** Milliseconds a zone is ahead of UTC at a given instant. */
function zoneOffset(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(timestamp));

  const field: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") field[part.type] = Number(part.value);
  }

  const asUtc = Date.UTC(
    field.year,
    field.month - 1,
    field.day,
    field.hour % 24,
    field.minute,
    field.second
  );
  return asUtc - timestamp;
}

/**
 * Converts a wall-clock time in a zone to a UTC instant.
 *
 * Resolved twice because the offset depends on the instant we are still solving
 * for — the second pass corrects a request that lands across a DST boundary.
 */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = naive - zoneOffset(naive, timeZone);
  const secondOffset = zoneOffset(firstPass, timeZone);
  return naive - secondOffset;
}

/** The calendar parts of an instant, as seen in a given zone. */
export function instantToZonedParts(
  timestamp: number,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const field: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    if (part.type !== "literal") field[part.type] = part.value;
  }

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    year: Number(field.year),
    month: Number(field.month),
    day: Number(field.day),
    hour: Number(field.hour) % 24,
    minute: Number(field.minute),
    weekday: weekdays.indexOf(field.weekday),
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatZonedDate(timestamp: number, timeZone: string): string {
  const p = instantToZonedParts(timestamp, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function formatZonedTime(timestamp: number, timeZone: string): string {
  const p = instantToZonedParts(timestamp, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

// ------------------------------------------------------------
// Parsing what the customer said
// ------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, forty_five: 45, sixty: 60,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

function toNumber(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return NUMBER_WORDS[trimmed] ?? null;
}

interface ParsedTime {
  hour: number;
  minute: number;
}

/**
 * Finds an explicit clock time.
 *
 * A bare hour with no am/pm is resolved toward business hours — "call me at 4"
 * means 16:00, not 04:00. A time qualified by a part of day uses that instead.
 */
function parseClockTime(text: string): ParsedTime | null {
  const match = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase().replace(/\./g, "");

  if (hour > 23 || minute > 59) return null;

  if (meridiem === "pm" && hour < 12) hour += 12;
  else if (meridiem === "am" && hour === 12) hour = 0;
  else if (!meridiem) {
    const evening = /\b(evening|night|afternoon)\b/i.test(text);
    const morning = /\b(morning)\b/i.test(text);
    if (evening && hour < 12) hour += 12;
    else if (!morning && hour >= 1 && hour <= 7) hour += 12; // 1–7 means afternoon
  }

  return { hour, minute };
}

/** True when the text names only a fuzzy part of the day, with no clock time. */
function hasOnlyPartOfDay(text: string): boolean {
  return /\b(morning|afternoon|evening|night|noon|midday|later|sometime|some time|anytime)\b/i.test(
    text
  );
}

export interface ResolveOptions {
  /** Instant the request was made — normally when the call ended. */
  now: number;
  timezone: string;
}

/**
 * Resolves a spoken callback request.
 *
 * Accepts an ISO datetime the agent already resolved, and also the relative
 * phrasing agents commonly pass through verbatim.
 */
export function resolveCallbackRequest(
  raw: string | null | undefined,
  options: ResolveOptions
): ResolvedCallbackTime {
  const timezone = isValidTimeZone(options.timezone) ? options.timezone : "UTC";
  const vague = (interpretation: string): ResolvedCallbackTime => ({
    kind: "vague",
    instant: null,
    date: null,
    time: null,
    timezone,
    interpretation,
  });

  const text = (raw ?? "").trim();
  if (!text) return vague("No callback time was given.");

  const lower = text.toLowerCase();

  // --- An ISO datetime the agent already resolved ---
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) {
    const parsed = new Date(text.replace(" ", "T"));
    if (!Number.isNaN(parsed.getTime())) {
      return {
        kind: "exact",
        instant: parsed.toISOString(),
        date: formatZonedDate(parsed.getTime(), timezone),
        time: formatZonedTime(parsed.getTime(), timezone),
        timezone,
        interpretation: "An exact date and time.",
      };
    }
  }

  // --- A duration: "in 5 minutes", "after 2 hours" ---
  const duration = lower.match(
    /\b(?:in|after|within)\s+(\d+|[a-z]+)\s*(minute|min|hour|hr|day|week)s?\b/
  );
  if (duration) {
    const amount = toNumber(duration[1]);
    if (amount !== null && amount > 0) {
      const unit = duration[2];
      const ms =
        unit.startsWith("min") ? amount * 60_000
        : unit.startsWith("h") ? amount * 3_600_000
        : unit.startsWith("d") ? amount * 86_400_000
        : amount * 7 * 86_400_000;

      // A duration in days or weeks names a day, not a time of day. "Call me
      // after two days" still needs an hour from the customer.
      if (unit.startsWith("d") || unit.startsWith("w")) {
        const target = options.now + ms;
        const clock = parseClockTime(lower.replace(duration[0], ""));
        if (clock) {
          const parts = instantToZonedParts(target, timezone);
          const instant = zonedTimeToInstant(
            parts.year, parts.month, parts.day, clock.hour, clock.minute, timezone
          );
          return {
            kind: "exact",
            instant: new Date(instant).toISOString(),
            date: formatZonedDate(instant, timezone),
            time: formatZonedTime(instant, timezone),
            timezone,
            interpretation: `In ${amount} ${unit}${amount > 1 ? "s" : ""}, at a stated time.`,
          };
        }
        return {
          kind: "dateOnly",
          instant: null,
          date: formatZonedDate(target, timezone),
          time: null,
          timezone,
          interpretation: `In ${amount} ${unit}${amount > 1 ? "s" : ""}, but no time of day was given.`,
        };
      }

      const instant = options.now + ms;
      return {
        kind: "exact",
        instant: new Date(instant).toISOString(),
        date: formatZonedDate(instant, timezone),
        time: formatZonedTime(instant, timezone),
        timezone,
        interpretation: `${amount} ${unit}${amount > 1 ? "s" : ""} from the end of the call.`,
      };
    }
  }

  // --- A named day: today, tomorrow, a weekday ---
  const today = instantToZonedParts(options.now, timezone);
  let targetDayOffset: number | null = null;
  let dayLabel = "";

  if (/\btoday\b|\bthis evening\b|\bthis afternoon\b|\btonight\b/.test(lower)) {
    targetDayOffset = 0;
    dayLabel = "today";
  } else if (/\btomorrow\b|\btmrw\b|\bnext day\b/.test(lower)) {
    targetDayOffset = 1;
    dayLabel = "tomorrow";
  } else if (/\bday after tomorrow\b/.test(lower)) {
    targetDayOffset = 2;
    dayLabel = "the day after tomorrow";
  } else {
    for (const [name, index] of Object.entries(WEEKDAYS)) {
      if (new RegExp(`\\b${name}\\b`).test(lower)) {
        let delta = (index - today.weekday + 7) % 7;
        if (delta === 0) delta = 7; // "Monday" on a Monday means the next one
        targetDayOffset = delta;
        dayLabel = name;
        break;
      }
    }
  }

  // --- A week-scale reference with no day is too broad to schedule ---
  if (targetDayOffset === null && /\bnext week\b|\bthis week\b|\bweekend\b/.test(lower)) {
    return vague("A week was mentioned, but not which day.");
  }

  if (targetDayOffset !== null) {
    const dayInstant = options.now + targetDayOffset * 86_400_000;
    const parts = instantToZonedParts(dayInstant, timezone);
    const clock = parseClockTime(lower);

    if (clock && !hasOnlyPartOfDayWithoutNumber(lower)) {
      const instant = zonedTimeToInstant(
        parts.year, parts.month, parts.day, clock.hour, clock.minute, timezone
      );
      return {
        kind: "exact",
        instant: new Date(instant).toISOString(),
        date: formatZonedDate(instant, timezone),
        time: formatZonedTime(instant, timezone),
        timezone,
        interpretation: `${dayLabel} at ${formatZonedTime(instant, timezone)}.`,
      };
    }

    return {
      kind: "dateOnly",
      instant: null,
      date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
      time: null,
      timezone,
      interpretation: hasOnlyPartOfDay(lower)
        ? `${dayLabel}, but only a part of the day was given.`
        : `${dayLabel}, but no time was given.`,
    };
  }

  // --- A bare time with no day means the next occurrence ---
  const clockOnly = parseClockTime(lower);
  if (clockOnly && !hasOnlyPartOfDayWithoutNumber(lower)) {
    let instant = zonedTimeToInstant(
      today.year, today.month, today.day, clockOnly.hour, clockOnly.minute, timezone
    );
    if (instant <= options.now) instant += 86_400_000;
    return {
      kind: "exact",
      instant: new Date(instant).toISOString(),
      date: formatZonedDate(instant, timezone),
      time: formatZonedTime(instant, timezone),
      timezone,
      interpretation: `The next ${formatZonedTime(instant, timezone)}.`,
    };
  }

  return vague("No date or time could be read from the request.");
}

/** True when the text gives a part of day and no digits — "evening", not "7 in the evening". */
function hasOnlyPartOfDayWithoutNumber(text: string): boolean {
  return hasOnlyPartOfDay(text) && !/\d/.test(text) && !/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.test(text);
}
