const assert = require('node:assert/strict');
const test = require('node:test');
const dayjs = require('dayjs');
const { loadSourceModule } = require('./loadSourceModule');

const {
  WEEKDAYS,
  generateTravelDates,
  normalizeEventPayload,
  parseAvailability,
  validateEventPayload,
  formatAvailabilitySummary
} = loadSourceModule('src/utils.js');

test('generateTravelDates includes today for a matching weekly schedule', () => {
  const today = dayjs().format('YYYY-MM-DD');
  const weekday = WEEKDAYS[dayjs().day()];

  assert.deepEqual(generateTravelDates({ weekday }, 0), [today]);
});

test('generateTravelDates advances fixed-interval schedules from the start date', () => {
  const today = dayjs().format('YYYY-MM-DD');
  const expected = [
    today,
    dayjs(today).add(15, 'day').format('YYYY-MM-DD'),
    dayjs(today).add(30, 'day').format('YYYY-MM-DD')
  ];

  assert.deepEqual(
    generateTravelDates({ recurrence_type: 'fortnightly', start_date: today }, 30),
    expected
  );
});

test('generateTravelDates covers daily schedules from today through the horizon', () => {
  const today = dayjs().format('YYYY-MM-DD');

  assert.deepEqual(
    generateTravelDates({ recurrence_type: 'daily', start_date: today }, 2),
    [
      today,
      dayjs(today).add(1, 'day').format('YYYY-MM-DD'),
      dayjs(today).add(2, 'day').format('YYYY-MM-DD')
    ]
  );
});

test('generateTravelDates covers monthly schedules without drifting recurrence type', () => {
  const today = dayjs().format('YYYY-MM-DD');

  assert.deepEqual(
    generateTravelDates({ recurrence_type: 'monthly', start_date: today }, 65),
    [
      today,
      dayjs(today).add(1, 'month').format('YYYY-MM-DD'),
      dayjs(today).add(2, 'month').format('YYYY-MM-DD')
    ]
  );
});

test('normalizeEventPayload extracts codes from user-facing labels', () => {
  const payload = normalizeEventPayload({
    name: 'Chennai trip',
    weekday: 'Tuesday',
    train_no: '12627 - KARNATAKA EXP',
    class_code: '3A - THIRD AC',
    quota: 'Tatkal Quota',
    source_station: 'MGR CHENNAI CTL - MAS',
    destination_station: 'SBC - KSR BENGALURU',
    threshold: '12',
    check_times: ['8:00', '13:30', '13:30'],
    booking_window_reminders: true,
    is_active: true
  });

  assert.equal(payload.train_no, '12627');
  assert.equal(payload.class_code, '3A');
  assert.equal(payload.quota, 'TQ');
  assert.equal(payload.source_station, 'MAS');
  assert.equal(payload.destination_station, 'SBC');
  assert.equal(payload.threshold, 12);
  assert.equal(payload.check_times, '08:00,13:30');
  assert.equal(payload.booking_window_reminders, 1);
});

test('validateEventPayload reports invalid form inputs clearly', () => {
  assert.equal(
    validateEventPayload(normalizeEventPayload({
      name: '',
      weekday: '',
      train_no: '',
      class_code: '',
      quota: '',
      source_station: '',
      destination_station: '',
      threshold: '',
      check_times: '',
      is_active: true
    })),
    'Please fill: Trip name, Train, Class, Quota, From station, To station, Travel weekday'
  );

  assert.equal(
    validateEventPayload(normalizeEventPayload({
      name: 'Bad route',
      weekday: 'Monday',
      train_no: '12345',
      class_code: 'SL',
      quota: 'GN',
      source_station: 'MAS',
      destination_station: 'MAS',
      threshold: '5',
      check_times: '25:90',
      is_active: true
    })),
    'From and To stations must be different'
  );

  assert.equal(
    validateEventPayload(normalizeEventPayload({
      name: 'Bad time',
      weekday: 'Monday',
      train_no: '12345',
      class_code: 'SL',
      quota: 'GN',
      source_station: 'MAS',
      destination_station: 'SBC',
      threshold: '5',
      check_times: '25:90',
      is_active: true
    })),
    'Invalid check time(s): 25:90. Use HH:mm in 24-hour time.'
  );
});

test('parseAvailability reads target-day availability from Indian Rail response shapes', () => {
  const parsed = parseAvailability({
    data: {
      avlDayList: [
        { availablityDate: '20-06-2026', availablityStatus: 'AVAILABLE-0005' },
        { availablityDate: '21-06-2026', availablityStatus: 'WL 12' }
      ]
    }
  }, '2026-06-20');

  assert.equal(parsed.available_count, 5);
  assert.equal(parsed.availability_status, 'AVAILABLE-0005');
});

test('parseAvailability tolerates wrapped JSON text responses', () => {
  const raw = 'callback({"avlDayList":[{"availablityDate":"20-06-2026","availablityStatus":"RAC 3"}]})';
  const parsed = parseAvailability(raw, '2026-06-20');

  assert.equal(parsed.available_count, null);
  assert.equal(parsed.availability_status, 'RAC 3');
});

test('parseAvailability and summary handle RAC, WL, REGRET, and unavailable statuses', () => {
  const cases = [
    ['RAC 3', null, 'RAC 3'],
    ['GNWL/WL 12', null, 'Waitlist: GNWL / WL 12'],
    ['REGRET', null, 'Regret'],
    ['NOT AVAILABLE', null, 'Not available'],
    ['TRAIN CANCELLED', null, 'Train cancelled']
  ];

  for (const [status, count, summary] of cases) {
    const parsed = parseAvailability({
      avlDayList: [{ availablityDate: '20-06-2026', availablityStatus: status }]
    }, '2026-06-20');

    assert.equal(parsed.available_count, count);
    assert.equal(parsed.availability_status, status);
    assert.equal(formatAvailabilitySummary(parsed), summary);
  }
});
