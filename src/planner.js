import dayjs from 'dayjs';
import {
  getActiveEvents,
  getEvent,
  getPendingOccurrencesForEvent,
  getRunCount,
  hasRun,
  recordAvailability,
  recordRun
} from './database';
import { createAvailabilityNotification, createCaptchaNotification } from './notifications';
import { requestAvailability } from './railClient';
import {
  currentLocalTime,
  formatAvailabilitySummary,
  formatShortDate,
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

  if (!options.suppressNotifications && row.user_status === 'pending' && isBelowThresholdStatus(parsed, row.threshold)) {
    await createAvailabilityNotification(
      row.event_id,
      row.id,
      buildLowAvailabilityMessage(row, parsed),
      options.nativeNotification !== false
    );
  }

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

export async function checkEvent(eventId, options = {}) {
  const event = await getEvent(eventId);
  if (!event) return { notFound: true };

  const rows = await getPendingOccurrencesForEvent(eventId);
  const results = [];
  for (let index = 0; index < rows.length; index += 1) {
    const result = await checkOccurrence(rows[index], {
      ...options,
      inputCaptcha: index === 0 ? options.inputCaptcha : ''
    });

    if (result.captchaRequired) {
      return { captchaRequired: true, detail: result.detail, results };
    }
    if (!result.skipped) results.push(result);
  }

  return { eventId: Number(eventId), checked: results.length, results };
}

export async function runDueScheduledChecks() {
  const localTime = currentLocalTime();
  const runDate = dayjs().format('YYYY-MM-DD');
  const events = await getActiveEvents();
  let checked = 0;
  let captchaRequired = false;

  for (const event of events) {
    const checkTimes = String(event.check_times || '08:00,13:00,20:00').split(',').map((item) => item.trim());
    if (!checkTimes.includes(localTime)) continue;

    const runCount = await getRunCount(event.id, runDate);
    if (runCount >= Number(event.max_triggers_per_day || checkTimes.length)) continue;
    if (await hasRun(event.id, runDate, localTime)) continue;

    await recordRun(event.id, runDate, localTime);
    const result = await checkEvent(event.id, { automated: true });
    if (result.captchaRequired) {
      captchaRequired = true;
      await createCaptchaNotification(event.id, event.name, true);
    } else {
      checked += result.checked || 0;
    }
  }

  return { checked, captchaRequired };
}
