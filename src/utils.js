import dayjs from 'dayjs';

export const ADVANCE_DAYS = 60;
export const BOOKING_WINDOW_REMINDER_DAYS = [2, 1, 0];
export const BOOKING_WINDOW_OPEN_REMINDER_TIME = '06:00';
export const OCCURRENCE_GENERATION_DAYS = ADVANCE_DAYS + Math.max(...BOOKING_WINDOW_REMINDER_DAYS);
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DEFAULT_CHECK_TIMES = '06:00,13:00,20:00';
export const RECURRENCE_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: '15 days' },
  { value: 'monthly', label: 'Monthly' }
];
export const TRIP_TYPE_OPTIONS = [
  { value: 'regular', label: 'Regular Trip' },
  { value: 'holiday', label: 'Holiday Travel' },
  { value: 'seat_check', label: 'Seat Check Trip' }
];
export const CLASS_OPTIONS = [
  { value: '1A', label: 'FIRST AC' },
  { value: 'EC', label: 'EXECUTIVE CLASS' },
  { value: 'EA', label: 'EXECUTIVE ANUBHUTI' },
  { value: '2A', label: 'SECOND AC' },
  { value: '3A', label: 'THIRD AC' },
  { value: '3E', label: '3 AC Economy' },
  { value: 'CC', label: 'AC CHAIR CAR' },
  { value: 'FC', label: 'FIRST CLASS' },
  { value: 'SL', label: 'SLEEPER CLASS' },
  { value: '2S', label: 'SECOND SEATING' },
  { value: 'VS', label: 'VISTADOME NON AC' },
  { value: 'HS', label: 'HIGH CAPACITY SLEEPER' },
  { value: 'HC', label: 'HIGH CAPACITY VISTADOME_CC' },
  { value: 'EV', label: 'VISTADOME AC' }
];
export const QUOTA_OPTIONS = [
  { value: 'GN', label: 'General Quota' },
  { value: 'TQ', label: 'Tatkal Quota' },
  { value: 'PT', label: 'Premium Tatkal Quota' },
  { value: 'LD', label: 'Ladies Quota' },
  { value: 'DF', label: 'Defence Quota' },
  { value: 'FT', label: 'Foreign Tourist Quota' },
  { value: 'SS', label: 'Lower Berth Quota' },
  { value: 'YU', label: 'Yuva Quota' },
  { value: 'DP', label: 'Duty Pass Quota' },
  { value: 'HP', label: 'Handicaped Quota' },
  { value: 'PH', label: 'Parliament House' }
];

const EVENT_FIELD_LABELS = {
  name: 'Trip name',
  weekday: 'Travel weekday',
  train_no: 'Train',
  class_code: 'Class',
  quota: 'Quota',
  source_station: 'From station',
  destination_station: 'To station'
};

export function normalizeTripType(value) {
  const normalized = String(value || 'regular').trim().toLowerCase();
  if (normalized === 'holiday') return 'holiday';
  if (normalized === 'seat_check' || normalized === 'seat-check' || normalized === 'seatcheck') return 'seat_check';
  return 'regular';
}

export function isHolidayTrip(eventOrPayload) {
  return normalizeTripType(eventOrPayload?.trip_type ?? eventOrPayload?.tripType) === 'holiday';
}

export function isSeatCheckTrip(eventOrPayload) {
  return normalizeTripType(eventOrPayload?.trip_type ?? eventOrPayload?.tripType) === 'seat_check';
}

export function isSelectedDateTrip(eventOrPayload) {
  const tripType = normalizeTripType(eventOrPayload?.trip_type ?? eventOrPayload?.tripType);
  return tripType === 'holiday' || tripType === 'seat_check';
}

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

export function normalizeRecurrenceType(value) {
  const normalized = String(value || 'weekly').trim().toLowerCase();
  const aliases = {
    '15days': 'fortnightly',
    '15-days': 'fortnightly',
    fifteen: 'fortnightly',
    fortnight: 'fortnightly',
    fortnightly: 'fortnightly'
  };
  const recurrenceType = aliases[normalized] || normalized;
  return RECURRENCE_OPTIONS.some((option) => option.value === recurrenceType)
    ? recurrenceType
    : 'weekly';
}

export function normalizeIsoDate(value, fallback = toIsoDate(new Date())) {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return fallback;

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const isValid = parsed.getFullYear() === Number(match[1])
    && parsed.getMonth() === Number(match[2]) - 1
    && parsed.getDate() === Number(match[3]);
  return isValid ? text : fallback;
}

export function normalizeSelectedHolidayDates(value) {
  const rawValues = Array.isArray(value) ? value : [];
  const byDate = new Map();

  for (const item of rawValues) {
    const date = normalizeIsoDate(
      typeof item === 'string' ? item : item?.date ?? item?.travel_date ?? item?.travelDate,
      ''
    );
    if (!date) continue;

    const sourceLabel = String(
      typeof item === 'string'
        ? 'Custom date'
        : item?.source_label ?? item?.sourceLabel ?? item?.name ?? item?.label ?? 'Custom date'
    ).trim() || 'Custom date';

    if (!byDate.has(date) || byDate.get(date).source_label === 'Custom date') {
      byDate.set(date, { date, source_label: sourceLabel });
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function normalizeCheckTimes(value) {
  const rawValues = Array.isArray(value) ? value : String(value || '').split(',');
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

  return times.join(',');
}

export function invalidCheckTimes(value) {
  const rawValues = Array.isArray(value) ? value : String(value || '').split(',');
  return rawValues
    .map((item) => String(item).trim())
    .filter(Boolean)
    .filter((item) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(item);
      if (!match) return true;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      return hour > 23 || minute > 59;
    });
}

export function currentLocalTime() {
  return dayjs().format('HH:mm');
}

export function generateTravelDates(schedule, days = ADVANCE_DAYS) {
  if (typeof schedule === 'string') {
    schedule = { weekday: schedule, recurrence_type: 'weekly' };
  }

  const recurrenceType = normalizeRecurrenceType(schedule?.recurrence_type ?? schedule?.recurrenceType);
  const startDate = normalizeIsoDate(schedule?.start_date ?? schedule?.startDate);
  const today = dayjs().startOf('day');
  const end = today.add(days, 'day');
  const dates = [];

  if (recurrenceType === 'daily') {
    let cursor = dayjs(startDate).startOf('day');
    if (cursor.isBefore(today)) cursor = today;
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      dates.push(cursor.format('YYYY-MM-DD'));
      cursor = cursor.add(1, 'day');
    }
    return dates;
  }

  if (recurrenceType === 'fortnightly' || recurrenceType === 'monthly') {
    let cursor = dayjs(startDate).startOf('day');
    while (cursor.isBefore(today)) {
      cursor = recurrenceType === 'fortnightly'
        ? cursor.add(15, 'day')
        : cursor.add(1, 'month');
    }
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      dates.push(cursor.format('YYYY-MM-DD'));
      cursor = recurrenceType === 'fortnightly'
        ? cursor.add(15, 'day')
        : cursor.add(1, 'month');
    }
    return dates;
  }

  const normalized = normalizeWeekday(schedule?.weekday);
  const targetDay = WEEKDAYS.indexOf(normalized);
  if (targetDay === -1) return [];

  let cursor = today;

  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    if (cursor.day() === targetDay) dates.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.add(1, 'day');
  }

  return dates;
}

export function parseAvailableCount(statusText) {
  if (isNotAvailableStatus(statusText)) return null;
  const availableMatch = String(statusText || '').match(/AVAILABLE\s*[-:]?\s*0*(\d+)/i);
  return availableMatch ? Number(availableMatch[1]) : null;
}

export function isNotAvailableStatus(statusText) {
  return /NOT\s+AVAILABLE|REGRET|NOT\s+RUNNING|TRAIN\s+CANCELLED/i.test(String(statusText || ''));
}

export function isAvailableStatus(statusText) {
  return !isNotAvailableStatus(statusText) && /\bAVAILABLE\s*[-:]?\s*\d+/i.test(String(statusText || ''));
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
  if (isNotAvailableStatus(occurrenceOrParsed.availability_status)) return false;
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
  if (isNotAvailableStatus(status)) {
    if (/REGRET/i.test(status)) return 'Regret';
    if (/NOT\s+RUNNING/i.test(status)) return 'Not running';
    if (/TRAIN\s+CANCELLED/i.test(status)) return 'Train cancelled';
    return 'Not available';
  }
  if (isAvailableStatus(status) && (hasCount || parsedCount !== null)) {
    const count = hasCount ? occurrence.available_count : parsedCount;
    return `${count} confirmed ticket${count === 1 ? '' : 's'}`;
  }

  const racMatch = status.match(/RAC\s*0*(\d+)/i);
  if (racMatch) return `RAC ${Number(racMatch[1])}`;
  if (hasWaitlistStatus(status)) return `Waitlist: ${status.replace(/\//g, ' / ')}`;
  return status || 'Checked';
}

function trainNumberFromInput(value) {
  const match = String(value || '').match(/\b\d{4,6}\b/);
  return match ? match[0] : String(value || '').trim();
}

function stationCodeFromInput(value) {
  const text = String(value || '').trim().toUpperCase();
  const trailingCode = text.match(/-\s*([A-Z0-9]{2,6})\s*$/);
  if (trailingCode) return trailingCode[1];

  const leadingCode = text.match(/^([A-Z0-9]{2,6})\s*-/);
  if (leadingCode) return leadingCode[1];

  return text;
}

function compactOptionText(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function optionCodeFromInput(value, options) {
  const text = String(value || '').trim();
  const upperText = text.toUpperCase();
  const explicitCode = upperText.match(/^([A-Z0-9]{1,6})\s*-/);
  if (explicitCode && options.some((option) => option.value === explicitCode[1])) return explicitCode[1];

  const direct = options.find((option) => option.value === upperText);
  if (direct) return direct.value;

  const compactText = compactOptionText(text);
  const labelMatch = options.find((option) => compactOptionText(option.label) === compactText);
  return labelMatch ? labelMatch.value : upperText;
}

export function normalizeEventPayload(body) {
  const thresholdInput = body.threshold;
  const threshold = String(thresholdInput).trim() === '' ? Number.NaN : Number(thresholdInput);
  const rawCheckTimesInput = body.check_times ?? body.checkTimes;
  const checkTimesInput = rawCheckTimesInput === undefined
    || rawCheckTimesInput === null
    || String(rawCheckTimesInput).trim() === ''
    ? DEFAULT_CHECK_TIMES
    : rawCheckTimesInput;
  const checkTimes = normalizeCheckTimes(checkTimesInput);
  const recurrenceType = normalizeRecurrenceType(body.recurrence_type ?? body.recurrenceType);
  const startDateInput = body.start_date ?? body.startDate ?? toIsoDate(new Date());
  const startDate = normalizeIsoDate(startDateInput, '');
  const isActive = body.is_active === undefined && body.isActive === undefined
    ? 1
    : Number(Boolean(body.is_active ?? body.isActive));
  const tripType = normalizeTripType(body.trip_type ?? body.tripType);

  return {
    trip_type: tripType,
    name: String(body.name || '').trim(),
    weekday: normalizeWeekday(body.weekday),
    recurrence_type: recurrenceType,
    start_date: startDate,
    train_no: trainNumberFromInput(body.train_no ?? body.trainNo),
    train_name: '',
    class_code: optionCodeFromInput(body.class_code ?? body.classCode ?? body.classc, CLASS_OPTIONS),
    quota: optionCodeFromInput(body.quota, QUOTA_OPTIONS),
    source_station: stationCodeFromInput(body.source_station ?? body.sourceStation),
    destination_station: stationCodeFromInput(body.destination_station ?? body.destinationStation),
    threshold: Number.isFinite(threshold) ? threshold : 0,
    invalid_threshold: !Number.isFinite(threshold) || !Number.isInteger(threshold),
    check_times: checkTimes,
    invalid_check_times: invalidCheckTimes(checkTimesInput),
    invalid_start_date: !startDate,
    booking_window_reminders: Number(Boolean(body.booking_window_reminders ?? body.bookingWindowReminders)),
    is_active: isActive,
    selected_dates: normalizeSelectedHolidayDates(body.selected_dates ?? body.selectedDates)
  };
}

export function hasCompleteRailDetails(eventOrPayload) {
  return Boolean(
    eventOrPayload?.train_no
      && eventOrPayload?.class_code
      && eventOrPayload?.quota
      && eventOrPayload?.source_station
      && eventOrPayload?.destination_station
  );
}

export function hasAnyRailDetails(eventOrPayload) {
  return Boolean(
    eventOrPayload?.train_no
      || eventOrPayload?.class_code
      || eventOrPayload?.quota
      || eventOrPayload?.source_station
      || eventOrPayload?.destination_station
  );
}

export function validateEventPayload(payload) {
  const required = ['name'];
  const holidayTrip = isHolidayTrip(payload);
  const seatCheckTrip = isSeatCheckTrip(payload);
  const selectedDateTrip = isSelectedDateTrip(payload);
  const railDetailsRequired = !holidayTrip;

  if (railDetailsRequired) {
    required.push('train_no', 'class_code', 'quota', 'source_station', 'destination_station');
  }
  if (!selectedDateTrip && payload.recurrence_type === 'weekly') required.push('weekday');
  const missing = required.filter((field) => !payload[field]);
  if (missing.length) {
    return `Please fill: ${missing.map((field) => EVENT_FIELD_LABELS[field] || field).join(', ')}`;
  }
  if (holidayTrip && !payload.selected_dates.length) return 'Choose at least one holiday travel date';
  if (seatCheckTrip && !payload.selected_dates.length) return 'Choose at least one travel date inside the booking window';
  if (holidayTrip) {
    const bookingEnd = dayjs().startOf('day').add(ADVANCE_DAYS, 'day');
    const insideOrPastWindow = payload.selected_dates.find((item) => {
      const travelDate = dayjs(item.date).startOf('day');
      return !travelDate.isAfter(bookingEnd);
    });
    if (insideOrPastWindow) return 'Holiday Travel dates must be after the current booking window';
  }
  if (seatCheckTrip) {
    const today = dayjs().startOf('day');
    const bookingEnd = today.add(ADVANCE_DAYS, 'day');
    const outsideWindow = payload.selected_dates.find((item) => {
      const travelDate = dayjs(item.date).startOf('day');
      return travelDate.isBefore(today) || travelDate.isAfter(bookingEnd);
    });
    if (outsideWindow) return 'Seat Check Trip dates must be inside the current booking window';
  }
  if (!selectedDateTrip && !RECURRENCE_OPTIONS.some((option) => option.value === payload.recurrence_type)) return 'Choose a valid travel frequency';
  if (!selectedDateTrip && (payload.invalid_start_date || !/^\d{4}-\d{2}-\d{2}$/.test(payload.start_date))) return 'Start date must use YYYY-MM-DD';
  if (railDetailsRequired && !/^\d{4,6}$/.test(payload.train_no)) return 'Train number must be 4 to 6 digits';
  if (railDetailsRequired && !CLASS_OPTIONS.some((option) => option.value === payload.class_code)) return 'Choose a valid class';
  if (railDetailsRequired && !QUOTA_OPTIONS.some((option) => option.value === payload.quota)) return 'Choose a valid quota';
  if (railDetailsRequired && !/^[A-Z0-9]{2,6}$/.test(payload.source_station)) return 'From station must be a 2 to 6 character station code';
  if (railDetailsRequired && !/^[A-Z0-9]{2,6}$/.test(payload.destination_station)) return 'To station must be a 2 to 6 character station code';
  if (railDetailsRequired && payload.source_station === payload.destination_station) return 'From and To stations must be different';
  if (payload.is_active && railDetailsRequired && payload.invalid_threshold) return 'Seat alert limit is required for active monitoring';
  if (payload.is_active && railDetailsRequired && payload.threshold < 0) return 'Seat alert limit must be zero or greater';
  if (payload.is_active && railDetailsRequired && payload.invalid_check_times?.length) {
    return `Invalid check time(s): ${payload.invalid_check_times.join(', ')}. Use HH:mm in 24-hour time.`;
  }
  if (payload.is_active && railDetailsRequired && !payload.check_times) return 'At least one check time is required for active monitoring';
  return '';
}
