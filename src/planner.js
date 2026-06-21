import dayjs from 'dayjs';
import {
  ensureFutureOccurrences,
  getActiveEvents,
  getBookingWindowReminderCandidates,
  getEvent,
  getSetting,
  getPendingOccurrencesForEvent,
  hasBookingWindowReminderRun,
  hasRun,
  markOccurrenceAlerted,
  recordAvailability,
  recordBookingWindowReminderRun,
  recordRuns,
  setSetting
} from './database';
import {
  createAvailabilityNotification,
  createBookingWindowReminderNotification,
  createCaptchaNotification
} from './notifications';
import { requestAvailability } from './railClient';
import {
  ADVANCE_DAYS,
  BOOKING_WINDOW_OPEN_REMINDER_TIME,
  BOOKING_WINDOW_REMINDER_DAYS,
  currentLocalTime,
  DEFAULT_CHECK_TIMES,
  formatAvailabilitySummary,
  formatShortDate,
  generateTravelDates,
  hasCompleteRailDetails,
  isSelectedDateTrip,
  isBelowThresholdStatus,
  nowIso,
  parseAvailability
} from './utils';

function buildLowAvailabilityMessage(row, parsed) {
  if (parsed.available_count !== null && parsed.available_count !== undefined) {
    return `${formatShortDate(row.travel_date)} has only ${parsed.available_count} seats available. Please book the ticket.`;
  }

  return `${formatShortDate(row.travel_date)} status is ${parsed.availability_status}. Please review the ticket.`;
}

function alertSignature(parsed) {
  return [
    String(parsed.availability_status || '').trim().toUpperCase(),
    parsed.available_count ?? ''
  ].join('|');
}

function isTerminalAvailabilityError(statusText) {
  return /no\s+valid\s+profile|valid\s+train\s+number|valid\s+station|invalid\s+train|invalid\s+station/i.test(
    String(statusText || '')
  );
}

function normalizeAvailabilityDate(value) {
  const text = String(value || '').trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;

  return text;
}

function parseRawPayload(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

function findAvailabilityDays(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === 'object' && (item.availablityDate || item.availabilityDate))) return value;
    return value.flatMap(findAvailabilityDays);
  }
  if (Array.isArray(value.avlDayList)) return value.avlDayList;
  return Object.values(value).flatMap(findAvailabilityDays);
}

function availabilityDatesFromRaw(raw) {
  return new Set(
    findAvailabilityDays(parseRawPayload(raw))
      .map((day) => normalizeAvailabilityDate(day?.availablityDate || day?.availabilityDate || day?.date))
      .filter(Boolean)
  );
}

async function notifyIfNeeded(row, parsed, checkedAt, options = {}) {
  const belowThreshold = row.user_status === 'pending' && isBelowThresholdStatus(parsed, row.threshold);
  if (!options.suppressNotifications && belowThreshold) {
    const signature = alertSignature(parsed);
    if (signature !== row.last_alert_signature) {
      await createAvailabilityNotification(
        row.event_id,
        row.id,
        buildLowAvailabilityMessage(row, parsed),
        options.nativeNotification !== false
      );
      await markOccurrenceAlerted(row.id, signature, checkedAt);
    }
  } else if (!belowThreshold && row.last_alert_signature) {
    await markOccurrenceAlerted(row.id, null, null);
  }
}

function checkTimeValue(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time || '').trim());
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function dueScheduledTimes(checkTimes, localTime) {
  const currentValue = checkTimeValue(localTime);
  if (currentValue === null) return [];

  return checkTimes
    .map((time) => time.trim())
    .filter(Boolean)
    .filter((time) => {
      const value = checkTimeValue(time);
      return value !== null && value <= currentValue;
    });
}

function isAtOrAfterTime(localTime, thresholdTime) {
  const localValue = checkTimeValue(localTime);
  const thresholdValue = checkTimeValue(thresholdTime);
  return localValue !== null && thresholdValue !== null && localValue >= thresholdValue;
}

async function createCaptchaNotificationOncePerDay(event, runDate, options = {}) {
  if (options.suppressCaptchaNotifications) return;

  const key = `captcha_notification_date_${event.id}`;
  const lastNotificationDate = await getSetting(key, '');
  if (lastNotificationDate === runDate) return;

  await createCaptchaNotification(event.id, event.name, true);
  await setSetting(key, runDate);
}

export async function checkOccurrence(row, options = {}) {
  if (!row) return { notFound: true };
  if (row.user_status !== 'pending' && !options.force) {
    return { skipped: true, reason: `Occurrence is ${row.user_status}` };
  }

  const response = await requestAvailability(row, options);
  if (response.captchaRequired) return response;

  const parsed = parseAvailability(response.raw, row.travel_date);
  const checkedAt = nowIso();
  await recordAvailability(row, parsed, response.raw, checkedAt);
  await notifyIfNeeded(row, parsed, checkedAt, options);

  return {
    occurrenceId: row.id,
    travelDate: row.travel_date,
    availableCount: parsed.available_count,
    availabilityStatus: parsed.availability_status,
    availabilitySummary: formatAvailabilitySummary({ ...parsed, last_checked_at: checkedAt }),
    checkedAt,
    raw: response.raw
  };
}

async function recordOccurrenceFromRaw(row, raw, options = {}) {
  const parsed = parseAvailability(raw, row.travel_date);
  const checkedAt = nowIso();
  await recordAvailability(row, parsed, raw, checkedAt);
  await notifyIfNeeded(row, parsed, checkedAt, options);
  return {
    occurrenceId: row.id,
    travelDate: row.travel_date,
    availableCount: parsed.available_count,
    availabilityStatus: parsed.availability_status,
    availabilitySummary: formatAvailabilitySummary({ ...parsed, last_checked_at: checkedAt }),
    checkedAt,
    raw
  };
}

export async function validateTripAvailability(payload, options = {}) {
  const travelDates = isSelectedDateTrip(payload)
    ? (payload.selected_dates || []).map((item) => item.date)
    : generateTravelDates(payload, ADVANCE_DAYS);
  const travelDate = travelDates[0];
  if (!travelDate) {
    return {
      valid: false,
      message: 'No future travel date could be generated for this trip.'
    };
  }

  const row = {
    id: 0,
    event_id: 0,
    user_status: 'pending',
    travel_date: travelDate,
    train_no: payload.train_no,
    class_code: payload.class_code,
    quota: payload.quota,
    source_station: payload.source_station,
    destination_station: payload.destination_station,
    threshold: payload.threshold
  };

  const response = await requestAvailability(row, {
    validation: true,
    inputCaptcha: options.inputCaptcha || ''
  });
  if (response.captchaRequired) {
    return {
      valid: false,
      captchaRequired: true,
      message: 'CAPTCHA is required before validating these trip details. Complete one seat check to activate the rail session, then save again.'
    };
  }

  const parsed = parseAvailability(response.raw, travelDate);
  if (isTerminalAvailabilityError(parsed.availability_status)) {
    return {
      valid: false,
      message: parsed.availability_status
    };
  }

  return {
    valid: true,
    travelDate,
    availabilityStatus: parsed.availability_status,
    availableCount: parsed.available_count
  };
}

export async function checkEvent(eventId, options = {}) {
  const event = await getEvent(eventId);
  if (!event) return { notFound: true };
  if (!hasCompleteRailDetails(event)) {
    return {
      eventId: Number(eventId),
      checked: 0,
      skipped: true,
      reason: 'Train details are incomplete'
    };
  }

  const rows = await getPendingOccurrencesForEvent(eventId, {
    includeAllStatuses: Boolean(options.includeAllStatuses)
  });

  const results = [];
  const handledIds = new Set();
  const sharedInputCaptcha = options.inputCaptcha && options.reuseInputCaptcha !== false
    ? options.inputCaptcha
    : '';
  for (let index = 0; index < rows.length; index += 1) {
    if (handledIds.has(rows[index].id)) continue;

    const result = await checkOccurrence(rows[index], {
      ...options,
      force: options.force || options.includeAllStatuses,
      inputCaptcha: sharedInputCaptcha || (index === 0 ? options.inputCaptcha : '')
    });

    if (result.captchaRequired) {
      return { captchaRequired: true, detail: result.detail, results };
    }
    if (result.skipped) continue;

    results.push(result);
    handledIds.add(rows[index].id);

    const responseDates = availabilityDatesFromRaw(result.raw);
    if (!responseDates.size) {
      if (isTerminalAvailabilityError(result.availabilityStatus)) {
        break;
      }
      continue;
    }

    for (let followIndex = index + 1; followIndex < rows.length; followIndex += 1) {
      const row = rows[followIndex];
      if (handledIds.has(row.id) || !responseDates.has(row.travel_date)) continue;
      results.push(await recordOccurrenceFromRaw(row, result.raw, options));
      handledIds.add(row.id);
    }

    if (!options.deepCheck) break;
  }

  return { eventId: Number(eventId), checked: results.length, results };
}

export async function runDueScheduledChecks() {
  return runDueScheduledChecksWithOptions();
}

export async function runBookingWindowReminders(options = {}) {
  await ensureFutureOccurrences(false);
  const today = dayjs().startOf('day');
  const localTime = options.localTime || currentLocalTime();
  const candidates = await getBookingWindowReminderCandidates();
  let reminded = 0;

  for (const row of candidates) {
    const bookingOpenDate = dayjs(row.travel_date).subtract(ADVANCE_DAYS, 'day').startOf('day');
    const daysBefore = bookingOpenDate.diff(today, 'day');
    if (!BOOKING_WINDOW_REMINDER_DAYS.includes(daysBefore)) continue;
    if (daysBefore === 0 && !isAtOrAfterTime(localTime, BOOKING_WINDOW_OPEN_REMINDER_TIME)) continue;
    if (await hasBookingWindowReminderRun(row.event_id, row.travel_date, daysBefore)) continue;

    await createBookingWindowReminderNotification(
      row.event_id,
      row.occurrence_id,
      row.event_name,
      daysBefore,
      options.nativeNotification !== false
    );
    await recordBookingWindowReminderRun(row.event_id, row.travel_date, daysBefore);
    reminded += 1;
  }

  return { reminded };
}

export async function runDueScheduledChecksWithOptions(options = {}) {
  const localTime = currentLocalTime();
  const runDate = dayjs().format('YYYY-MM-DD');
  const reminderResult = await runBookingWindowReminders(options);
  await ensureFutureOccurrences(true);
  const events = await getActiveEvents();
  const dueEventRuns = [];
  let checked = 0;
  let captchaRequired = false;

  for (const event of events) {
    const checkTimes = String(event.check_times || DEFAULT_CHECK_TIMES).split(',').map((item) => item.trim());
    const dueTimes = dueScheduledTimes(checkTimes, localTime);
    if (!dueTimes.length) continue;

    const unrunDueTimes = [];
    for (const time of dueTimes) {
      if (!(await hasRun(event.id, runDate, time))) unrunDueTimes.push(time);
    }
    if (!unrunDueTimes.length) continue;

    dueEventRuns.push({
      eventId: event.id,
      eventName: event.name,
      runDate,
      scheduledTimes: unrunDueTimes
    });
  }

  for (let index = 0; index < dueEventRuns.length; index += 1) {
    const dueEventRun = dueEventRuns[index];
    const event = events.find((item) => item.id === dueEventRun.eventId);
    if (!event) continue;

    const result = await checkEvent(event.id, { automated: true, deepCheck: true });
    if (result.captchaRequired) {
      captchaRequired = true;
      await createCaptchaNotificationOncePerDay(event, runDate, options);
      return {
        checked,
        captchaRequired,
        captchaEventId: event.id,
        captchaEventName: event.name,
        captchaRunDate: dueEventRun.runDate,
        captchaScheduledTimes: dueEventRun.scheduledTimes,
        captchaResumeEventRuns: dueEventRuns.slice(index + 1),
        captchaResumeEventIds: dueEventRuns.slice(index + 1).map((item) => item.eventId),
        reminded: reminderResult.reminded
      };
    } else {
      await recordRuns(event.id, dueEventRun.runDate, dueEventRun.scheduledTimes);
      checked += result.checked || 0;
    }
  }

  return { checked, captchaRequired, reminded: reminderResult.reminded };
}
