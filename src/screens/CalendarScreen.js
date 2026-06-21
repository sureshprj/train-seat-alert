import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { updateOccurrenceStatus } from '../database';
import { ADVANCE_DAYS, formatDateTime, formatDisplayDate } from '../utils';

function localDateFromIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

function daysBetween(start, end) {
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function bookingCountdownText(daysUntilOpen) {
  if (daysUntilOpen <= 0) return 'Booking window open';
  if (daysUntilOpen === 1) return 'Booking opens tomorrow';
  return `Booking opens in ${daysUntilOpen} days`;
}

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
  formatFriendlyBookingDate,
  hasCompleteRailDetails,
  occurrenceBookingOpenText,
  coveredSeatCheckDates = new Set(),
  openSeatCheckFromHoliday
}) {
  const windowInfo = selectedEvent ? bookingWindowInfo(selectedEvent) : null;
  const railReady = selectedEvent ? hasCompleteRailDetails(selectedEvent) : false;
  const holidayTrip = selectedEvent?.trip_type === 'holiday';
  const selectedDateTrip = holidayTrip || selectedEvent?.trip_type === 'seat_check';
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function renderHolidayReminderCard(occurrence) {
    const travelDate = localDateFromIso(occurrence.travel_date);
    const bookingOpenDate = addDays(travelDate, -ADVANCE_DAYS);
    const daysUntilOpen = daysBetween(today, bookingOpenDate);
    const passed = travelDate < today;
    const bookingOpen = !passed && bookingOpenDate <= today;
    const seatCheckCreated = coveredSeatCheckDates.has(occurrence.travel_date);
    const statusText = passed
      ? 'Travel date passed'
      : seatCheckCreated
        ? 'Seat check created'
        : bookingCountdownText(daysUntilOpen);
    const pillTone = passed ? 'neutral' : (bookingOpen || seatCheckCreated ? 'success' : (daysUntilOpen <= 2 ? 'warning' : 'neutral'));

    return (
      <View key={occurrence.id} style={[
        styles.card,
        bookingOpen && !seatCheckCreated && styles.occurrenceCard_available,
        passed && styles.disabledInfoCard
      ]}>
        <View style={styles.cardHeader}>
          <View style={styles.occurrenceHeaderTitle}>
            <Text style={styles.cardTitle}>{formatDisplayDate(occurrence.travel_date)}</Text>
            <Text style={styles.subtle}>{occurrence.travel_date}</Text>
          </View>
          <Pill label={statusText} tone={pillTone} />
        </View>

        {occurrence.source_label ? (
          <Text style={styles.primaryLine}>{occurrence.source_label}</Text>
        ) : null}
        <View style={styles.bookingWindowRow}>
          <View style={styles.bookingWindowItem}>
            <Text style={styles.bookingWindowLabel}>Booking opens</Text>
            <Text style={styles.bookingWindowDate}>{formatBookingDate(bookingOpenDate)}</Text>
          </View>
          <View style={styles.bookingWindowItem}>
            <Text style={styles.bookingWindowLabel}>Travel date</Text>
            <Text style={styles.bookingWindowDate}>{formatBookingDate(travelDate)}</Text>
          </View>
        </View>

        {bookingOpen && !seatCheckCreated && !passed ? (
          <>
            <View style={styles.tripWarning}>
              <Ionicons name="ticket-outline" size={17} color="#8a5300" />
              <View style={styles.flexOne}>
                <Text style={styles.tripWarningTitle}>Booking window open</Text>
                <Text style={styles.tripWarningText}>Create a Seat Check Trip to monitor availability for this date.</Text>
              </View>
            </View>
            <View style={styles.compactActions}>
              <IconButton
                icon="add-circle-outline"
                label="Create seat check"
                compact
                onPress={() => openSeatCheckFromHoliday?.(selectedEvent, occurrence)}
                disabled={busy}
              />
            </View>
          </>
        ) : null}

        {seatCheckCreated ? (
          <Text style={styles.metaLine}>Availability monitoring is already set for this travel date.</Text>
        ) : null}
        {!bookingOpen && !passed ? (
          <Text style={styles.metaLine}>We will remind you before railway booking opens.</Text>
        ) : null}
      </View>
    );
  }

  return (
    <Screen>
      <View style={styles.topBar}>
        <View style={styles.flexOne}>
          <Text style={styles.screenTitle}>Trip Calendar</Text>
          <Text style={styles.subtle}>
            {selectedEvent
              ? `${selectedEvent.name}: ${selectedEvent.occurrences.length} ${selectedDateTrip ? 'selected' : 'generated'} dates`
              : 'Select a trip first'}
          </Text>
        </View>
        {selectedEvent && !holidayTrip && (
          <TouchableOpacity
            style={[styles.iconOnlyStrong, (busy || !railReady) && styles.buttonDisabled]}
            onPress={() => withBusy(() => runEventCheck(selectedEvent), {
              title: 'Checking trip calendar',
              detail: `${selectedEvent.name} occurrences are being checked sequentially.`
            })}
            disabled={busy || !railReady}
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
            if (holidayTrip) return renderHolidayReminderCard(occurrence);

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
                    {railReady && <IrctcLinkButton onPress={() => openRailConnect(selectedEvent, occurrence)} />}
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
                {occurrence.source_label && <Text style={styles.metaLine}>Holiday: {occurrence.source_label}</Text>}
                {holidayTrip && <Text style={styles.metaLine}>{occurrenceBookingOpenText(occurrence)}</Text>}
                {holidayTrip && !railReady && (
                  <Text style={styles.metaLine}>Create a Seat Check Trip when you want availability alerts.</Text>
                )}
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
                    disabled={busy || !railReady}
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
