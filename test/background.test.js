const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const { loadSourceModule, projectRoot } = require('./loadSourceModule');

function loadBackgroundWithMocks({
  status = 'Available',
  alreadyRegistered = false,
  runResult = { checked: 0, reminded: 0, captchaRequired: false },
  runThrows = false
} = {}) {
  let registeredTask = null;
  const registrations = [];

  const backgroundFetchMock = {
    BackgroundFetchStatus: {
      Available: 'Available',
      Denied: 'Denied'
    },
    BackgroundFetchResult: {
      NewData: 'NewData',
      NoData: 'NoData',
      Failed: 'Failed'
    },
    getStatusAsync: async () => status,
    registerTaskAsync: async (...args) => registrations.push(args)
  };

  const taskManagerMock = {
    defineTask: (name, handler) => {
      registeredTask = { name, handler };
    },
    isTaskRegisteredAsync: async () => alreadyRegistered
  };

  const background = loadSourceModule('src/background.js', {
    'expo-background-fetch': backgroundFetchMock,
    'expo-task-manager': taskManagerMock,
    [path.join(projectRoot, 'src/database.js')]: {
      initDatabase: async () => {}
    },
    [path.join(projectRoot, 'src/notifications.js')]: {
      configureNotifications: async () => true
    },
    [path.join(projectRoot, 'src/planner.js')]: {
      runDueScheduledChecks: async () => {
        if (runThrows) throw new Error('planner failed');
        return runResult;
      }
    }
  });

  return {
    background,
    registeredTask,
    registrations,
    backgroundFetchMock
  };
}

test('registerBackgroundChecks registers the task when background fetch is available', async () => {
  const { background, registrations } = loadBackgroundWithMocks();

  const result = await background.registerBackgroundChecks();

  assert.deepEqual(result, { registered: true, status: 'Available' });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][0], background.BACKGROUND_CHECK_TASK);
  assert.equal(registrations[0][1].minimumInterval, 15 * 60);
  assert.equal(registrations[0][1].stopOnTerminate, false);
  assert.equal(registrations[0][1].startOnBoot, true);
});

test('registerBackgroundChecks does not re-register an existing task', async () => {
  const { background, registrations } = loadBackgroundWithMocks({ alreadyRegistered: true });

  const result = await background.registerBackgroundChecks();

  assert.deepEqual(result, { registered: true, status: 'Available' });
  assert.equal(registrations.length, 0);
});

test('registerBackgroundChecks reports unavailable background fetch status', async () => {
  const { background, registrations } = loadBackgroundWithMocks({ status: 'Denied' });

  const result = await background.registerBackgroundChecks();

  assert.deepEqual(result, { registered: false, status: 'Denied' });
  assert.equal(registrations.length, 0);
});

test('background task returns NewData, NoData, or Failed based on planner outcome', async () => {
  const withData = loadBackgroundWithMocks({ runResult: { checked: 1, reminded: 0, captchaRequired: false } });
  assert.equal(await withData.registeredTask.handler(), withData.backgroundFetchMock.BackgroundFetchResult.NewData);

  const noData = loadBackgroundWithMocks({ runResult: { checked: 0, reminded: 0, captchaRequired: false } });
  assert.equal(await noData.registeredTask.handler(), noData.backgroundFetchMock.BackgroundFetchResult.NoData);

  const failed = loadBackgroundWithMocks({ runThrows: true });
  assert.equal(await failed.registeredTask.handler(), failed.backgroundFetchMock.BackgroundFetchResult.Failed);
});
