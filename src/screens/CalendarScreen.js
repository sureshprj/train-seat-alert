import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { updateOccurrenceStatus } from '../database';
import { ADVANCE_DAYS, formatDateTime, formatDisplayDate } from '../utils';

export default function CalendarScreen({
  styles,
  Screen,
  EmptyState,
  Pill,
  IconButton,
  IrctcLinkButton,
  selectedEvent,
  busy,
  refresh,
  withBusy,
  runEventCheck,
  runOccurrenceCheck,
  openRailConnect,
  bookingWindowInfo,
  occurrenceVisualState,
  occurrenceVisualLabel,
  calendarAvailabilityText,
  calendarAvailabilityValue,
  formatBookingDate,
  formatFriendlyBookingDate
}) {
  const windowInfo = selectedEvent ? bookingWindowInfo(selectedEvent) : null;

  return (
    <Screen>
      <View style={styles.topBar}>
        <View style={styles.flexOne}>
          <Text style={styles.screenTitle}>Trip Calendar</Text>
          <Text style={styles.subtle}>
            {selectedEvent ? `${selectedEvent.name}: ${selectedEvent.occurrences.length} generated dates` : 'Select a trip first'}
          </Text>
        </View>
        {selectedEvent && (
          <TouchableOpacity
            style={[styles.iconOnlyStrong, busy && styles.buttonDisabled]}
            onPress={() => withBusy(() => runEventCheck(selectedEvent), {
              title: 'Checking trip calendar',
              detail: `${selectedEvent.name} occurrences are being checked sequentially.`
            })}
            disabled={busy}
          >
            <Ionicons name="flash-outline" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {!selectedEvent ? (
        <EmptyState title="No trip selected" body="Choose a trip on the Trips tab to see its travel dates." />
      ) : (
        <>
          {selectedEvent.occurrences.map((occurrence) => {
            const visualState = occurrenceVisualState(occurrence, selectedEvent);
            const availabilityText = calendarAvailabilityText(occurrence);
            const availabilityValue = calendarAvailabilityValue(occurrence);
            return (
              <View key={occurrence.id} style={[
                styles.card,
                styles[`occurrenceCard_${visualState}`]
              ]}>
                <View style={styles.cardHeader}>
                  <View style={styles.occurrenceHeaderTitle}>
                    <Text style={styles.cardTitle}>{formatDisplayDate(occurrence.travel_date)}</Text>
                    <Text style={styles.subtle}>{occurrence.travel_date}</Text>
                  </View>
                  <View style={styles.occurrenceHeaderActions}>
                    <IrctcLinkButton onPress={() => openRailConnect(selectedEvent, occurrence)} />
                    <Pill
                      label={occurrenceVisualLabel(visualState)}
                      tone={visualState}
                    />
                  </View>
                </View>
                <View style={styles.availabilityRow}>
                  <View style={styles.availabilityTextBlock}>
                    <Text style={styles.primaryLine}>{availabilityText}</Text>
                    <Text style={styles.metaLine}>Status: {occurrence.availability_status || 'No status yet'}</Text>
                  </View>
                  <Text style={[
                    styles.availabilityValue,
                    styles[`availabilityValue_${visualState}`]
                  ]}>
                    {availabilityValue}
                  </Text>
                </View>
                <Text style={styles.metaLine}>Last checked: {formatDateTime(occurrence.last_checked_at)}</Text>
                {occurrence.user_status !== 'pending' && (
                  <Text style={styles.metaLine}>User status: {occurrence.user_status}</Text>
                )}
                <View style={styles.compactActions}>
                  <IconButton
                    icon="flash-outline"
                    label="Check"
                    compact
                    onPress={() => withBusy(() => runOccurrenceCheck(selectedEvent, occurrence), {
                      title: 'Checking one travel date',
                      detail: `${formatDisplayDate(occurrence.travel_date)} availability is being requested.`
                    })}
                    disabled={busy}
                  />
                  <IconButton
                    icon="ticket-outline"
                    label="Booked"
                    tone="secondary"
                    compact
                    onPress={() => withBusy(async () => {
                      await updateOccurrenceStatus(occurrence.id, 'booked');
                      await refresh();
                    })}
                  />
                  <IconButton
                    icon="remove-circle-outline"
                    label="Ignore"
                    tone="secondary"
                    compact
                    onPress={() => withBusy(async () => {
                      await updateOccurrenceStatus(occurrence.id, 'ignored');
                      await refresh();
                    })}
                  />
                </View>
              </View>
            );
          })}
          {windowInfo && (
            <View style={[styles.card, styles.disabledInfoCard]}>
              <View style={styles.cardHeader}>
                <View style={styles.flexOne}>
                  <Text style={styles.cardTitle}>Booking window</Text>
                  <Text style={styles.metaLine}>Indian Rail booking opens {ADVANCE_DAYS} days before travel.</Text>
                </View>
                <Ionicons name="lock-closed-outline" size={20} color="#7b8794" />
              </View>
              <View style={styles.bookingWindowRow}>
                <View style={styles.bookingWindowItem}>
                  <Text style={styles.bookingWindowLabel}>Allowed till</Text>
                  <Text style={styles.bookingWindowDate}>{formatBookingDate(windowInfo.bookingEnd)}</Text>
                </View>
                {windowInfo.outsideWindow && (
                  <View style={styles.bookingWindowItem}>
                    <Text style={styles.bookingWindowLabel}>Next week opens</Text>
                    <Text style={styles.bookingWindowDate}>{formatFriendlyBookingDate(windowInfo.nextOpenDate)}</Text>
                    <Text style={styles.bookingWindowText}>for {formatBookingDate(windowInfo.outsideWindow)}</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
