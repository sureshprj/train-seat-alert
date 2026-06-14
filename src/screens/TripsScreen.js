import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { deleteEvent } from '../database';
import { formatDateTime, normalizeRecurrenceType } from '../utils';

export default function TripsScreen({
  styles,
  Screen,
  EmptyState,
  Pill,
  IconButton,
  sessionStatus,
  nativeNotificationsEnabled,
  busy,
  events,
  selectedEventId,
  refresh,
  withBusy,
  runAllEventChecks,
  runEventCheck,
  openEventCalendar,
  setEditingEvent,
  setFormVisible,
  eventRecurrenceLabel,
  eventLastCheckedAt,
  nextCheckText
}) {
  return (
    <Screen>
      <View style={styles.topBar}>
        <View style={styles.flexOne}>
          <Text style={styles.screenTitle}>Trips</Text>
          <Text style={styles.subtle}>{sessionStatus.isActive ? 'Rail session active' : 'Captcha needed before checks'}</Text>
          <Text style={styles.subtle}>
            Native notifications {nativeNotificationsEnabled ? 'enabled' : 'disabled'}
          </Text>
        </View>
        <View style={styles.topBarActions}>
          <TouchableOpacity
            style={[styles.iconOnlyStrong, (busy || !events.length) && styles.buttonDisabled]}
            onPress={() => withBusy(runAllEventChecks, {
              title: 'Checking all active trips',
              detail: 'Trips and occurrences are checked sequentially using the active rail session.'
            })}
            disabled={busy || !events.length}
          >
            <Ionicons name="flash-outline" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => {
              setEditingEvent(null);
              setFormVisible(true);
            }}
          >
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {!events.length ? (
        <EmptyState title="No trips yet" body="Create a recurring train trip to generate travel dates." />
      ) : events.map((event) => (
        <TouchableOpacity
          key={event.id}
          style={[styles.card, selectedEventId === event.id && styles.cardSelected]}
          onPress={() => openEventCalendar(event.id)}
          activeOpacity={0.85}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{event.name}</Text>
            <Pill label={event.is_active ? 'Active' : 'Inactive'} tone={event.is_active ? 'success' : 'neutral'} />
          </View>
          <Text style={styles.primaryLine}>{eventRecurrenceLabel(event)} · {event.train_no}</Text>
          <Text style={styles.metaLine}>{event.source_station} → {event.destination_station}</Text>
          <Text style={styles.metaLine}>{event.class_code} / {event.quota} · alert when seats are ≤ {event.threshold}</Text>
          {normalizeRecurrenceType(event.recurrence_type) !== 'weekly' && (
            <Text style={styles.metaLine}>Start date: {event.start_date}</Text>
          )}
          <Text style={styles.metaLine}>
            Booking reminders: {event.booking_window_reminders ? 'enabled' : 'disabled'}
          </Text>
          <Text style={styles.metaLine}>Last checked: {formatDateTime(eventLastCheckedAt(event))}</Text>
          <Text style={styles.metaLine}>Next check: {nextCheckText(event)}</Text>
          <Text style={styles.metaLine}>Seat checks: {event.check_times}</Text>
          <View style={styles.rowActions}>
            <IconButton
              icon="flash-outline"
              label="Check"
              onPress={() => withBusy(() => runEventCheck(event, '', false), {
                title: 'Checking trip availability',
                detail: `${event.name} is checking the next available occurrence group.`
              })}
              disabled={busy}
            />
          </View>
          <View style={styles.rowActions}>
            <IconButton
              icon="create-outline"
              label="Edit"
              tone="secondary"
              onPress={() => {
                setEditingEvent(event);
                setFormVisible(true);
              }}
            />
            <IconButton
              icon="trash-outline"
              label="Delete"
              tone="danger"
              onPress={() => Alert.alert('Delete trip?', event.name, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => withBusy(async () => {
                    await deleteEvent(event.id);
                    await refresh();
                  })
                }
              ])}
            />
          </View>
        </TouchableOpacity>
      ))}
    </Screen>
  );
}
