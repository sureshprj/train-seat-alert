import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image
} from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as IntentLauncher from 'expo-intent-launcher';
import * as ExpoNotifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  clearAllNotifications,
  configureNotifications
} from './src/notifications';
import {
  createEvent,
  deleteEvent,
  getEventsWithOccurrences,
  getNotifications,
  initDatabase,
  markNotificationRead,
  updateEvent,
  updateOccurrenceStatus
} from './src/database';
import { registerBackgroundChecks } from './src/background';
import { fetchCaptchaImage, getSessionStatus } from './src/railClient';
import { checkEvent, checkOccurrence } from './src/planner';
import {
  DEFAULT_CHECK_TIMES,
  ADVANCE_DAYS,
  WEEKDAYS,
  formatAvailabilitySummary,
  formatDateTime,
  formatDisplayDate,
  isBelowThresholdStatus,
  parseAvailableCount
} from './src/utils';

const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();
const IRCTC_RAIL_CONNECT_PACKAGE = 'cris.org.in.prs.ima';
const IRCTC_RAIL_CONNECT_ACTIVITIES = [
  'cris.org.in.ima.activities.IRCTCConnectActivity',
  'cris.org.in.ima.activities.HomeActivity',
  'cris.org.in.ima.activities.loginActivity',
  'cris.org.in.ima.activities.LoginWaitActivity',
  'cris.org.in.ima.activities.webActivity'
];
const IRCTC_RAIL_CONNECT_MARKET = `market://details?id=${IRCTC_RAIL_CONNECT_PACKAGE}`;
const IRCTC_RAIL_CONNECT_STORE = `https://play.google.com/store/apps/details?id=${IRCTC_RAIL_CONNECT_PACKAGE}`;

const blankForm = {
  name: '',
  weekday: 'Tuesday',
  train_no: '12683',
  class_code: 'SL',
  quota: 'GN',
  source_station: 'ED',
  destination_station: 'KJM',
  threshold: '20',
  check_times: DEFAULT_CHECK_TIMES,
  max_triggers_per_day: '3',
  is_active: true
};

function Pill({ label, tone = 'neutral' }) {
  return <Text style={[styles.pill, styles[`pill_${tone}`]]}>{label}</Text>;
}

function LinkPill({ label, tone = 'neutral', onPress }) {
  return (
    <TouchableOpacity
      style={[styles.pillButton, styles[`pill_${tone}`]]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.pillButtonText, styles[`pillText_${tone}`]]}>{label}</Text>
      <Ionicons name="open-outline" size={12} color={pillTextColor(tone)} />
    </TouchableOpacity>
  );
}

function pillTextColor(tone) {
  const colors = {
    neutral: '#435168',
    success: '#12623a',
    warning: '#8a5300',
    danger: '#a9162a',
    booked: '#147568',
    ignored: '#4b5563',
    waitlist: '#8a5300',
    low: '#a9162a',
    available: '#146c94'
  };
  return colors[tone] || colors.neutral;
}

function IconButton({ icon, label, tone = 'primary', onPress, disabled, compact = false }) {
  return (
    <TouchableOpacity
      style={[
        styles.button,
        compact && styles.buttonCompact,
        styles[`button_${tone}`],
        disabled && styles.buttonDisabled
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Ionicons name={icon} size={compact ? 14 : 16} color={tone === 'secondary' ? '#1d3557' : '#fff'} />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.buttonText, compact && styles.buttonTextCompact, tone === 'secondary' && styles.buttonTextSecondary]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Field({ label, value, onChangeText, keyboardType = 'default', autoCapitalize = 'characters', placeholder }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={String(value)}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholder={placeholder}
        placeholderTextColor="#8a94a6"
      />
    </View>
  );
}

function calendarAvailabilityText(occurrence) {
  const status = occurrence.availability_status || '';
  if (!status && !occurrence.last_checked_at) return 'Not checked';
  if (/AVAILABLE/i.test(status)) return 'Available';
  if (/RAC/i.test(status)) return 'RAC';
  if (/(^|\/)[A-Z]*WL/i.test(status)) return 'Waitlist';
  return formatAvailabilitySummary(occurrence);
}

function calendarAvailabilityValue(occurrence) {
  const status = occurrence.availability_status || '';
  const hasCount = occurrence.available_count !== null && occurrence.available_count !== undefined;
  const availableCount = hasCount ? Number(occurrence.available_count) : parseAvailableCount(status);
  if (/AVAILABLE/i.test(status) && availableCount !== null) return String(availableCount);

  const racMatch = status.match(/RAC\s*0*(\d+)/i);
  if (racMatch) return `RAC ${Number(racMatch[1])}`;

  const waitlistMatches = [...status.matchAll(/[A-Z]*WL\s*0*(\d+)/gi)];
  if (waitlistMatches.length) {
    return `WL ${Number(waitlistMatches[waitlistMatches.length - 1][1])}`;
  }

  return '—';
}

function occurrenceVisualState(occurrence, event) {
  if (occurrence.user_status === 'booked') return 'booked';
  if (occurrence.user_status === 'ignored') return 'ignored';

  const status = occurrence.availability_status || '';
  const belowThreshold = isBelowThresholdStatus(occurrence, event.threshold);
  if (/RAC/i.test(status) || /(^|\/)[A-Z]*WL/i.test(status)) return 'waitlist';
  if (belowThreshold) return 'low';
  if (/AVAILABLE/i.test(status)) return 'available';
  return 'neutral';
}

function occurrenceVisualLabel(state) {
  const labels = {
    booked: 'Booked',
    ignored: 'Ignored',
    waitlist: 'Waitlist',
    low: 'Below threshold',
    available: 'Tickets available',
    neutral: 'Pending'
  };
  return labels[state] || 'Pending';
}

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

function nextWeekdayAfter(date, weekday) {
  const targetDay = WEEKDAYS.indexOf(weekday);
  if (targetDay < 0) return null;

  const cursor = addDays(date, 1);
  while (cursor.getDay() !== targetDay) {
    cursor.setDate(cursor.getDate() + 1);
  }
  return cursor;
}

function bookingWindowInfo(event) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bookingEnd = new Date(today);
  bookingEnd.setDate(bookingEnd.getDate() + ADVANCE_DAYS);
  bookingEnd.setHours(0, 0, 0, 0);

  const existingOutsideWindow = event?.occurrences
    ?.map((occurrence) => occurrence.travel_date)
    .filter((travelDate) => localDateFromIso(travelDate) > bookingEnd)
    .sort()[0];
  const outsideWindow = existingOutsideWindow
    ? localDateFromIso(existingOutsideWindow)
    : nextWeekdayAfter(bookingEnd, event?.weekday);

  const nextOpenDate = outsideWindow
    ? addDays(outsideWindow, -ADVANCE_DAYS)
    : null;

  return {
    bookingEnd,
    outsideWindow,
    nextOpenDate
  };
}

function formatBookingDate(dateOrValue) {
  return new Date(dateOrValue).toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function formatIrctcDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || '');
}

function irctcBookingDetails(event, occurrence) {
  return [
    `Train: ${event.train_no}`,
    `Date: ${formatIrctcDate(occurrence.travel_date)}`,
    `From: ${event.source_station}`,
    `To: ${event.destination_station}`,
    `Class: ${event.class_code}`,
    `Quota: ${event.quota}`
  ].join('\n');
}

function isCaptchaNotification(notification) {
  return /captcha required/i.test(notification?.message || '');
}

function EventFormModal({ visible, editingEvent, onClose, onSaved }) {
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setForm(editingEvent ? {
      name: editingEvent.name,
      weekday: editingEvent.weekday,
      train_no: editingEvent.train_no,
      class_code: editingEvent.class_code,
      quota: editingEvent.quota,
      source_station: editingEvent.source_station,
      destination_station: editingEvent.destination_station,
      threshold: String(editingEvent.threshold),
      check_times: editingEvent.check_times || DEFAULT_CHECK_TIMES,
      max_triggers_per_day: String(editingEvent.max_triggers_per_day || 3),
      is_active: Boolean(editingEvent.is_active)
    } : blankForm);
  }, [editingEvent, visible]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    try {
      setSaving(true);
      const payload = {
        ...form,
        threshold: Number(form.threshold),
        max_triggers_per_day: Number(form.max_triggers_per_day),
        is_active: form.is_active
      };
      const saved = editingEvent
        ? await updateEvent(editingEvent.id, payload)
        : await createEvent(payload);
      await onSaved(saved.id);
      onClose();
    } catch (err) {
      Alert.alert('Unable to save event', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{editingEvent ? 'Edit Trip Event' : 'Create Trip Event'}</Text>
          <TouchableOpacity onPress={onClose} style={styles.iconOnly}>
            <Ionicons name="close" size={24} color="#1d3557" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
          <Field label="Event name" value={form.name} onChangeText={(value) => setField('name', value)} autoCapitalize="words" />

          <Text style={styles.label}>Travel weekday</Text>
          <View style={styles.weekdayGrid}>
            {WEEKDAYS.map((weekday) => (
              <Pressable
                key={weekday}
                onPress={() => setField('weekday', weekday)}
                style={[styles.weekdayChip, form.weekday === weekday && styles.weekdayChipSelected]}
              >
                <Text style={[styles.weekdayText, form.weekday === weekday && styles.weekdayTextSelected]}>
                  {weekday.slice(0, 3)}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.twoCol}>
            <Field label="Train no" value={form.train_no} onChangeText={(value) => setField('train_no', value)} keyboardType="number-pad" />
            <Field label="Class" value={form.class_code} onChangeText={(value) => setField('class_code', value)} />
          </View>
          <View style={styles.twoCol}>
            <Field label="From station" value={form.source_station} onChangeText={(value) => setField('source_station', value)} />
            <Field label="To station" value={form.destination_station} onChangeText={(value) => setField('destination_station', value)} />
          </View>
          <View style={styles.twoCol}>
            <Field label="Quota" value={form.quota} onChangeText={(value) => setField('quota', value)} />
            <Field label="Threshold" value={form.threshold} onChangeText={(value) => setField('threshold', value)} keyboardType="number-pad" />
          </View>
          <Field
            label="Check times"
            value={form.check_times}
            onChangeText={(value) => setField('check_times', value)}
            autoCapitalize="none"
            placeholder="08:00,13:00,20:00"
          />
          <Field
            label="Max triggers per day"
            value={form.max_triggers_per_day}
            onChangeText={(value) => setField('max_triggers_per_day', value)}
            keyboardType="number-pad"
          />

          <View style={styles.switchRow}>
            <Text style={styles.label}>Active monitoring</Text>
            <Switch value={form.is_active} onValueChange={(value) => setField('is_active', value)} />
          </View>

          <IconButton icon="save-outline" label={saving ? 'Saving...' : 'Save event'} onPress={save} disabled={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CaptchaModal({ visible, imageUri, value, loading, onChangeText, onReload, onCancel, onSubmit }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.captchaBackdrop}>
        <View style={styles.captchaPanel}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Captcha required</Text>
            <TouchableOpacity onPress={onCancel} style={styles.iconOnly}>
              <Ionicons name="close" size={24} color="#1d3557" />
            </TouchableOpacity>
          </View>
          <View style={styles.captchaContent}>
            {loading ? (
              <ActivityIndicator size="large" color="#1d3557" style={styles.captchaImage} />
            ) : (
              <Image source={{ uri: imageUri }} style={styles.captchaImage} resizeMode="contain" />
            )}
            <View style={styles.captchaField}>
              <Text style={styles.label}>Captcha</Text>
              <TextInput
                style={[styles.input, styles.captchaInput]}
                value={value}
                onChangeText={onChangeText}
                autoCapitalize="none"
                keyboardType="number-pad"
                placeholder="Enter captcha"
                placeholderTextColor="#8a94a6"
              />
            </View>
          </View>
          <View style={styles.captchaActions}>
            <IconButton icon="checkmark" label="Submit" compact onPress={onSubmit} disabled={!value.trim()} />
            <IconButton icon="refresh" label="Reload" tone="secondary" compact onPress={onReload} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <TripPlannerApp />
    </SafeAreaProvider>
  );
}

function TripPlannerApp() {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState({ isActive: false });
  const [formVisible, setFormVisible] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [captchaVisible, setCaptchaVisible] = useState(false);
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaValue, setCaptchaValue] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [pendingCheck, setPendingCheck] = useState(null);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) || null,
    [events, selectedEventId]
  );

  const refresh = useCallback(async () => {
    const [eventRows, notificationRows, status] = await Promise.all([
      getEventsWithOccurrences(),
      getNotifications(50),
      getSessionStatus()
    ]);
    setEvents(eventRows);
    setNotifications(notificationRows);
    setSessionStatus(status);
    setSelectedEventId((current) => {
      if (current && eventRows.some((event) => event.id === current)) return current;
      return eventRows[0]?.id || null;
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await initDatabase();
        await configureNotifications();
        await registerBackgroundChecks();
        await refresh();
      } catch (err) {
        Alert.alert('Startup failed', err.message);
      } finally {
        setReady(true);
      }
    })();
  }, [refresh]);

  useEffect(() => {
    if (!ready) return undefined;

    function handleResponse(response) {
      const data = response?.notification?.request?.content?.data || {};
      if (data.type === 'captcha_required' && data.eventId) {
        openCaptchaForEvent(data.eventId, true);
      }
    }

    ExpoNotifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleResponse(response);
    });

    const subscription = ExpoNotifications.addNotificationResponseReceivedListener(handleResponse);
    return () => subscription.remove();
  }, [ready]);

  async function openCaptcha(check) {
    setPendingCheck(check);
    setCaptchaVisible(true);
    setCaptchaValue('');
    await reloadCaptcha();
  }

  async function openCaptchaForEvent(eventId, fromNotification = false) {
    const numericEventId = Number(eventId);
    if (!numericEventId) return;
    setSelectedEventId(numericEventId);
    if (navigationRef.isReady()) {
      navigationRef.navigate('Alerts');
    }
    await openCaptcha({
      type: 'event',
      eventId: numericEventId,
      suppressNotifications: !fromNotification
    });
  }

  async function reloadCaptcha() {
    try {
      setCaptchaLoading(true);
      setCaptchaImage(await fetchCaptchaImage());
      await refresh();
    } catch (err) {
      Alert.alert('Unable to load captcha', err.message);
    } finally {
      setCaptchaLoading(false);
    }
  }

  function buildOccurrenceRow(event, occurrence) {
    return {
      ...occurrence,
      event_id: event.id,
      name: event.name,
      train_no: event.train_no,
      class_code: event.class_code,
      quota: event.quota,
      source_station: event.source_station,
      destination_station: event.destination_station,
      threshold: event.threshold,
      is_active: event.is_active
    };
  }

  async function runEventCheck(event, inputCaptcha = '') {
    const result = await checkEvent(event.id, { inputCaptcha, suppressNotifications: true });
    if (result.captchaRequired) {
      if (result.detail) console.log('Captcha required:', result.detail);
      await openCaptcha({ type: 'event', eventId: event.id });
      return result;
    }
    await refresh();
    Alert.alert('Check complete', `${result.checked || 0} occurrence(s) checked.`);
    return result;
  }

  async function runOccurrenceCheck(event, occurrence, inputCaptcha = '') {
    const result = await checkOccurrence(buildOccurrenceRow(event, occurrence), { inputCaptcha, force: true });
    if (result.captchaRequired) {
      if (result.detail) console.log('Captcha required:', result.detail);
      await openCaptcha({ type: 'occurrence', eventId: event.id, occurrenceId: occurrence.id });
      return result;
    }
    await refresh();
    Alert.alert('Check complete', result.availabilitySummary || result.availabilityStatus || 'No availability status returned');
    return result;
  }

  async function submitCaptcha() {
    if (!pendingCheck || !captchaValue.trim()) return;
    try {
      setBusy(true);
      const event = events.find((item) => item.id === pendingCheck.eventId);
      if (!event) throw new Error('Event not found for pending check');

      if (pendingCheck.type === 'event') {
        const result = await checkEvent(event.id, {
          inputCaptcha: captchaValue.trim(),
          suppressNotifications: pendingCheck.suppressNotifications !== false
        });
        if (result.captchaRequired) throw new Error('Captcha was not accepted. Try again.');
      } else {
        const occurrence = event.occurrences.find((item) => item.id === pendingCheck.occurrenceId);
        if (!occurrence) throw new Error('Occurrence not found for pending check');
        const result = await checkOccurrence(buildOccurrenceRow(event, occurrence), {
          inputCaptcha: captchaValue.trim(),
          force: true
        });
        if (result.captchaRequired) throw new Error('Captcha was not accepted. Try again.');
      }

      setCaptchaVisible(false);
      setPendingCheck(null);
      setCaptchaValue('');
      await refresh();
    } catch (err) {
      Alert.alert('Captcha check failed', err.message);
      await reloadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function withBusy(fn) {
    try {
      setBusy(true);
      await fn();
    } catch (err) {
      Alert.alert('Request failed', err.message);
    } finally {
      setBusy(false);
    }
  }

  function openEventCalendar(eventId) {
    setSelectedEventId(eventId);
    if (navigationRef.isReady()) {
      navigationRef.navigate('Calendar');
    }
  }

  async function openRailConnect(event, occurrence) {
    const details = irctcBookingDetails(event, occurrence);

    async function openStore() {
      try {
        await Linking.openURL(IRCTC_RAIL_CONNECT_MARKET);
      } catch {
        await Linking.openURL(IRCTC_RAIL_CONNECT_STORE);
      }
    }

    async function openApp() {
      try {
        if (Platform.OS === 'android') {
          IntentLauncher.openApplication(IRCTC_RAIL_CONNECT_PACKAGE);
          return;
        }
      } catch {
        // Try explicit activities below when Android cannot find the package launch intent.
      }

      if (Platform.OS === 'android') {
        for (const className of IRCTC_RAIL_CONNECT_ACTIVITIES) {
          try {
            await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
              packageName: IRCTC_RAIL_CONNECT_PACKAGE,
              className,
              category: 'android.intent.category.LAUNCHER',
              flags: 0x10000000
            });
            return;
          } catch {
            // Try the next known IRCTC activity.
          }
        }
      }
      await openStore();
    }

    Alert.alert(
      'Book in IRCTC',
      `${details}\n\nRail Connect does not expose a reliable public prefill link, so keep these details handy after the app opens.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open IRCTC', onPress: openApp }
      ]
    );
  }

  async function handleNotificationPress(notification) {
    await markNotificationRead(notification.id);
    await refresh();
    if (isCaptchaNotification(notification) && notification.event_id) {
      await openCaptchaForEvent(notification.event_id, true);
    }
  }

  function EventsScreen() {
    return (
      <Screen>
        <View style={styles.topBar}>
          <View>
            <Text style={styles.screenTitle}>Active Trip Events</Text>
            <Text style={styles.subtle}>{sessionStatus.isActive ? 'Rail session active' : 'Captcha needed before checks'}</Text>
          </View>
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

        {!events.length ? (
          <EmptyState title="No events yet" body="Create a recurring train trip to generate travel dates." />
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
            <Text style={styles.primaryLine}>{event.weekday} · {event.train_no}</Text>
            <Text style={styles.metaLine}>{event.source_station} → {event.destination_station}</Text>
            <Text style={styles.metaLine}>{event.class_code} / {event.quota} · threshold {event.threshold}</Text>
	            <Text style={styles.metaLine}>Checks {event.check_times} · max {event.max_triggers_per_day}/day</Text>
	            <View style={styles.rowActions}>
	              <IconButton icon="calendar-outline" label="Select" tone="secondary" onPress={() => openEventCalendar(event.id)} />
	              <IconButton icon="flash-outline" label="Check" onPress={() => withBusy(() => runEventCheck(event))} disabled={busy} />
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
                onPress={() => Alert.alert('Delete event?', event.name, [
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

  function OccurrencesScreen() {
    const windowInfo = selectedEvent ? bookingWindowInfo(selectedEvent) : null;

    return (
      <Screen>
        <View style={styles.topBar}>
          <View style={styles.flexOne}>
            <Text style={styles.screenTitle}>Event Calendar</Text>
            <Text style={styles.subtle}>
              {selectedEvent ? `${selectedEvent.name}: ${selectedEvent.occurrences.length} generated dates` : 'Select an event first'}
            </Text>
          </View>
          {selectedEvent && (
            <TouchableOpacity style={styles.iconOnlyStrong} onPress={() => withBusy(() => runEventCheck(selectedEvent))}>
              <Ionicons name="flash-outline" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

	        {!selectedEvent ? (
	          <EmptyState title="No event selected" body="Choose an event on the Events tab to see its occurrences." />
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
  	                <View>
  	                  <Text style={styles.cardTitle}>{formatDisplayDate(occurrence.travel_date)}</Text>
  	                  <Text style={styles.subtle}>{occurrence.travel_date}</Text>
  	                </View>
                  <LinkPill
                    label={occurrenceVisualLabel(visualState)}
                    tone={visualState}
                    onPress={() => openRailConnect(selectedEvent, occurrence)}
                  />
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
  	                  onPress={() => withBusy(() => runOccurrenceCheck(selectedEvent, occurrence))}
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
                      <Text style={styles.bookingWindowDate}>{formatBookingDate(windowInfo.nextOpenDate)}</Text>
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

  function NotificationsScreen() {
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

  if (!ready) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator size="large" color="#1d3557" />
        <Text style={styles.subtle}>Loading trip planner...</Text>
      </View>
    );
  }

  return (
    <>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="dark" />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: '#1d3557',
            tabBarInactiveTintColor: '#7b8794',
            tabBarStyle: [
              styles.tabBar,
              {
                height: 58 + Math.max(insets.bottom, 16),
                paddingBottom: Math.max(insets.bottom, 16)
              }
            ],
            tabBarIcon: ({ color, size }) => {
              const icons = {
                Events: 'train-outline',
                Calendar: 'calendar-outline',
                Alerts: 'notifications-outline'
              };
              return <Ionicons name={icons[route.name]} size={size} color={color} />;
            }
          })}
        >
          <Tab.Screen name="Events" component={EventsScreen} />
          <Tab.Screen name="Calendar" component={OccurrencesScreen} />
          <Tab.Screen name="Alerts" component={NotificationsScreen} />
        </Tab.Navigator>
      </NavigationContainer>

      <EventFormModal
        visible={formVisible}
        editingEvent={editingEvent}
        onClose={() => setFormVisible(false)}
        onSaved={async (id) => {
          setSelectedEventId(id);
          await refresh();
        }}
      />
      <CaptchaModal
        visible={captchaVisible}
        imageUri={captchaImage}
        value={captchaValue}
        loading={captchaLoading || busy}
        onChangeText={setCaptchaValue}
        onReload={reloadCaptcha}
        onCancel={() => {
          setCaptchaVisible(false);
          setPendingCheck(null);
        }}
        onSubmit={submitCaptcha}
      />
    </>
  );
}

function Screen({ children }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.screenContent,
        { paddingBottom: 92 + Math.max(insets.bottom, 16) }
      ]}
    >
      {children}
    </ScrollView>
  );
}

function EmptyState({ title, body }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="information-circle-outline" size={30} color="#60708a" />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#f6f8fb'
  },
  screen: {
    flex: 1,
    backgroundColor: '#f6f8fb'
  },
  screenContent: {
    padding: 16,
    paddingTop: 58,
    paddingBottom: 108
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#172033'
  },
  subtle: {
    color: '#60708a',
    fontSize: 13,
    marginTop: 3
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1d3557',
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconOnly: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconOnlyStrong: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1d3557',
    alignItems: 'center',
    justifyContent: 'center'
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e1e7ef'
  },
  cardSelected: {
    borderColor: '#1d3557',
    borderWidth: 2
  },
  occurrenceCard_booked: {
    borderColor: '#2a9d8f',
    backgroundColor: '#effaf7'
  },
  occurrenceCard_ignored: {
    borderColor: '#a8b1bd',
    backgroundColor: '#f4f6f8'
  },
  occurrenceCard_waitlist: {
    borderColor: '#f2a541',
    backgroundColor: '#fff8eb'
  },
  occurrenceCard_low: {
    borderColor: '#d7263d',
    backgroundColor: '#fff4f5'
  },
  occurrenceCard_available: {
    borderColor: '#277da1',
    backgroundColor: '#f0f8fb'
  },
  unreadCard: {
    borderColor: '#f2a541',
    backgroundColor: '#fffaf0'
  },
  disabledInfoCard: {
    backgroundColor: '#eef2f6',
    borderColor: '#d5dde8',
    opacity: 0.92
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8
  },
  cardTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: '#172033'
  },
  primaryLine: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 5
  },
  metaLine: {
    color: '#526175',
    fontSize: 13,
    marginBottom: 4
  },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 2
  },
  availabilityTextBlock: {
    flex: 1,
    minWidth: 0
  },
  availabilityValue: {
    minWidth: 76,
    textAlign: 'right',
    color: '#1d3557',
    fontSize: 28,
    fontWeight: '900'
  },
  availabilityValue_booked: {
    color: '#147568'
  },
  availabilityValue_ignored: {
    color: '#6b7280'
  },
  availabilityValue_waitlist: {
    color: '#9a5d00'
  },
  availabilityValue_low: {
    color: '#a9162a'
  },
  availabilityValue_available: {
    color: '#146c94'
  },
  bookingWindowRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4
  },
  bookingWindowItem: {
    flex: 1,
    minWidth: 0
  },
  bookingWindowLabel: {
    color: '#60708a',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase'
  },
  bookingWindowDate: {
    color: '#172033',
    fontSize: 17,
    fontWeight: '900'
  },
  bookingWindowText: {
    color: '#526175',
    fontSize: 12,
    marginTop: 3
  },
  pill: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '800'
  },
  pillButton: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5
  },
  pillButtonText: {
    fontSize: 12,
    fontWeight: '800'
  },
  pill_neutral: {
    backgroundColor: '#e8edf3',
    color: '#435168'
  },
  pillText_neutral: {
    color: '#435168'
  },
  pill_success: {
    backgroundColor: '#ddf4e8',
    color: '#12623a'
  },
  pillText_success: {
    color: '#12623a'
  },
  pill_warning: {
    backgroundColor: '#fff0d5',
    color: '#8a5300'
  },
  pillText_warning: {
    color: '#8a5300'
  },
  pill_danger: {
    backgroundColor: '#ffe1e6',
    color: '#a9162a'
  },
  pillText_danger: {
    color: '#a9162a'
  },
  pill_booked: {
    backgroundColor: '#dff5ef',
    color: '#147568'
  },
  pillText_booked: {
    color: '#147568'
  },
  pill_ignored: {
    backgroundColor: '#e5e7eb',
    color: '#4b5563'
  },
  pillText_ignored: {
    color: '#4b5563'
  },
  pill_waitlist: {
    backgroundColor: '#fff0d5',
    color: '#8a5300'
  },
  pillText_waitlist: {
    color: '#8a5300'
  },
  pill_low: {
    backgroundColor: '#ffe1e6',
    color: '#a9162a'
  },
  pillText_low: {
    color: '#a9162a'
  },
  pill_available: {
    backgroundColor: '#dff3fa',
    color: '#146c94'
  },
  pillText_available: {
    color: '#146c94'
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10
  },
  compactActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12
  },
  button: {
    minHeight: 42,
    flex: 1,
    minWidth: 118,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    backgroundColor: '#1d3557'
  },
  buttonCompact: {
    minHeight: 38,
    minWidth: 88,
    flexBasis: '30%',
    paddingHorizontal: 8,
    gap: 5
  },
  button_secondary: {
    backgroundColor: '#eaf0f6'
  },
  button_primary: {
    backgroundColor: '#1d3557'
  },
  button_danger: {
    backgroundColor: '#d7263d'
  },
  buttonDisabled: {
    opacity: 0.55
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
    flexShrink: 1
  },
  buttonTextCompact: {
    fontSize: 12
  },
  buttonTextSecondary: {
    color: '#1d3557'
  },
  modalRoot: {
    flex: 1,
    backgroundColor: '#f6f8fb'
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#172033'
  },
  modalBody: {
    padding: 16,
    paddingBottom: 36
  },
  field: {
    flex: 1,
    minWidth: 0,
    marginBottom: 12
  },
  label: {
    color: '#31405a',
    fontWeight: '800',
    marginBottom: 6,
    fontSize: 13
  },
  input: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ced7e4',
    backgroundColor: '#fff',
    color: '#172033',
    paddingHorizontal: 12,
    fontSize: 15
  },
  weekdayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14
  },
  weekdayChip: {
    width: 68,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ced7e4',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff'
  },
  weekdayChipSelected: {
    backgroundColor: '#1d3557',
    borderColor: '#1d3557'
  },
  weekdayText: {
    color: '#31405a',
    fontWeight: '800'
  },
  weekdayTextSelected: {
    color: '#fff'
  },
  twoCol: {
    flexDirection: 'row',
    gap: 10
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16
  },
  captchaBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 51, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18
  },
  captchaPanel: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 8,
    backgroundColor: '#f6f8fb',
    paddingBottom: 14
  },
  captchaContent: {
    paddingHorizontal: 16,
    gap: 8
  },
  captchaActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 10
  },
  captchaField: {
    width: '100%'
  },
  captchaInput: {
    width: '100%',
    minHeight: 40,
    fontSize: 14
  },
  captchaImage: {
    alignSelf: 'center',
    width: 180,
    height: 58,
    marginTop: 4,
    marginBottom: 2,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ced7e4'
  },
  emptyState: {
    padding: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e1e7ef',
    backgroundColor: '#fff',
    alignItems: 'center'
  },
  emptyTitle: {
    color: '#172033',
    fontWeight: '900',
    fontSize: 17,
    marginTop: 8
  },
  emptyBody: {
    color: '#60708a',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20
  },
  flexOne: {
    flex: 1
  },
  tabBar: {
    height: 74,
    paddingBottom: 16,
    paddingTop: 6,
    borderTopColor: '#dbe3ee'
  }
});
