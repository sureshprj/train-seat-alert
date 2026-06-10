import dayjs from 'dayjs';

export const ADVANCE_DAYS = 60;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DEFAULT_CHECK_TIMES = '08:00,13:00,20:00';

export function nowIso() {
  return new Date().toISOString();
}

export function toIsoDate(date) {
  return dayjs(date).format('YYYY-MM-DD');
}

export function toIndianRailDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

export function formatShortDate(value) {
  return dayjs(value).format('MMM D');
}

export function formatDisplayDate(value) {
  return dayjs(value).format('ddd, MMM D');
}

export function formatDateTime(value) {
  return value ? dayjs(value).format('MMM D, h:mm A') : 'Never';
}

export function normalizeWeekday(value) {
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const index = Number(value);
    if (index >= 0 && index < WEEKDAYS.length) return WEEKDAYS[index];
  }

  const match = WEEKDAYS.find((day) => day.toLowerCase() === String(value || '').trim().toLowerCase());
  return match || '';
}

export function normalizeCheckTimes(value) {
  const rawValues = Array.isArray(value) ? value : String(value || DEFAULT_CHECK_TIMES).split(',');
  const times = [...new Set(rawValues
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(item);
      if (!match) return '';
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour > 23 || minute > 59) return '';
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    })
    .filter(Boolean))]
    .sort();

  return times.length ? times.join(',') : DEFAULT_CHECK_TIMES;
}

export function currentLocalTime() {
  return dayjs().format('HH:mm');
}

export function generateTravelDates(weekday, days = ADVANCE_DAYS) {
  const normalized = normalizeWeekday(weekday);
  const targetDay = WEEKDAYS.indexOf(normalized);
  if (targetDay === -1) return [];

  const dates = [];
  let cursor = dayjs().startOf('day');
  const end = cursor.add(days, 'day');

  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    if (cursor.day() === targetDay) dates.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.add(1, 'day');
  }

  return dates;
}

export function parseAvailableCount(statusText) {
  const availableMatch = String(statusText || '').match(/AVAILABLE\s*[-:]?\s*0*(\d+)/i);
  return availableMatch ? Number(availableMatch[1]) : null;
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
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonStart = trimmed.search(/[\[{]/);
    const jsonEnd = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
}

function findAvailabilityDays(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === 'object' && item.availablityStatus)) return value;
    return value.flatMap(findAvailabilityDays);
  }

  if (Array.isArray(value.avlDayList)) return value.avlDayList;
  return Object.values(value).flatMap(findAvailabilityDays);
}

function statusFromAvailabilityDay(day) {
  return String(day?.availablityStatus || day?.availabilityStatus || day?.status || '').trim();
}

function getResponseMessage(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const direct = payload.errorMessage || payload.informationMessage || payload.message || payload.statusMessage;
  if (direct) return String(direct);

  for (const value of Object.values(payload)) {
    const nested = getResponseMessage(value);
    if (nested) return nested;
  }
  return '';
}

function stringifySnippet(value, maxLength = 180) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function flattenValues(value, values = []) {
  if (value === null || value === undefined) return values;
  if (typeof value === 'string' || typeof value === 'number') {
    values.push(String(value));
    return values;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenValues(item, values));
    return values;
  }
  if (typeof value === 'object') Object.values(value).forEach((item) => flattenValues(item, values));
  return values;
}

export function parseAvailability(raw, travelDate) {
  const payload = parseRawPayload(raw);
  const availabilityDays = findAvailabilityDays(payload);

  if (availabilityDays.length) {
    const targetDate = normalizeAvailabilityDate(travelDate);
    const matchingDay = availabilityDays.find((day) => {
      const dayDate = day?.availablityDate || day?.availabilityDate || day?.date;
      return normalizeAvailabilityDate(dayDate) === targetDate;
    });
    const statusText = statusFromAvailabilityDay(matchingDay);

    return {
      available_count: parseAvailableCount(statusText),
      availability_status: statusText || `No availability returned for ${travelDate}`
    };
  }

  const values = flattenValues(payload);
  const statusText = values.find((value) => /AVAILABLE|RAC|WL|REGRET|NOT AVAILABLE|NOT RUNNING|TRAIN CANCELLED/i.test(value)) || '';
  const responseMessage = getResponseMessage(payload);
  const fallbackStatus = responseMessage || stringifySnippet(payload) || 'No availability status returned';
  return {
    available_count: parseAvailableCount(statusText) ?? parseAvailableCount(values.join(' ')),
    availability_status: statusText || fallbackStatus
  };
}

export function hasWaitlistStatus(statusText) {
  return /(^|\/)[A-Z]*WL/i.test(String(statusText || ''));
}

export function hasRacStatus(statusText) {
  return /RAC/i.test(String(statusText || ''));
}

export function isBelowThresholdStatus(occurrenceOrParsed, threshold) {
  if (occurrenceOrParsed.available_count !== null && occurrenceOrParsed.available_count !== undefined) {
    return Number(occurrenceOrParsed.available_count) <= Number(threshold);
  }

  return hasRacStatus(occurrenceOrParsed.availability_status) || hasWaitlistStatus(occurrenceOrParsed.availability_status);
}

export function formatAvailabilitySummary(occurrence) {
  const status = occurrence.availability_status || '';
  const hasCount = occurrence.available_count !== null && occurrence.available_count !== undefined;
  const parsedCount = parseAvailableCount(status);

  if (!status && !occurrence.last_checked_at) return 'Not checked';
  if (/AVAILABLE/i.test(status) && (hasCount || parsedCount !== null)) {
    const count = hasCount ? occurrence.available_count : parsedCount;
    return `${count} confirmed ticket${count === 1 ? '' : 's'}`;
  }

  const racMatch = status.match(/RAC\s*0*(\d+)/i);
  if (racMatch) return `RAC ${Number(racMatch[1])}`;
  if (hasWaitlistStatus(status)) return `Waitlist: ${status.replace(/\//g, ' / ')}`;
  if (/REGRET/i.test(status)) return 'Regret';
  if (/NOT AVAILABLE/i.test(status)) return 'Not available';
  return status || 'Checked';
}

export function normalizeEventPayload(body) {
  const threshold = Number(body.threshold ?? 20);
  const checkTimes = normalizeCheckTimes(body.check_times ?? body.checkTimes);
  const maxTriggers = Number(body.max_triggers_per_day ?? body.maxTriggersPerDay ?? checkTimes.split(',').length);

  return {
    name: String(body.name || '').trim(),
    weekday: normalizeWeekday(body.weekday),
    train_no: String(body.train_no ?? body.trainNo ?? '').trim(),
    train_name: '',
    class_code: String(body.class_code ?? body.classCode ?? body.classc ?? '').trim().toUpperCase(),
    quota: String(body.quota || 'GN').trim().toUpperCase(),
    source_station: String(body.source_station ?? body.sourceStation ?? '').trim().toUpperCase(),
    destination_station: String(body.destination_station ?? body.destinationStation ?? '').trim().toUpperCase(),
    threshold: Number.isFinite(threshold) ? threshold : 20,
    check_times: checkTimes,
    max_triggers_per_day: Number.isFinite(maxTriggers) && maxTriggers > 0
      ? Math.floor(maxTriggers)
      : checkTimes.split(',').length,
    is_active: body.is_active === undefined && body.isActive === undefined
      ? 1
      : Number(Boolean(body.is_active ?? body.isActive))
  };
}

export function validateEventPayload(payload) {
  const required = ['name', 'weekday', 'train_no', 'class_code', 'quota', 'source_station', 'destination_station'];
  const missing = required.filter((field) => !payload[field]);
  if (missing.length) return `Missing required field(s): ${missing.join(', ')}`;
  if (payload.threshold < 0) return 'Threshold must be zero or greater';
  if (!payload.check_times) return 'At least one check time is required';
  if (payload.max_triggers_per_day < 1) return 'Max triggers per day must be at least 1';
  return '';
}
