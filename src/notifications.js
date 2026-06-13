import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { clearNotifications as clearRows, createNotificationRow } from './database';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true
  })
});

export async function configureNotifications() {
  try {
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
      const requested = await Notifications.requestPermissionsAsync();
      return requested.status === 'granted' || requested.granted;
    }
    return current.status === 'granted' || current.granted;
  } catch (err) {
    console.warn('Native notification setup failed:', err.message);
    return false;
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
    let canNotify = false;
    try {
      canNotify = await configureNotifications();
    } catch (err) {
      console.warn('Unable to configure native notifications:', err.message);
    }

    if (canNotify) {
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body: message,
            sound: true,
            data,
            ...(Platform.OS === 'android'
              ? {
                  channelId: 'availability-alerts',
                  priority: Notifications.AndroidNotificationPriority.HIGH
                }
              : {})
          },
          trigger: null
        });
      } catch (err) {
        console.warn('Unable to show native notification:', err.message);
      }
    }
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

export async function createBookingWindowReminderNotification(eventId, occurrenceId, eventName, daysBefore, native = true) {
  const message = daysBefore === 1
    ? `Booking opens tomorrow for "${eventName}". Ready to book your ticket.`
    : `Booking opens in ${daysBefore} days for "${eventName}". Keep passenger details ready.`;

  return createAvailabilityNotification(
    eventId,
    occurrenceId,
    message,
    native,
    { type: 'booking_window_reminder', eventId, occurrenceId, daysBefore },
    'Booking window reminder'
  );
}

export async function clearAllNotifications() {
  await clearRows();
  await Notifications.dismissAllNotificationsAsync();
  await Notifications.setBadgeCountAsync(0);
}
