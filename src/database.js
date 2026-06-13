import * as SQLite from 'expo-sqlite';
import dayjs from 'dayjs';
import {
  ADVANCE_DAYS,
  BOOKING_WINDOW_REMINDER_DAYS,
  OCCURRENCE_GENERATION_DAYS,
  generateTravelDates,
  normalizeEventPayload,
  nowIso,
  toIsoDate,
  validateEventPayload
} from './utils';

let dbPromise;

export async function getDb() {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync('trip-planner.sqlite');
  return dbPromise;
}

async function ensureColumn(db, tableName, columnName, definition) {
  const columns = await db.getAllAsync(`PRAGMA table_info(${tableName})`);
  if (!columns.some((column) => column.name === columnName)) {
    await db.execAsync(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

export async function initDatabase() {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS trip_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      weekday TEXT NOT NULL,
      recurrence_type TEXT NOT NULL DEFAULT 'weekly',
      start_date TEXT,
      train_no TEXT NOT NULL,
      train_name TEXT,
      class_code TEXT NOT NULL,
      quota TEXT NOT NULL,
      source_station TEXT NOT NULL,
      destination_station TEXT NOT NULL,
      threshold INTEGER NOT NULL DEFAULT 20,
      is_active INTEGER NOT NULL DEFAULT 1,
      booking_window_reminders INTEGER NOT NULL DEFAULT 0,
      check_times TEXT NOT NULL DEFAULT '08:00,13:00,20:00',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trip_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      travel_date TEXT NOT NULL,
      availability_status TEXT,
      available_count INTEGER,
      user_status TEXT NOT NULL DEFAULT 'pending',
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES trip_events(id) ON DELETE CASCADE,
      UNIQUE(event_id, travel_date)
    );

    CREATE TABLE IF NOT EXISTS availability_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      occurrence_id INTEGER NOT NULL,
      travel_date TEXT NOT NULL,
      available_count INTEGER,
      raw_response TEXT,
      checked_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES trip_events(id) ON DELETE CASCADE,
      FOREIGN KEY (occurrence_id) REFERENCES trip_occurrences(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      occurrence_id INTEGER,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES trip_events(id) ON DELETE CASCADE,
      FOREIGN KEY (occurrence_id) REFERENCES trip_occurrences(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_check_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      run_date TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      ran_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES trip_events(id) ON DELETE CASCADE,
      UNIQUE(event_id, run_date, scheduled_time)
    );

    CREATE TABLE IF NOT EXISTS booking_window_reminder_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      travel_date TEXT NOT NULL,
      days_before INTEGER NOT NULL,
      reminded_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES trip_events(id) ON DELETE CASCADE,
      UNIQUE(event_id, travel_date, days_before)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await ensureColumn(db, 'trip_events', 'check_times', "check_times TEXT NOT NULL DEFAULT '08:00,13:00,20:00'");
  await ensureColumn(db, 'trip_events', 'recurrence_type', "recurrence_type TEXT NOT NULL DEFAULT 'weekly'");
  await ensureColumn(db, 'trip_events', 'start_date', 'start_date TEXT');
  await ensureColumn(db, 'trip_events', 'booking_window_reminders', 'booking_window_reminders INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'trip_occurrences', 'last_alert_signature', 'last_alert_signature TEXT');
  await ensureColumn(db, 'trip_occurrences', 'last_alerted_at', 'last_alerted_at TEXT');
}

function mapEvent(row) {
  return row ? {
    ...row,
    recurrence_type: row.recurrence_type || 'weekly',
    start_date: row.start_date || '',
    booking_window_reminders: Boolean(row.booking_window_reminders),
    is_active: Boolean(row.is_active)
  } : null;
}

export async function insertOccurrences(eventId, schedule) {
  const db = await getDb();
  for (const travelDate of generateTravelDates(schedule, OCCURRENCE_GENERATION_DAYS)) {
    const timestamp = nowIso();
    await db.runAsync(`
      INSERT OR IGNORE INTO trip_occurrences (event_id, travel_date, user_status, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?)
    `, eventId, travelDate, timestamp, timestamp);
  }
}

export async function ensureFutureOccurrences(activeOnly = false) {
  const db = await getDb();
  const events = await db.getAllAsync(
    `SELECT id, weekday, recurrence_type, start_date FROM trip_events${activeOnly ? ' WHERE is_active = 1' : ''}`
  );

  for (const event of events) {
    await insertOccurrences(event.id, event);
  }

  return events.length;
}

export async function createEvent(body) {
  const db = await getDb();
  const payload = normalizeEventPayload(body);
  const error = validateEventPayload(payload);
  if (error) throw new Error(error);

  const timestamp = nowIso();
  const result = await db.runAsync(`
    INSERT INTO trip_events (
      name, weekday, recurrence_type, start_date, train_no, train_name, class_code, quota, source_station,
      destination_station, threshold, is_active, booking_window_reminders, check_times,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    payload.name,
    payload.weekday,
    payload.recurrence_type,
    payload.start_date,
    payload.train_no,
    payload.train_name,
    payload.class_code,
    payload.quota,
    payload.source_station,
    payload.destination_station,
    payload.threshold,
    payload.is_active,
    payload.booking_window_reminders,
    payload.check_times,
    timestamp,
    timestamp
  );

  await insertOccurrences(result.lastInsertRowId, payload);
  return getEvent(result.lastInsertRowId);
}

export async function updateEvent(id, body) {
  const db = await getDb();
  const existing = await getEvent(id);
  if (!existing) throw new Error('Event not found');

  const payload = normalizeEventPayload(body);
  const error = validateEventPayload(payload);
  if (error) throw new Error(error);

  await db.runAsync(`
    UPDATE trip_events
    SET name = ?, weekday = ?, recurrence_type = ?, start_date = ?, train_no = ?, train_name = ?, class_code = ?, quota = ?,
      source_station = ?, destination_station = ?, threshold = ?, is_active = ?, booking_window_reminders = ?,
      check_times = ?, updated_at = ?
    WHERE id = ?
  `,
    payload.name,
    payload.weekday,
    payload.recurrence_type,
    payload.start_date,
    payload.train_no,
    payload.train_name,
    payload.class_code,
    payload.quota,
    payload.source_station,
    payload.destination_station,
    payload.threshold,
    payload.is_active,
    payload.booking_window_reminders,
    payload.check_times,
    nowIso(),
    id
  );

  const shapeChanged = [
    'weekday',
    'recurrence_type',
    'start_date',
    'train_no',
    'class_code',
    'quota',
    'source_station',
    'destination_station'
  ].some((key) => {
    if (
      key === 'start_date'
      && (existing.recurrence_type || 'weekly') === 'weekly'
      && payload.recurrence_type === 'weekly'
    ) {
      return false;
    }
    return String(existing[key] || '') !== String(payload[key] || '');
  });

  if (shapeChanged) {
    const today = toIsoDate(new Date());
    await db.runAsync(`
      DELETE FROM trip_occurrences
      WHERE event_id = ? AND user_status = 'pending' AND travel_date >= ?
    `, id, today);
    await insertOccurrences(id, payload);
  }

  return getEvent(id);
}

export async function deleteEvent(id) {
  const db = await getDb();
  await db.runAsync('DELETE FROM notifications WHERE event_id = ?', id);
  await db.runAsync('DELETE FROM availability_checks WHERE event_id = ?', id);
  await db.runAsync('DELETE FROM trip_occurrences WHERE event_id = ?', id);
  await db.runAsync('DELETE FROM event_check_runs WHERE event_id = ?', id);
  await db.runAsync('DELETE FROM booking_window_reminder_runs WHERE event_id = ?', id);
  await db.runAsync('DELETE FROM trip_events WHERE id = ?', id);
}

export async function getEvent(id) {
  const db = await getDb();
  return mapEvent(await db.getFirstAsync('SELECT * FROM trip_events WHERE id = ?', id));
}

export async function getOccurrence(id) {
  const db = await getDb();
  return db.getFirstAsync(`
    SELECT
      o.*,
      e.name,
      e.train_no,
      e.class_code,
      e.quota,
      e.source_station,
      e.destination_station,
      e.threshold,
      e.is_active
    FROM trip_occurrences o
    JOIN trip_events e ON e.id = o.event_id
    WHERE o.id = ?
  `, id);
}

export async function getEventsWithOccurrences() {
  const db = await getDb();
  const events = await db.getAllAsync('SELECT * FROM trip_events ORDER BY is_active DESC, recurrence_type, weekday, name');
  const mapped = [];
  for (const event of events) {
    const occurrences = await db.getAllAsync(
      'SELECT * FROM trip_occurrences WHERE event_id = ? ORDER BY travel_date',
      event.id
    );
    mapped.push({ ...mapEvent(event), occurrences });
  }
  return mapped;
}

export async function getPendingOccurrencesForEvent(eventId, options = {}) {
  const db = await getDb();
  const today = toIsoDate(new Date());
  const end = dayjs().add(ADVANCE_DAYS, 'day').format('YYYY-MM-DD');
  const statusFilter = options.includeAllStatuses ? '' : "AND o.user_status = 'pending'";
  return db.getAllAsync(`
    SELECT
      o.*,
      e.name,
      e.train_no,
      e.class_code,
      e.quota,
      e.source_station,
      e.destination_station,
      e.threshold,
      e.is_active
    FROM trip_occurrences o
    JOIN trip_events e ON e.id = o.event_id
    WHERE o.event_id = ?
      AND o.travel_date BETWEEN ? AND ?
      ${statusFilter}
    ORDER BY o.travel_date
  `, eventId, today, end);
}

export async function getActiveEvents() {
  const db = await getDb();
  const rows = await db.getAllAsync('SELECT * FROM trip_events WHERE is_active = 1 ORDER BY name');
  return rows.map(mapEvent);
}

export async function getBookingWindowReminderCandidates() {
  const db = await getDb();
  const today = dayjs().startOf('day');
  const start = today.add(ADVANCE_DAYS + Math.min(...BOOKING_WINDOW_REMINDER_DAYS), 'day').format('YYYY-MM-DD');
  const end = today.add(ADVANCE_DAYS + Math.max(...BOOKING_WINDOW_REMINDER_DAYS), 'day').format('YYYY-MM-DD');

  return db.getAllAsync(`
    SELECT
      o.id AS occurrence_id,
      o.travel_date,
      e.id AS event_id,
      e.name AS event_name
    FROM trip_occurrences o
    JOIN trip_events e ON e.id = o.event_id
    WHERE e.booking_window_reminders = 1
      AND o.travel_date BETWEEN ? AND ?
    ORDER BY o.travel_date, e.name
  `, start, end);
}

export async function hasBookingWindowReminderRun(eventId, travelDate, daysBefore) {
  const db = await getDb();
  const row = await db.getFirstAsync(`
    SELECT id FROM booking_window_reminder_runs
    WHERE event_id = ? AND travel_date = ? AND days_before = ?
  `, eventId, travelDate, daysBefore);
  return Boolean(row);
}

export async function recordBookingWindowReminderRun(eventId, travelDate, daysBefore) {
  const db = await getDb();
  await db.runAsync(`
    INSERT OR IGNORE INTO booking_window_reminder_runs (event_id, travel_date, days_before, reminded_at)
    VALUES (?, ?, ?, ?)
  `, eventId, travelDate, daysBefore, nowIso());
}

export async function getEventLastCheckedAt(eventId) {
  const db = await getDb();
  const row = await db.getFirstAsync(`
    SELECT MAX(last_checked_at) AS last_checked_at
    FROM trip_occurrences
    WHERE event_id = ?
  `, eventId);
  return row?.last_checked_at || '';
}

export async function recordAvailability(row, parsed, raw, checkedAt) {
  const db = await getDb();
  const rawResponse = typeof raw === 'string' ? raw : JSON.stringify(raw);
  await db.runAsync(`
    INSERT INTO availability_checks (
      event_id, occurrence_id, travel_date, available_count, raw_response, checked_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, row.event_id, row.id, row.travel_date, parsed.available_count, rawResponse, checkedAt);

  await db.runAsync(`
    UPDATE trip_occurrences
    SET availability_status = ?, available_count = ?, last_checked_at = ?, updated_at = ?
    WHERE id = ?
  `, parsed.availability_status, parsed.available_count, checkedAt, checkedAt, row.id);
}

export async function markOccurrenceAlerted(id, signature, alertedAt = nowIso()) {
  const db = await getDb();
  const updatedAt = nowIso();
  await db.runAsync(`
    UPDATE trip_occurrences
    SET last_alert_signature = ?, last_alerted_at = ?, updated_at = ?
    WHERE id = ?
  `, signature || null, alertedAt || null, updatedAt, id);
}

export async function updateOccurrenceStatus(id, userStatus) {
  if (!['pending', 'booked', 'ignored'].includes(userStatus)) {
    throw new Error('Occurrence status must be pending, booked, or ignored');
  }

  const db = await getDb();
  await db.runAsync(`
    UPDATE trip_occurrences
    SET user_status = ?, updated_at = ?
    WHERE id = ?
  `, userStatus, nowIso(), id);

  if (userStatus === 'ignored') {
    await db.runAsync('DELETE FROM notifications WHERE occurrence_id = ?', id);
  }
}

export async function createNotificationRow(eventId, occurrenceId, message) {
  const db = await getDb();
  const result = await db.runAsync(`
    INSERT INTO notifications (event_id, occurrence_id, message, is_read, created_at)
    VALUES (?, ?, ?, 0, ?)
  `, eventId || null, occurrenceId || null, message, nowIso());
  return result.lastInsertRowId;
}

export async function getNotifications(limit = 50) {
  const db = await getDb();
  return db.getAllAsync('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?', limit);
}

export async function markNotificationRead(id) {
  const db = await getDb();
  await db.runAsync('UPDATE notifications SET is_read = 1 WHERE id = ?', id);
}

export async function clearNotifications() {
  const db = await getDb();
  await db.runAsync('DELETE FROM notifications');
}

export async function getSetting(key, fallback = '') {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT value FROM app_settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  const db = await getDb();
  await db.runAsync(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, key, String(value));
}

export async function getRunCount(eventId, runDate) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT COUNT(*) AS count FROM event_check_runs WHERE event_id = ? AND run_date = ?',
    eventId,
    runDate
  );
  return row?.count || 0;
}

export async function hasRun(eventId, runDate, scheduledTime) {
  const db = await getDb();
  const row = await db.getFirstAsync(`
    SELECT id FROM event_check_runs
    WHERE event_id = ? AND run_date = ? AND scheduled_time = ?
  `, eventId, runDate, scheduledTime);
  return Boolean(row);
}

export async function recordRun(eventId, runDate, scheduledTime) {
  const db = await getDb();
  await db.runAsync(`
    INSERT OR IGNORE INTO event_check_runs (event_id, run_date, scheduled_time, ran_at)
    VALUES (?, ?, ?, ?)
  `, eventId, runDate, scheduledTime, nowIso());
}

export async function recordRuns(eventId, runDate, scheduledTimes) {
  for (const scheduledTime of scheduledTimes) {
    await recordRun(eventId, runDate, scheduledTime);
  }
}

export async function cleanupOldData(options = {}) {
  const db = await getDb();
  const now = dayjs();
  const checksBefore = now.subtract(options.checkDays ?? 45, 'day').toISOString();
  const notificationsBefore = now.subtract(options.notificationDays ?? 30, 'day').toISOString();
  const runsBefore = now.subtract(options.runDays ?? 14, 'day').format('YYYY-MM-DD');
  const maxNotifications = options.maxNotifications ?? 100;

  await db.runAsync('DELETE FROM availability_checks WHERE checked_at < ?', checksBefore);
  await db.runAsync('DELETE FROM event_check_runs WHERE run_date < ?', runsBefore);
  await db.runAsync('DELETE FROM booking_window_reminder_runs WHERE reminded_at < ?', notificationsBefore);
  await db.runAsync(`
    DELETE FROM notifications
    WHERE is_read = 1
      AND created_at < ?
      AND id NOT IN (
        SELECT id FROM notifications
        ORDER BY created_at DESC
        LIMIT ?
      )
  `, notificationsBefore, maxNotifications);
}
