const assert = require('node:assert/strict');
const test = require('node:test');
const dayjs = require('dayjs');
const { loadSourceModule, projectRoot } = require('./loadSourceModule');
const path = require('path');

function plannerWithMocks({ database = {}, notifications = {}, railClient = {}, utils = {} }) {
  const cache = new Map();
  const realUtils = loadSourceModule('src/utils.js', {}, cache);
  const databaseMock = {
    ensureFutureOccurrences: async () => 0,
    getActiveEvents: async () => [],
    getBookingWindowReminderCandidates: async () => [],
    getEvent: async () => null,
    getPendingOccurrencesForEvent: async () => [],
    hasBookingWindowReminderRun: async () => false,
    hasRun: async () => false,
    markOccurrenceAlerted: async () => {},
    recordAvailability: async () => {},
    recordBookingWindowReminderRun: async () => {},
    recordRuns: async () => {},
    getSetting: async () => '',
    setSetting: async () => {},
    ...database
  };
  const notificationsMock = {
    createAvailabilityNotification: async () => {},
    createBookingWindowReminderNotification: async () => {},
    createCaptchaNotification: async () => {},
    ...notifications
  };
  const railClientMock = {
    requestAvailability: async () => ({ raw: {} }),
    ...railClient
  };

  return loadSourceModule('src/planner.js', {
    [path.join(projectRoot, 'src/database.js')]: databaseMock,
    [path.join(projectRoot, 'src/notifications.js')]: notificationsMock,
    [path.join(projectRoot, 'src/railClient.js')]: railClientMock,
    [path.join(projectRoot, 'src/utils.js')]: { ...realUtils, ...utils }
  }, cache);
}

test('runDueScheduledChecksWithOptions checks every returned occurrence before recording due runs', async () => {
  const cache = new Map();
  const utils = loadSourceModule('src/utils.js', {}, cache);
  const availabilityRows = [];
  const recordedRuns = [];
  const notificationRows = [];
  const requestedRows = [];

  const event = {
    id: 7,
    name: 'Weekly Chennai',
    check_times: '08:00,13:00',
    threshold: 10
  };
  const occurrences = [
    {
      id: 101,
      event_id: 7,
      travel_date: '2026-06-20',
      user_status: 'pending',
      threshold: 10,
      last_alert_signature: null
    },
    {
      id: 102,
      event_id: 7,
      travel_date: '2026-06-21',
      user_status: 'pending',
      threshold: 10,
      last_alert_signature: null
    }
  ];
  const rawAvailability = {
    avlDayList: [
      { availablityDate: '20-06-2026', availablityStatus: 'AVAILABLE-0007' },
      { availablityDate: '21-06-2026', availablityStatus: 'AVAILABLE-0004' }
    ]
  };

  const databaseMock = {
    ensureFutureOccurrences: async () => 1,
    getActiveEvents: async () => [event],
    getBookingWindowReminderCandidates: async () => [],
    getEvent: async () => event,
    getPendingOccurrencesForEvent: async () => occurrences,
    hasBookingWindowReminderRun: async () => false,
    hasRun: async () => false,
    markOccurrenceAlerted: async () => {},
    recordAvailability: async (row, parsed) => {
      availabilityRows.push({ row, parsed });
    },
    recordBookingWindowReminderRun: async () => {},
    recordRuns: async (eventId, runDate, scheduledTimes) => {
      recordedRuns.push({ eventId, runDate, scheduledTimes });
    },
    getSetting: async () => '',
    setSetting: async () => {}
  };

  const notificationsMock = {
    createAvailabilityNotification: async (...args) => notificationRows.push(args),
    createBookingWindowReminderNotification: async () => {},
    createCaptchaNotification: async () => {}
  };

  const railClientMock = {
    requestAvailability: async (row) => {
      requestedRows.push(row.id);
      return { raw: rawAvailability };
    }
  };

  const utilsMock = {
    ...utils,
    currentLocalTime: () => '13:30',
    nowIso: () => '2026-06-14T08:00:00.000Z'
  };

  const planner = loadSourceModule('src/planner.js', {
    [path.join(projectRoot, 'src/database.js')]: databaseMock,
    [path.join(projectRoot, 'src/notifications.js')]: notificationsMock,
    [path.join(projectRoot, 'src/railClient.js')]: railClientMock,
    [path.join(projectRoot, 'src/utils.js')]: utilsMock
  }, cache);

  const result = await planner.runDueScheduledChecksWithOptions({ nativeNotification: false });

  assert.equal(result.checked, 2);
  assert.deepEqual(requestedRows, [101]);
  assert.equal(availabilityRows.length, 2);
  assert.deepEqual(
    availabilityRows.map(({ row, parsed }) => [row.id, parsed.available_count]),
    [[101, 7], [102, 4]]
  );
  assert.deepEqual(recordedRuns, [{
    eventId: 7,
    runDate: dayjs().format('YYYY-MM-DD'),
    scheduledTimes: ['08:00', '13:00']
  }]);
  assert.equal(notificationRows.length, 2);
});

test('checkEvent pauses on captcha and succeeds when retried with inputCaptcha', async () => {
  const requested = [];
  const recorded = [];
  const event = { id: 8, name: 'Captcha route', threshold: 5 };
  const occurrence = {
    id: 201,
    event_id: 8,
    travel_date: '2026-06-20',
    user_status: 'pending',
    threshold: 5,
    last_alert_signature: null
  };

  const planner = plannerWithMocks({
    database: {
      getEvent: async () => event,
      getPendingOccurrencesForEvent: async () => [occurrence],
      recordAvailability: async (row, parsed) => recorded.push({ row, parsed })
    },
    railClient: {
      requestAvailability: async (row, options) => {
        requested.push({ rowId: row.id, inputCaptcha: options.inputCaptcha || '' });
        if (!options.inputCaptcha) return { captchaRequired: true, detail: 'captcha required' };
        return {
          raw: {
            avlDayList: [{ availablityDate: '20-06-2026', availablityStatus: 'AVAILABLE-0003' }]
          }
        };
      }
    },
    notifications: {
      createAvailabilityNotification: async () => {}
    },
    utils: {
      nowIso: () => '2026-06-14T08:00:00.000Z'
    }
  });

  const paused = await planner.checkEvent(8);
  assert.equal(paused.captchaRequired, true);
  assert.equal(paused.detail, 'captcha required');
  assert.deepEqual(paused.results, []);

  const retried = await planner.checkEvent(8, { inputCaptcha: 'ABCD', deepCheck: true });
  assert.equal(retried.captchaRequired, undefined);
  assert.equal(retried.checked, 1);
  assert.deepEqual(requested, [
    { rowId: 201, inputCaptcha: '' },
    { rowId: 201, inputCaptcha: 'ABCD' }
  ]);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].parsed.available_count, 3);
});

test('checkOccurrence deduplicates repeated alerts with last_alert_signature', async () => {
  const notifications = [];
  const alerted = [];
  const row = {
    id: 301,
    event_id: 9,
    travel_date: '2026-06-20',
    user_status: 'pending',
    threshold: 5,
    last_alert_signature: 'AVAILABLE-0004|4'
  };

  const planner = plannerWithMocks({
    database: {
      markOccurrenceAlerted: async (...args) => alerted.push(args),
      recordAvailability: async () => {}
    },
    notifications: {
      createAvailabilityNotification: async (...args) => notifications.push(args)
    },
    railClient: {
      requestAvailability: async () => ({
        raw: {
          avlDayList: [{ availablityDate: '20-06-2026', availablityStatus: 'AVAILABLE-0004' }]
        }
      })
    },
    utils: {
      nowIso: () => '2026-06-14T08:00:00.000Z'
    }
  });

  const result = await planner.checkOccurrence(row);

  assert.equal(result.availableCount, 4);
  assert.equal(notifications.length, 0);
  assert.equal(alerted.length, 0);
});

test('checkOccurrence sends new alert signatures and clears stale signatures when no longer below threshold', async () => {
  const notifications = [];
  const alerted = [];
  const rawResponses = [
    { avlDayList: [{ availablityDate: '20-06-2026', availablityStatus: 'AVAILABLE-0002' }] },
    { avlDayList: [{ availablityDate: '20-06-2026', availablityStatus: 'AVAILABLE-0020' }] }
  ];

  const planner = plannerWithMocks({
    database: {
      markOccurrenceAlerted: async (...args) => alerted.push(args),
      recordAvailability: async () => {}
    },
    notifications: {
      createAvailabilityNotification: async (...args) => notifications.push(args)
    },
    railClient: {
      requestAvailability: async () => ({ raw: rawResponses.shift() })
    },
    utils: {
      nowIso: () => '2026-06-14T08:00:00.000Z'
    }
  });

  await planner.checkOccurrence({
    id: 302,
    event_id: 9,
    travel_date: '2026-06-20',
    user_status: 'pending',
    threshold: 5,
    last_alert_signature: 'AVAILABLE-0004|4'
  });
  await planner.checkOccurrence({
    id: 302,
    event_id: 9,
    travel_date: '2026-06-20',
    user_status: 'pending',
    threshold: 5,
    last_alert_signature: 'AVAILABLE-0002|2'
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][0], 9);
  assert.equal(notifications[0][1], 302);
  assert.match(notifications[0][2], /only 2 seats/);
  assert.deepEqual(alerted, [
    [302, 'AVAILABLE-0002|2', '2026-06-14T08:00:00.000Z'],
    [302, null, null]
  ]);
});

test('runBookingWindowReminders only fires one- and two-day reminder windows', async () => {
  const today = dayjs().startOf('day');
  const candidates = [
    {
      event_id: 1,
      occurrence_id: 11,
      event_name: 'Two day',
      travel_date: today.add(62, 'day').format('YYYY-MM-DD')
    },
    {
      event_id: 2,
      occurrence_id: 12,
      event_name: 'One day',
      travel_date: today.add(61, 'day').format('YYYY-MM-DD')
    },
    {
      event_id: 3,
      occurrence_id: 13,
      event_name: 'Too early',
      travel_date: today.add(63, 'day').format('YYYY-MM-DD')
    },
    {
      event_id: 4,
      occurrence_id: 14,
      event_name: 'Already reminded',
      travel_date: today.add(62, 'day').format('YYYY-MM-DD')
    }
  ];
  const notifications = [];
  const recorded = [];

  const planner = plannerWithMocks({
    database: {
      ensureFutureOccurrences: async () => 1,
      getBookingWindowReminderCandidates: async () => candidates,
      hasBookingWindowReminderRun: async (eventId) => eventId === 4,
      recordBookingWindowReminderRun: async (...args) => recorded.push(args)
    },
    notifications: {
      createBookingWindowReminderNotification: async (...args) => notifications.push(args)
    }
  });

  const result = await planner.runBookingWindowReminders({ nativeNotification: false });

  assert.equal(result.reminded, 2);
  assert.deepEqual(
    notifications.map(([eventId, occurrenceId, eventName, daysBefore, native]) => [
      eventId,
      occurrenceId,
      eventName,
      daysBefore,
      native
    ]),
    [
      [1, 11, 'Two day', 2, false],
      [2, 12, 'One day', 1, false]
    ]
  );
  assert.deepEqual(recorded, [
    [1, candidates[0].travel_date, 2],
    [2, candidates[1].travel_date, 1]
  ]);
});
