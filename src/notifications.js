import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { clearNotifications as clearRows, createNotificationRow } from './database';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true
  })
});

export async function configureNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('availability-alerts', {
      name: 'Availability alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#d7263d'
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.status !== 'granted') {
    await Notifications.requestPermissionsAsync();
  }
}

export async function createAvailabilityNotification(
  eventId,
  occurrenceId,
  message,
  native = true,
  data = {},
  title = 'Train availability alert'
) {
  const id = await createNotificationRow(eventId, occurrenceId, message);
  if (native) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: message,
        sound: true,
        data
      },
      trigger: null
    });
  }
  return id;
}

export async function createCaptchaNotification(eventId, eventName, native = true) {
  return createAvailabilityNotification(
    eventId,
    null,
    `Captcha required before automatic checks can continue for ${eventName}.`,
    native,
    { type: 'captcha_required', eventId },
    'Captcha required'
  );
}

export async function clearAllNotifications() {
  await clearRows();
  await Notifications.dismissAllNotificationsAsync();
  await Notifications.setBadgeCountAsync(0);
}
