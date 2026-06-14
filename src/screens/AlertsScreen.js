import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { clearAllNotifications } from '../notifications';
import { formatDateTime } from '../utils';

export default function AlertsScreen({
  styles,
  Screen,
  EmptyState,
  Pill,
  notifications,
  refresh,
  withBusy,
  handleNotificationPress,
  isCaptchaNotification
}) {
  return (
    <Screen>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.screenTitle}>Notifications</Text>
          <Text style={styles.subtle}>{notifications.length} recent alert(s)</Text>
        </View>
        <TouchableOpacity style={styles.iconOnlyStrong} onPress={() => withBusy(async () => {
          await clearAllNotifications();
          await refresh();
        })}>
          <Ionicons name="trash-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {!notifications.length ? (
        <EmptyState title="No notifications" body="Availability alerts and captcha reminders will appear here." />
      ) : notifications.map((notification) => (
        <TouchableOpacity
          key={notification.id}
          style={[styles.card, !notification.is_read && styles.unreadCard]}
          onPress={() => withBusy(() => handleNotificationPress(notification))}
        >
          <Text style={styles.primaryLine}>{notification.message}</Text>
          <Text style={styles.metaLine}>{formatDateTime(notification.created_at)}</Text>
          {isCaptchaNotification(notification) && <Pill label="Enter captcha" tone="warning" />}
          {!notification.is_read && <Pill label="Unread" tone="warning" />}
        </TouchableOpacity>
      ))}
    </Screen>
  );
}
