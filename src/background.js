import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { initDatabase } from './database';
import { configureNotifications } from './notifications';
import { runDueScheduledChecks } from './planner';

export const BACKGROUND_CHECK_TASK = 'indianrail-background-availability-check';

TaskManager.defineTask(BACKGROUND_CHECK_TASK, async () => {
  try {
    await initDatabase();
    await configureNotifications();
    const result = await runDueScheduledChecks();
    return result.checked > 0 || result.reminded > 0 || result.captchaRequired
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundChecks() {
  const status = await BackgroundFetch.getStatusAsync();
  if (status !== BackgroundFetch.BackgroundFetchStatus.Available) {
    return { registered: false, status };
  }

  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_CHECK_TASK);
  if (!alreadyRegistered) {
    await BackgroundFetch.registerTaskAsync(BACKGROUND_CHECK_TASK, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true
    });
  }

  return { registered: true, status };
}
