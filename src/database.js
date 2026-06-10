import * as SQLite from 'expo-sqlite';
import dayjs from 'dayjs';
import {
  ADVANCE_DAYS,
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
      train_no TEXT NOT NULL,
      train_name TEXT,
      class_code TEXT NOT NULL,
      quota TEXT NOT NULL,
      source_station TEXT NOT NULL,
      destination_station TEXT NOT NULL,
      threshold INTEGER NOT NULL DEFAULT 20,
      is_active INTEGER NOT NULL DEFAULT 1,
      check_times TEXT NOT NULL DEFAULT '08:00,13:00,20:00',
      max_triggers_per_day INTEGER NOT NULL DEFAULT 3,
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

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await ensureColumn(db, 'trip_events', 'check_times', "check_times TEXT NOT NULL DEFAULT '08:00,13:00,20:00'");
  await ensureColumn(db, 'trip_events', 'max_triggers_per_day', 'max_triggers_per_day INTEGER NOT NULL DEFAULT 3');
}

function mapEvent(row) {
  return row ? { ...row, is_active: Boolean(row.is_active) } : null;
}

export async function insertOccurrences(eventId, weekday) {
  const db = await getDb();
  for (const travelDate of generateTravelDates(weekday)) {
    const timestamp = nowIso();
    await db.runAsync(`
      INSERT OR IGNORE INTO trip_occurrences (event_id, travel_date, user_status, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?)
    `, eventId, travelDate, timestamp, timestamp);
  }
}

export async function createEvent(body) {
  const db = await getDb();
  const payload = normalizeEventPayload(body);
  const error = validateEventPayload(payload);
  if (error) throw new Error(error);

  const timestamp = nowIso();
  const result = await db.runAsync(`
    INSERT INTO trip_events (
      name, weekday, train_no, train_name, class_code, quota, source_station,
      destination_station, threshold, is_active, check_times, max_triggers_per_day,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    payload.name,
    payload.weekday,
    payload.train_no,
    payload.train_name,
    payload.class_code,
    payload.quota,
    payload.source_station,
    payload.destination_station,
    payload.threshold,
    payload.is_active,
    payload.check_times,
    payload.max_triggers_per_day,
    timestamp,
    timestamp
  );

  await insertOccurrences(result.lastInsertRowId, payload.weekday);
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
    SET name = ?, weekday = ?, train_no = ?, train_name = ?, class_code = ?, quota = ?,
      source_station = ?, destination_station = ?, threshold = ?, is_active = ?,
      check_times = ?, max_triggers_per_day = ?, updated_at = ?
    WHERE id = ?
  `,
    payload.name,
    payload.weekday,
    payload.train_no,
    payload.train_name,
    payload.class_code,
    payload.quota,
    payload.source_station,
    payload.destination_station,
    payload.threshold,
    payload.is_active,
    payload.check_times,
    payload.max_triggers_per_day,
    nowIso(),
    id
  );

  const shapeChanged = [
    'weekday',
    'train_no',
    'class_code',
    'quota',
    'source_station',
    'destination_station'
  ].some((key) => String(existing[key]) !== String(payload[key]));

  if (shapeChanged) {
    const today = toIsoDate(new Date());
    await db.runAsync(`
      DELETE FROM trip_occurrences
      WHERE event_id = ? AND user_status = 'pending' AND travel_date >= ?
    `, id, today);
    await insertOccurrences(id, payload.weekday);
  }

  return getEvent(id);
}

export async function deleteEvent(id) {
  const db = await getDb();
  await db.runAsync('DELETE FROM notifications WHERE event_id = ?', id);
  await db.runAsync('DELETE FROM availability_checks WHERE event_id = ?', id);
  await db.runAsync('DELETE FROM trip_occurrences WHERE event_id = ?', id);
  await db.runAsync('DELETE FROM event_check_runs WHERE event_id = ?', id);
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
  const events = await db.getAllAsync('SELECT * FROM trip_events ORDER BY is_active DESC, weekday, name');
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

export async function getPendingOccurrencesForEvent(eventId) {
  const db = await getDb();
  const today = toIsoDate(new Date());
  const end = dayjs().add(ADVANCE_DAYS, 'day').format('YYYY-MM-DD');
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
      AND o.user_status = 'pending'
      AND o.travel_date BETWEEN ? AND ?
    ORDER BY o.travel_date
  `, eventId, today, end);
}

export async function getActiveEvents() {
  const db = await getDb();
  const rows = await db.getAllAsync('SELECT * FROM trip_events WHERE is_active = 1 ORDER BY name');
  return rows.map(mapEvent);
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
