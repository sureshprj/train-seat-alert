import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { deleteEvent } from '../database';
import { ADVANCE_DAYS, formatDateTime, normalizeRecurrenceType } from '../utils';

function localDateFromIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatTripDate(dateOrValue) {
  return new Date(dateOrValue).toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function occurrencesInsideBookingWindow(event) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const bookingEnd = new Date(today);
  bookingEnd.setDate(bookingEnd.getDate() + ADVANCE_DAYS);
  bookingEnd.setHours(0, 0, 0, 0);

  return (event.occurrences || []).filter((occurrence) => {
    const travelDate = localDateFromIso(occurrence.travel_date);
    return travelDate >= today && travelDate <= bookingEnd;
  });
}

function seatCheckTravelDateSet(events) {
  return new Set(
    (events || [])
      .filter((event) => event.trip_type === 'seat_check')
      .flatMap((event) => event.occurrences || [])
      .map((occurrence) => occurrence.travel_date)
      .filter(Boolean)
  );
}

function bookingWindowWarning(event, coveredTravelDates = new Set()) {
  const openOccurrences = occurrencesInsideBookingWindow(event)
    .filter((occurrence) => !coveredTravelDates.has(occurrence.travel_date));
  if (!openOccurrences.length) return null;

  if (openOccurrences.length === 1) {
    return {
      title: `Booking open for ${formatTripDate(localDateFromIso(openOccurrences[0].travel_date))}`,
      body: 'Create a Seat Check Trip to monitor availability for this selected date.'
    };
  }

  const dateList = openOccurrences
    .slice(0, 2)
    .map((occurrence) => formatTripDate(localDateFromIso(occurrence.travel_date)))
    .join(', ');
  const extraCount = openOccurrences.length - 2;

  return {
    title: `${openOccurrences.length} selected dates are inside the booking window`,
    body: `${dateList}${extraCount > 0 ? `, +${extraCount} more` : ''}. Create a Seat Check Trip to monitor availability.`
  };
}

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
  openCreateTripForm,
  openEditTripForm,
  openSeatCheckFromHoliday,
  eventRecurrenceLabel,
  eventTypeLabel,
  eventLastCheckedAt,
  nextCheckText,
  hasCompleteRailDetails
}) {
  const coveredSeatCheckDates = seatCheckTravelDateSet(events);

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
            onPress={openCreateTripForm}
          >
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {!events.length ? (
        <View style={styles.firstRunPanel}>
          <View style={styles.firstRunHeader}>
            <Ionicons name="train-outline" size={30} color="#1d3557" />
            <View style={styles.flexOne}>
              <Text style={styles.emptyTitle}>No trips yet</Text>
              <Text style={styles.emptyBody}>
                Create a trip to get booking-window reminders and automatic seat alerts.
              </Text>
            </View>
          </View>

          <View style={styles.howItWorksList}>
            {[
              ['calendar-outline', 'Choose regular travel or holiday dates'],
              ['notifications-outline', 'We remind you before railway booking opens'],
              ['train-outline', 'Add train details to enable automatic seat checks']
            ].map(([icon, text]) => (
              <View key={text} style={styles.howItWorksItem}>
                <Ionicons name={icon} size={17} color="#1d3557" />
                <Text style={styles.howItWorksText}>{text}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.button, styles.button_primary, styles.firstRunButton]}
            onPress={openCreateTripForm}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={17} color="#fff" />
            <Text style={styles.buttonText}>Create first trip</Text>
          </TouchableOpacity>
        </View>
      ) : events.map((event) => {
        const railReady = hasCompleteRailDetails(event);
        const holidayTrip = event.trip_type === 'holiday';
        const seatCheckTrip = event.trip_type === 'seat_check';
        const openBookingWarning = holidayTrip ? bookingWindowWarning(event, coveredSeatCheckDates) : null;
        return (
        <TouchableOpacity
          key={event.id}
          style={[styles.card, selectedEventId === event.id && styles.cardSelected]}
          onPress={() => openEventCalendar(event.id)}
          activeOpacity={0.85}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{event.name}</Text>
            <Pill label={holidayTrip ? 'Reminder only' : (event.is_active ? 'Active' : 'Inactive')} tone={event.is_active ? 'success' : 'neutral'} />
          </View>
          <Text style={styles.primaryLine}>{eventTypeLabel(event)} · {eventRecurrenceLabel(event)}</Text>
          {railReady ? (
            <>
              <Text style={styles.metaLine}>{event.train_no} · {event.source_station} → {event.destination_station}</Text>
              <Text style={styles.metaLine}>{event.class_code} / {event.quota} · alert when seats are below {event.threshold}</Text>
            </>
          ) : holidayTrip ? (
            <Text style={styles.metaLine}>Booking-window reminders only. Create a Seat Check Trip when booking opens.</Text>
          ) : (
            <Text style={styles.metaLine}>Train details not added; booking reminders can still run.</Text>
          )}
          {!holidayTrip && !seatCheckTrip && normalizeRecurrenceType(event.recurrence_type) !== 'weekly' && (
            <Text style={styles.metaLine}>Start date: {event.start_date}</Text>
          )}
          {(holidayTrip || seatCheckTrip) && (
            <Text style={styles.metaLine}>Selected dates: {event.occurrences?.length || 0}</Text>
          )}
          {openBookingWarning ? (
            <View style={styles.tripWarning}>
              <Ionicons name="alert-circle-outline" size={17} color="#8a5300" />
              <View style={styles.flexOne}>
                <Text style={styles.tripWarningTitle}>{openBookingWarning.title}</Text>
                <Text style={styles.tripWarningText}>{openBookingWarning.body}</Text>
              </View>
            </View>
          ) : null}
          <Text style={styles.metaLine}>
            Booking reminders: {event.booking_window_reminders ? 'enabled' : 'disabled'}
          </Text>
          {railReady && <Text style={styles.metaLine}>Last checked: {formatDateTime(eventLastCheckedAt(event))}</Text>}
          <Text style={styles.metaLine}>Next check: {nextCheckText(event)}</Text>
          <View style={styles.rowActions}>
            {openBookingWarning ? (
              <IconButton
                icon="add-circle-outline"
                label="Create seat check"
                onPress={() => openSeatCheckFromHoliday(event)}
                disabled={busy}
              />
            ) : null}
            {!holidayTrip ? (
              <IconButton
                icon="flash-outline"
                label="Check"
                onPress={() => withBusy(() => runEventCheck(event, '', false), {
                  title: 'Checking trip availability',
                  detail: `${event.name} is checking the next available occurrence group.`
                })}
                disabled={busy || !railReady}
              />
            ) : null}
          </View>
          <View style={styles.rowActions}>
            <IconButton
              icon="create-outline"
              label="Edit"
              tone="secondary"
              onPress={() => {
                openEditTripForm(event);
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
        );
      })}
    </Screen>
  );
}
