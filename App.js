import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
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
  configureNotifications
} from './src/notifications';
import {
  createEvent,
  cleanupOldData,
  ensureFutureOccurrences,
  getEventsWithOccurrences,
  getNotifications,
  getSetting,
  initDatabase,
  markNotificationRead,
  recordRuns,
  setSetting,
  updateEvent
} from './src/database';
import { registerBackgroundChecks } from './src/background';
import {
  getSessionStatus,
  searchStationSuggestions,
  searchTrainSuggestions
} from './src/railClient';
import { checkEvent, checkOccurrence, validateTripAvailability } from './src/planner';
import {
  ADVANCE_DAYS,
  CLASS_OPTIONS,
  QUOTA_OPTIONS,
  RECURRENCE_OPTIONS,
  WEEKDAYS,
  formatAvailabilitySummary,
  isAvailableStatus,
  isBelowThresholdStatus,
  isNotAvailableStatus,
  normalizeCheckTimes,
  normalizeRecurrenceType,
  parseAvailableCount,
  normalizeEventPayload,
  validateEventPayload
} from './src/utils';
import AdBanner from './src/AdBanner';
import useCaptchaFlow from './src/hooks/useCaptchaFlow';
import useForegroundCatchUp from './src/hooks/useForegroundCatchUp';
import AlertsScreen from './src/screens/AlertsScreen';
import AboutScreen from './src/screens/AboutScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import TripsScreen from './src/screens/TripsScreen';

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
const AUTO_CAPTCHA_COOLDOWN_MS = 15 * 60 * 1000;
const AUTO_CAPTCHA_COOLDOWN_SETTING_PREFIX = 'auto_captcha_cooldown_until_';
const MANUAL_CHECK_AUTO_PAUSE_MS = 3 * 60 * 1000;

const blankForm = {
  name: '',
  recurrence_type: 'weekly',
  start_date: new Date().toISOString().slice(0, 10),
  weekday: 'Tuesday',
  train_no: '',
  class_code: 'SL',
  quota: 'GN',
  source_station: '',
  destination_station: '',
  threshold: '',
  check_times: '08:00',
  booking_window_reminders: true,
  is_active: true
};

function Pill({ label, tone = 'neutral' }) {
  return <Text style={[styles.pill, styles[`pill_${tone}`]]}>{label}</Text>;
}

function IrctcLinkButton({ onPress }) {
  return (
    <TouchableOpacity
      style={styles.irctcLinkButton}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Ionicons name="link-outline" size={13} color="#1d3557" />
      <Text style={styles.irctcLinkButtonText}>IRCTC</Text>
    </TouchableOpacity>
  );
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

function Field({ label, value, onChangeText, keyboardType = 'default', autoCapitalize = 'characters', placeholder, onFocus }) {
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
        onFocus={() => {
          onFocus?.();
        }}
      />
    </View>
  );
}

function AutocompleteField({
  id,
  label,
  value,
  onChangeText,
  onSelect,
  searchSuggestions,
  minQueryLength = 2,
  keyboardType = 'default',
  autoCapitalize = 'characters',
  placeholder,
  activeId,
  onActivate,
  onDismiss
}) {
  const inputRef = useRef(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const isActive = activeId === id;

  useEffect(() => {
    if (!isActive) {
      setSuggestions([]);
      return undefined;
    }

    const query = String(value || '').trim();
    if (query.length < minQueryLength) {
      setSuggestions([]);
      return undefined;
    }

    let requestActive = true;
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        const rows = await searchSuggestions(query);
        if (requestActive) setSuggestions(rows);
      } catch {
        if (requestActive) setSuggestions([]);
      } finally {
        if (requestActive) setLoading(false);
      }
    }, 250);

    return () => {
      requestActive = false;
      clearTimeout(timer);
    };
  }, [isActive, minQueryLength, searchSuggestions, value]);

  function selectSuggestion(item) {
    inputRef.current?.blur();
    Keyboard.dismiss();
    onSelect(item);
    onDismiss(id);
    setSuggestions([]);
  }

  return (
    <View style={[styles.field, styles.autocompleteField, isActive && styles.autocompleteFieldActive]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={String(value)}
        onChangeText={(text) => {
          onChangeText(text);
          onActivate(id);
        }}
        onFocus={() => onActivate(id)}
        onBlur={() => {
          setTimeout(() => onDismiss(id), 160);
        }}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholder={placeholder}
        placeholderTextColor="#8a94a6"
      />
      {isActive && (loading || suggestions.length > 0) && (
        <View style={styles.suggestionList}>
          {loading && !suggestions.length ? (
            <Text style={styles.suggestionMeta}>Searching...</Text>
          ) : suggestions.map((item) => (
            <Pressable
              key={`${item.value}-${item.label}`}
              style={styles.suggestionItem}
              onPress={() => selectSuggestion(item)}
            >
              <Text style={styles.suggestionLabel} numberOfLines={1}>{item.label}</Text>
              <Text style={styles.suggestionValue}>{item.value}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function ToggleSelection({ label, description, value, onValueChange }) {
  return (
    <Pressable
      style={[styles.toggleSelection, value && styles.toggleSelectionActive]}
      onPress={() => onValueChange(!value)}
    >
      <View style={styles.switchRow}>
        <Text style={[styles.toggleSelectionLabel, value && styles.toggleSelectionTextActive]}>{label}</Text>
        <Switch value={value} onValueChange={onValueChange} />
      </View>
      <Text style={[styles.toggleSelectionDescription, value && styles.toggleSelectionDescriptionActive]}>
        {description}
      </Text>
    </Pressable>
  );
}

function searchOptionSuggestions(options) {
  return async (query) => {
    const normalizedQuery = String(query || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    const compactQuery = normalizedQuery.replace(/\s+/g, '');
    if (normalizedQuery.length < 1) return options;

    return options
      .map((option) => {
        const label = `${option.value} - ${option.label}`;
        const normalizedLabel = label.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
        const compactLabel = normalizedLabel.replace(/\s+/g, '');
        const compactValue = option.value.toUpperCase();
        let score = 0;
        if (compactValue === compactQuery) score = 100;
        else if (compactValue.startsWith(compactQuery)) score = 90;
        else if (normalizedLabel.startsWith(normalizedQuery)) score = 80;
        else if (normalizedLabel.includes(normalizedQuery)) score = 70;
        else if (compactLabel.includes(compactQuery)) score = 60;
        return { ...option, label, score };
      })
      .filter((option) => option.score > 0)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 8)
      .map(({ value, label }) => ({ value, label }));
  };
}

const searchClassSuggestions = searchOptionSuggestions(CLASS_OPTIONS);
const searchQuotaSuggestions = searchOptionSuggestions(QUOTA_OPTIONS);

function recurrenceOptionLabel(value) {
  const recurrenceType = normalizeRecurrenceType(value);
  return RECURRENCE_OPTIONS.find((option) => option.value === recurrenceType)?.label || 'Weekly';
}

function eventRecurrenceLabel(event) {
  const recurrenceType = normalizeRecurrenceType(event?.recurrence_type);
  if (recurrenceType === 'weekly') return event?.weekday || 'Weekly';
  return recurrenceOptionLabel(recurrenceType);
}

function checkTimesFromValue(value) {
  return normalizeCheckTimes(value)
    .split(',')
    .map((time) => time.trim())
    .filter(Boolean);
}

function formatCheckTimeLabel(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time || '').trim());
  if (!match) return time;
  return formatClock(Number(match[1]), Number(match[2]));
}

function clampTimePart(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(max, Math.floor(number)));
}

function timeFromMinutes(minutes) {
  const normalized = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function nextUnusedCheckTime(times) {
  const existing = new Set(times);
  const start = 8 * 60;
  for (let offset = 0; offset < 24 * 60; offset += 60) {
    const candidate = timeFromMinutes(start + offset);
    if (!existing.has(candidate)) return candidate;
  }
  for (let offset = 30; offset < 24 * 60; offset += 30) {
    const candidate = timeFromMinutes(start + offset);
    if (!existing.has(candidate)) return candidate;
  }
  return '08:00';
}

function CheckTimesPicker({ value, onChange }) {
  const times = checkTimesFromValue(value);
  const firstTime = times[0] || '08:00';
  const [visible, setVisible] = useState(false);
  const [hour, setHour] = useState(firstTime.slice(0, 2));
  const [minute, setMinute] = useState(firstTime.slice(3, 5));
  const [editingTime, setEditingTime] = useState('');
  const selectedTime = `${String(clampTimePart(hour, 23)).padStart(2, '0')}:${String(clampTimePart(minute, 59)).padStart(2, '0')}`;
  const duplicateTime = times.includes(selectedTime) && selectedTime !== editingTime;

  function openPicker(seedTime, editing = false) {
    const nextTime = seedTime || nextUnusedCheckTime(times);
    setHour(nextTime.slice(0, 2));
    setMinute(nextTime.slice(3, 5));
    setEditingTime(editing && times.includes(nextTime) ? nextTime : '');
    setVisible(true);
  }

  function setHourPart(nextHour) {
    setHour(String(clampTimePart(nextHour, 23)).padStart(2, '0'));
  }

  function setMinutePart(nextMinute) {
    setMinute(String(clampTimePart(nextMinute, 59)).padStart(2, '0'));
  }

  function stepHour(delta) {
    setHourPart((Number(hour) + delta + 24) % 24);
  }

  function stepMinute(delta) {
    const next = Number(minute) + delta;
    setMinutePart((next + 60) % 60);
  }

  function addTime() {
    if (duplicateTime) return;

    const nextTimes = editingTime
      ? times.map((time) => (time === editingTime ? selectedTime : time))
      : [...times, selectedTime];
    onChange(normalizeCheckTimes(nextTimes));
    setVisible(false);
  }

  function removeTime(timeToRemove) {
    const nextTimes = times.filter((time) => time !== timeToRemove);
    onChange(nextTimes.length ? normalizeCheckTimes(nextTimes) : '');
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Seat check times</Text>
      <View style={styles.timeChipGrid}>
        {times.map((time) => (
          <Pressable key={time} style={styles.timeChip} onPress={() => openPicker(time, true)}>
            <Ionicons name="time-outline" size={14} color="#1d3557" />
            <Text style={styles.timeChipText}>{formatCheckTimeLabel(time)}</Text>
            <Pressable
              style={styles.timeChipRemove}
              onPress={(event) => {
                event?.stopPropagation?.();
                removeTime(time);
              }}
            >
              <Ionicons name="close" size={13} color="#526175" />
            </Pressable>
          </Pressable>
        ))}
        <Pressable style={styles.timeAddButton} onPress={() => openPicker()}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.timeAddButtonText}>Add time</Text>
        </Pressable>
      </View>

      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.timePickerBackdrop}>
          <View style={styles.timePickerPanel}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingTime ? 'Edit Time' : 'Add Time'}</Text>
              <TouchableOpacity onPress={() => setVisible(false)} style={styles.iconOnly}>
                <Ionicons name="close" size={24} color="#1d3557" />
              </TouchableOpacity>
            </View>

            <View style={styles.timePickerContent}>
              <View style={styles.timeStepper}>
                <TouchableOpacity style={styles.timeStepButton} onPress={() => stepHour(1)}>
                  <Ionicons name="chevron-up" size={22} color="#1d3557" />
                </TouchableOpacity>
                <TextInput
                  style={styles.timeInput}
                  value={hour}
                  onChangeText={setHourPart}
                  keyboardType="number-pad"
                  maxLength={2}
                />
                <TouchableOpacity style={styles.timeStepButton} onPress={() => stepHour(-1)}>
                  <Ionicons name="chevron-down" size={22} color="#1d3557" />
                </TouchableOpacity>
                <Text style={styles.timePartLabel}>Hour</Text>
              </View>

              <Text style={styles.timeSeparator}>:</Text>

              <View style={styles.timeStepper}>
                <TouchableOpacity style={styles.timeStepButton} onPress={() => stepMinute(5)}>
                  <Ionicons name="chevron-up" size={22} color="#1d3557" />
                </TouchableOpacity>
                <TextInput
                  style={styles.timeInput}
                  value={minute}
                  onChangeText={setMinutePart}
                  keyboardType="number-pad"
                  maxLength={2}
                />
                <TouchableOpacity style={styles.timeStepButton} onPress={() => stepMinute(-5)}>
                  <Ionicons name="chevron-down" size={22} color="#1d3557" />
                </TouchableOpacity>
                <Text style={styles.timePartLabel}>Minute</Text>
              </View>
            </View>

            <View style={styles.timePickerPreview}>
              <Text style={styles.timePickerPreviewText}>
                {formatCheckTimeLabel(selectedTime)}
              </Text>
              {duplicateTime && <Text style={styles.timePickerWarning}>Already added</Text>}
            </View>

            <View style={styles.captchaActions}>
              <IconButton
                icon="checkmark"
                label={editingTime ? 'Update' : 'Add'}
                compact
                onPress={addTime}
                disabled={duplicateTime}
              />
              <IconButton icon="close" label="Cancel" tone="secondary" compact onPress={() => setVisible(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function calendarAvailabilityText(occurrence) {
  const status = occurrence.availability_status || '';
  if (!status && !occurrence.last_checked_at) return 'Not checked';
  if (isNotAvailableStatus(status)) return formatAvailabilitySummary(occurrence);
  if (isAvailableStatus(status)) return 'Available';
  if (/RAC/i.test(status)) return 'RAC';
  if (/(^|\/)[A-Z]*WL/i.test(status)) return 'Waitlist';
  return formatAvailabilitySummary(occurrence);
}

function calendarAvailabilityValue(occurrence) {
  const status = occurrence.availability_status || '';
  const hasCount = occurrence.available_count !== null && occurrence.available_count !== undefined;
  const availableCount = hasCount ? Number(occurrence.available_count) : parseAvailableCount(status);
  if (isAvailableStatus(status) && availableCount !== null) return String(availableCount);

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
  if (isAvailableStatus(status)) return 'available';
  return 'neutral';
}

function occurrenceVisualLabel(state) {
  const labels = {
    booked: 'Booked',
    ignored: 'Ignored',
    waitlist: 'Waitlist',
    low: 'Seat alert',
    available: 'Tickets available',
    neutral: 'Pending'
  };
  return labels[state] || 'Pending';
}

function eventLastCheckedAt(event) {
  const checkedTimes = (event.occurrences || [])
    .map((occurrence) => occurrence.last_checked_at)
    .filter(Boolean);
  if (!checkedTimes.length) return '';

  return checkedTimes.reduce((latest, value) => (
    new Date(value).getTime() > new Date(latest).getTime() ? value : latest
  ));
}

function formatClock(hour, minute) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function nextCheckText(event) {
  if (!event?.is_active) return 'Inactive';

  const times = String(event.check_times || '')
    .split(',')
    .map((time) => {
      const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
      if (!match) return null;
      return {
        hour: Number(match[1]),
        minute: Number(match[2]),
        value: (Number(match[1]) * 60) + Number(match[2])
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.value - b.value);

  if (!times.length) return 'Not scheduled';

  const now = new Date();
  const nowValue = (now.getHours() * 60) + now.getMinutes();
  const lastCheckedAt = eventLastCheckedAt(event);
  const lastCheckedTime = lastCheckedAt ? new Date(lastCheckedAt).getTime() : 0;
  const dueNow = times.find((time) => {
    if (time.value > nowValue) return false;
    const slotTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      time.hour,
      time.minute,
      0,
      0
    ).getTime();
    return !lastCheckedTime || lastCheckedTime < slotTime;
  });

  if (dueNow) return `Due now (${formatClock(dueNow.hour, dueNow.minute)})`;

  const nextToday = times.find((time) => time.value >= nowValue);
  const next = nextToday || times[0];
  return `${nextToday ? 'Today' : 'Tomorrow'}, ${formatClock(next.hour, next.minute)}`;
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

function nextTravelDateAfter(date, event) {
  const recurrenceType = normalizeRecurrenceType(event?.recurrence_type);
  if (recurrenceType === 'daily') return addDays(date, 1);

  if (recurrenceType === 'fortnightly' || recurrenceType === 'monthly') {
    let cursor = localDateFromIso(event?.start_date);
    if (Number.isNaN(cursor.getTime())) cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= date) {
      if (recurrenceType === 'fortnightly') {
        cursor = addDays(cursor, 15);
      } else {
        const next = new Date(cursor);
        next.setMonth(next.getMonth() + 1);
        next.setHours(0, 0, 0, 0);
        cursor = next;
      }
    }
    return cursor;
  }

  const weekday = event?.weekday;
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
    : nextTravelDateAfter(bookingEnd, event);

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

function formatFriendlyBookingDate(dateOrValue) {
  if (!dateOrValue) return '';

  const target = new Date(dateOrValue);
  target.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays <= 7) {
    return `Coming ${target.toLocaleDateString('en-IN', { weekday: 'long' })}`;
  }

  return formatBookingDate(target);
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

function EventFormModal({ visible, editingEvent, onClose, onSaveTrip }) {
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [formTouched, setFormTouched] = useState(false);
  const [activeAutocompleteId, setActiveAutocompleteId] = useState(null);
  const formValidationMessage = useMemo(() => {
    try {
      return validateEventPayload(normalizeEventPayload({ ...form, is_active: form.is_active }));
    } catch (err) {
      return err.message || 'Please review the trip details';
    }
  }, [form]);
  const canSave = !saving && !formValidationMessage;
  const showValidationMessage = formTouched && formValidationMessage;

  useEffect(() => {
    if (!visible) return;
    setFormTouched(false);
    setActiveAutocompleteId(null);
    setForm(editingEvent ? {
      name: editingEvent.name,
      recurrence_type: normalizeRecurrenceType(editingEvent.recurrence_type),
      start_date: editingEvent.start_date || new Date().toISOString().slice(0, 10),
      weekday: editingEvent.weekday,
      train_no: editingEvent.train_no,
      class_code: editingEvent.class_code,
      quota: editingEvent.quota,
      source_station: editingEvent.source_station,
      destination_station: editingEvent.destination_station,
      threshold: String(editingEvent.threshold),
      check_times: editingEvent.check_times || '08:00',
      booking_window_reminders: Boolean(editingEvent.booking_window_reminders),
      is_active: Boolean(editingEvent.is_active)
    } : blankForm);
  }, [editingEvent, visible]);

  function setField(key, value) {
    setFormTouched(true);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function dismissAutocomplete(expectedId) {
    setActiveAutocompleteId((current) => {
      if (expectedId && current !== expectedId) return current;
      return null;
    });
  }

  function rowHasActiveAutocomplete(ids) {
    return ids.includes(activeAutocompleteId);
  }

  async function save() {
    try {
      setSaving(true);
      const body = {
        ...form,
        is_active: form.is_active
      };
      const payload = normalizeEventPayload(body);
      const validationError = validateEventPayload(payload);
      if (validationError) throw new Error(validationError);

      const result = await onSaveTrip(body, editingEvent?.id || null);
      if (result?.pendingCaptcha) return;
    } catch (err) {
      Alert.alert('Unable to save trip', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
          <Text style={styles.modalTitle}>{editingEvent ? 'Edit Trip' : 'Create Trip'}</Text>
          <TouchableOpacity onPress={onClose} style={styles.iconOnly}>
            <Ionicons name="close" size={24} color="#1d3557" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.modalBody,
            { paddingBottom: 36 + Math.max(insets.bottom, 12) }
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Field
            label="Trip name"
            value={form.name}
            onChangeText={(value) => setField('name', value)}
            autoCapitalize="words"
            onFocus={dismissAutocomplete}
          />

          <Text style={styles.label}>Travel frequency</Text>
          <View style={styles.recurrenceGrid}>
            {RECURRENCE_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => {
                  dismissAutocomplete();
                  setField('recurrence_type', option.value);
                }}
                style={[styles.recurrenceChip, form.recurrence_type === option.value && styles.weekdayChipSelected]}
              >
                <Text style={[styles.weekdayText, form.recurrence_type === option.value && styles.weekdayTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {form.recurrence_type === 'weekly' ? (
            <>
              <Text style={styles.label}>Travel weekday</Text>
              <View style={styles.weekdayGrid}>
                {WEEKDAYS.map((weekday) => (
                  <Pressable
                    key={weekday}
                    onPress={() => {
                      dismissAutocomplete();
                      setField('weekday', weekday);
                    }}
                    style={[styles.weekdayChip, form.weekday === weekday && styles.weekdayChipSelected]}
                  >
                    <Text style={[styles.weekdayText, form.weekday === weekday && styles.weekdayTextSelected]}>
                      {weekday.slice(0, 3)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <Field
              label="Start date"
              value={form.start_date}
              onChangeText={(value) => setField('start_date', value)}
              autoCapitalize="none"
              placeholder="YYYY-MM-DD"
              onFocus={dismissAutocomplete}
            />
          )}

          <AutocompleteField
            id="train_no"
            label="Train"
            value={form.train_no}
            onChangeText={(value) => setField('train_no', value)}
            onSelect={(item) => setField('train_no', item.value)}
            searchSuggestions={searchTrainSuggestions}
            autoCapitalize="characters"
            placeholder="Train no or name"
            activeId={activeAutocompleteId}
            onActivate={setActiveAutocompleteId}
            onDismiss={dismissAutocomplete}
          />

          <View style={[styles.twoCol, rowHasActiveAutocomplete(['class_code', 'quota']) && styles.twoColActive]}>
            <AutocompleteField
              id="class_code"
              label="Class"
              value={form.class_code}
              onChangeText={(value) => setField('class_code', value)}
              onSelect={(item) => setField('class_code', item.value)}
              searchSuggestions={searchClassSuggestions}
              minQueryLength={0}
              autoCapitalize="characters"
              placeholder="SL, 3A, AC..."
              activeId={activeAutocompleteId}
              onActivate={setActiveAutocompleteId}
              onDismiss={dismissAutocomplete}
            />
            <AutocompleteField
              id="quota"
              label="Quota"
              value={form.quota}
              onChangeText={(value) => setField('quota', value)}
              onSelect={(item) => setField('quota', item.value)}
              searchSuggestions={searchQuotaSuggestions}
              minQueryLength={0}
              autoCapitalize="characters"
              placeholder="GN, Tatkal..."
              activeId={activeAutocompleteId}
              onActivate={setActiveAutocompleteId}
              onDismiss={dismissAutocomplete}
            />
          </View>
          <View style={[styles.twoCol, rowHasActiveAutocomplete(['source_station', 'destination_station']) && styles.twoColActive]}>
            <AutocompleteField
              id="source_station"
              label="From station"
              value={form.source_station}
              onChangeText={(value) => setField('source_station', value)}
              onSelect={(item) => setField('source_station', item.value)}
              searchSuggestions={searchStationSuggestions}
              autoCapitalize="characters"
              placeholder="Code or name"
              activeId={activeAutocompleteId}
              onActivate={setActiveAutocompleteId}
              onDismiss={dismissAutocomplete}
            />
            <AutocompleteField
              id="destination_station"
              label="To station"
              value={form.destination_station}
              onChangeText={(value) => setField('destination_station', value)}
              onSelect={(item) => setField('destination_station', item.value)}
              searchSuggestions={searchStationSuggestions}
              autoCapitalize="characters"
              placeholder="Code or name"
              activeId={activeAutocompleteId}
              onActivate={setActiveAutocompleteId}
              onDismiss={dismissAutocomplete}
            />
          </View>
          <Field
            label="Alert when seats are ≤"
            value={form.threshold}
            onChangeText={(value) => setField('threshold', value)}
            keyboardType="number-pad"
            onFocus={dismissAutocomplete}
          />
          <CheckTimesPicker value={form.check_times} onChange={(value) => setField('check_times', value)} />
          <ToggleSelection
            label="Seat alerts"
            value={form.is_active}
            onValueChange={(value) => setField('is_active', value)}
            description="Checks seat availability at your selected times and sends alerts when seats match your alert rule."
          />
          <ToggleSelection
            label="Booking window reminders"
            value={form.booking_window_reminders}
            onValueChange={(value) => setField('booking_window_reminders', value)}
            description="Sends reminders 2 days and 1 day before booking opens for this trip."
          />

          {showValidationMessage ? (
            <Text style={styles.formValidationText}>{formValidationMessage}</Text>
          ) : null}
          <IconButton icon="save-outline" label={saving ? 'Saving...' : 'Save trip'} onPress={save} disabled={!canSave} />
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
                autoCapitalize="characters"
                keyboardType="default"
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
  const [loadingStatus, setLoadingStatus] = useState(null);
  const [nativeNotificationsEnabled, setNativeNotificationsEnabled] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const autoCaptchaCooldownUntilByEventRef = useMemo(() => new Map(), []);
  const autoChecksPausedUntilRef = useRef(0);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) || null,
    [events, selectedEventId]
  );

  const refreshNotificationPermissionStatus = useCallback(async () => {
    try {
      const permissions = await ExpoNotifications.getPermissionsAsync();
      setNativeNotificationsEnabled(permissions.status === 'granted' || permissions.granted);
    } catch {
      setNativeNotificationsEnabled(false);
    }
  }, []);

  const refresh = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setRefreshing(true);
    try {
      await ensureFutureOccurrences();
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
      await refreshNotificationPermissionStatus();
    } finally {
      if (showLoading) setRefreshing(false);
    }
  }, [refreshNotificationPermissionStatus]);

  function autoCaptchaCooldownSettingKey(eventId) {
    return `${AUTO_CAPTCHA_COOLDOWN_SETTING_PREFIX}${Number(eventId)}`;
  }

  const isAutoCaptchaCoolingDown = useCallback(async (eventId) => {
    const numericEventId = Number(eventId);
    if (!numericEventId) return false;

    let cooldownUntil = autoCaptchaCooldownUntilByEventRef.get(numericEventId);
    if (!cooldownUntil) {
      cooldownUntil = Number(await getSetting(autoCaptchaCooldownSettingKey(numericEventId), '0')) || 0;
      if (cooldownUntil) autoCaptchaCooldownUntilByEventRef.set(numericEventId, cooldownUntil);
    }

    if (Date.now() < cooldownUntil) return true;

    if (cooldownUntil) {
      autoCaptchaCooldownUntilByEventRef.delete(numericEventId);
      await setSetting(autoCaptchaCooldownSettingKey(numericEventId), '0');
    }
    return false;
  }, [autoCaptchaCooldownUntilByEventRef]);

  const startAutoCaptchaCooldown = useCallback(async (eventId) => {
    const numericEventId = Number(eventId);
    if (!numericEventId) return;
    const cooldownUntil = Date.now() + AUTO_CAPTCHA_COOLDOWN_MS;
    autoCaptchaCooldownUntilByEventRef.set(numericEventId, cooldownUntil);
    await setSetting(autoCaptchaCooldownSettingKey(numericEventId), String(cooldownUntil));
  }, [autoCaptchaCooldownUntilByEventRef]);

  const clearAutoCaptchaCooldown = useCallback(async (eventId) => {
    const numericEventId = Number(eventId);
    if (!numericEventId) return;
    autoCaptchaCooldownUntilByEventRef.delete(numericEventId);
    await setSetting(autoCaptchaCooldownSettingKey(numericEventId), '0');
  }, [autoCaptchaCooldownUntilByEventRef]);

  const pauseAutoChecksAfterManualCheck = useCallback(() => {
    autoChecksPausedUntilRef.current = Date.now() + MANUAL_CHECK_AUTO_PAUSE_MS;
  }, []);

  const isAutoCheckPaused = useCallback(() => {
    return Date.now() < autoChecksPausedUntilRef.current;
  }, []);

  const {
    captchaVisible,
    captchaImage,
    captchaValue,
    captchaLoading,
    pendingCheck,
    setCaptchaValue,
    openCaptcha,
    reloadCaptcha,
    hideCaptcha,
    reopenCaptcha,
    resetCaptcha,
    cancelCaptcha
  } = useCaptchaFlow({
    refresh,
    clearAutoCaptchaCooldown,
    startAutoCaptchaCooldown
  });

  const { autoChecking, runForegroundCatchUp } = useForegroundCatchUp({
    ready,
    captchaVisible,
    pendingCheck,
    refresh,
    openCaptcha,
    isAutoCaptchaCoolingDown,
    isAutoCheckPaused
  });

  useEffect(() => {
    (async () => {
      try {
        await initDatabase();
        await ensureFutureOccurrences();
        await cleanupOldData();
        setNativeNotificationsEnabled(await configureNotifications());
        await registerBackgroundChecks();
        await refresh({ showLoading: true });
      } catch (err) {
        Alert.alert('Startup failed', err.message);
      } finally {
        setReady(true);
      }
    })();
  }, [refresh]);

  useEffect(() => {
    if (!ready) return undefined;
    runForegroundCatchUp();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshNotificationPermissionStatus();
        runForegroundCatchUp();
      }
    });
    return () => subscription.remove();
  }, [ready, refreshNotificationPermissionStatus, runForegroundCatchUp]);

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

  async function openCaptchaForEvent(eventId, fromNotification = false) {
    const numericEventId = Number(eventId);
    if (!numericEventId) return;
    setSelectedEventId(numericEventId);
    await clearAutoCaptchaCooldown(numericEventId);
    if (navigationRef.isReady()) {
      navigationRef.navigate('Alerts');
    }
    await openCaptcha({
      type: 'event',
      eventId: numericEventId,
      suppressNotifications: !fromNotification
    });
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

  async function runEventCheck(event, inputCaptcha = '', deepCheck = true) {
    const result = await checkEvent(event.id, { inputCaptcha, suppressNotifications: false, deepCheck });
    if (result.captchaRequired) {
      await openCaptcha({ type: 'event', eventId: event.id, suppressNotifications: false });
      return result;
    }
    pauseAutoChecksAfterManualCheck();
    await refresh();
    Alert.alert('Check complete', `${result.checked || 0} occurrence(s) checked.`);
    return result;
  }

  async function runEventCheckBatch(eventsToCheck, initialChecked = 0, initialCheckedEvents = 0, includeAllStatuses = false) {
    let checked = initialChecked;
    let checkedEvents = initialCheckedEvents;

    for (let index = 0; index < eventsToCheck.length; index += 1) {
      const event = eventsToCheck[index];
      const result = await checkEvent(event.id, { suppressNotifications: false, deepCheck: true, includeAllStatuses });
      if (result.captchaRequired) {
        await refresh();
        await openCaptcha({
          type: 'event',
          eventId: event.id,
          suppressNotifications: false,
          resumeEventIds: eventsToCheck.slice(index + 1).map((item) => item.id),
          checkedSoFar: checked,
          checkedEventsSoFar: checkedEvents,
          includeAllStatuses
        });
        return { paused: true, checked, checkedEvents };
      }

      checked += result.checked || 0;
      checkedEvents += 1;
    }

    pauseAutoChecksAfterManualCheck();
    await refresh();
    Alert.alert('Checks complete', `${checked} occurrence(s) checked across ${checkedEvents} active trip(s).`);
    return { paused: false, checked, checkedEvents };
  }

  async function runAllEventChecks() {
    const activeEvents = events.filter((event) => event.is_active);
    if (!activeEvents.length) {
      Alert.alert('No active trips', 'Create or enable a trip before checking alerts.');
      return;
    }

    await runEventCheckBatch(activeEvents, 0, 0, true);
  }

  async function runOccurrenceCheck(event, occurrence, inputCaptcha = '') {
    const result = await checkOccurrence(buildOccurrenceRow(event, occurrence), { inputCaptcha, force: true });
    if (result.captchaRequired) {
      await openCaptcha({ type: 'occurrence', eventId: event.id, occurrenceId: occurrence.id });
      return result;
    }
    pauseAutoChecksAfterManualCheck();
    await refresh();
    Alert.alert('Check complete', result.availabilitySummary || result.availabilityStatus || 'No availability status returned');
    return result;
  }

  async function saveEventFromForm(body, editingEventId = null, inputCaptcha = '') {
    const payload = normalizeEventPayload(body);
    const validationError = validateEventPayload(payload);
    if (validationError) throw new Error(validationError);

    const railValidation = await validateTripAvailability(payload, { inputCaptcha });
    if (railValidation.captchaRequired) {
      if (inputCaptcha) throw new Error('Captcha was not accepted. Try again.');
      await openCaptcha({
        type: 'save-event',
        body,
        editingEventId
      });
      return { pendingCaptcha: true };
    }
    if (!railValidation.valid) {
      throw new Error(`Indian Rail validation failed: ${railValidation.message}`);
    }

    const saved = editingEventId
      ? await updateEvent(editingEventId, body)
      : await createEvent(body);
    setSelectedEventId(saved.id);

    const immediateCheck = await checkEvent(saved.id, {
      inputCaptcha,
      suppressNotifications: false,
      deepCheck: true
    });

    await refresh();
    setFormVisible(false);
    if (immediateCheck.captchaRequired) {
      await openCaptcha({
        type: 'event',
        eventId: saved.id,
        suppressNotifications: false
      });
      return { saved, pendingCaptcha: true };
    }
    return { saved };
  }

  async function submitCaptcha() {
    if (!pendingCheck || !captchaValue.trim()) return;
    const submittedCaptcha = captchaValue.trim();
    hideCaptcha();
    try {
      setBusy(true);
      setLoadingStatus({
        title: 'Checking seat availability',
        detail: 'Submitting CAPTCHA and continuing the pending check.'
      });

      if (pendingCheck.type === 'save-event') {
        setLoadingStatus({
          title: 'Validating trip details',
          detail: 'Submitting CAPTCHA and checking the first generated travel date.'
        });
        await saveEventFromForm(
          pendingCheck.body,
          pendingCheck.editingEventId || null,
          submittedCaptcha
        );
        resetCaptcha();
        return;
      }

      const event = events.find((item) => item.id === pendingCheck.eventId);
      if (!event) throw new Error('Trip not found for pending check');

      if (pendingCheck.type === 'event') {
        const result = await checkEvent(event.id, {
          inputCaptcha: submittedCaptcha,
          suppressNotifications: Boolean(pendingCheck.suppressNotifications),
          deepCheck: true,
          includeAllStatuses: Boolean(pendingCheck.includeAllStatuses)
        });
        if (result.captchaRequired) throw new Error('Captcha was not accepted. Try again.');
        if (pendingCheck.automated && pendingCheck.runDate && pendingCheck.scheduledTimes?.length) {
          await recordRuns(event.id, pendingCheck.runDate, pendingCheck.scheduledTimes);
        }
        pauseAutoChecksAfterManualCheck();
        const resumeEventIds = pendingCheck.resumeEventIds || [];
        if (resumeEventIds.length) {
          const remainingEvents = resumeEventIds
            .map((id) => events.find((item) => item.id === id))
            .filter(Boolean);

          resetCaptcha();
          await clearAutoCaptchaCooldown(event.id);
          await runEventCheckBatch(
            remainingEvents,
            (pendingCheck.checkedSoFar || 0) + (result.checked || 0),
            (pendingCheck.checkedEventsSoFar || 0) + 1,
            Boolean(pendingCheck.includeAllStatuses)
          );
          return;
        }
      } else {
        const occurrence = event.occurrences.find((item) => item.id === pendingCheck.occurrenceId);
        if (!occurrence) throw new Error('Occurrence not found for pending check');
        const result = await checkOccurrence(buildOccurrenceRow(event, occurrence), {
          inputCaptcha: submittedCaptcha,
          force: true
        });
        if (result.captchaRequired) throw new Error('Captcha was not accepted. Try again.');
        pauseAutoChecksAfterManualCheck();
      }

      resetCaptcha();
      await clearAutoCaptchaCooldown(event.id);
      await refresh();
    } catch (err) {
      const captchaError = /captcha/i.test(err.message || '');
      if (captchaError) {
        await reopenCaptcha();
      } else {
        resetCaptcha();
      }
      Alert.alert(
        pendingCheck?.type === 'save-event' && !captchaError ? 'Unable to save trip' : 'Captcha check failed',
        err.message
      );
    } finally {
      setLoadingStatus(null);
      setBusy(false);
    }
  }

  async function withBusy(fn, status = null) {
    try {
      setBusy(true);
      setLoadingStatus(status);
      await fn();
    } catch (err) {
      Alert.alert('Request failed', err.message);
    } finally {
      setLoadingStatus(null);
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
        <StatusBar style="dark" backgroundColor="#f6f8fb" translucent={false} />
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
                Trips: 'train-outline',
                Calendar: 'calendar-outline',
                Alerts: 'notifications-outline',
                About: 'information-circle-outline'
              };
              return <Ionicons name={icons[route.name]} size={size} color={color} />;
            }
          })}
        >
          <Tab.Screen name="Trips">
            {() => (
              <TripsScreen
                styles={styles}
                Screen={Screen}
                EmptyState={EmptyState}
                Pill={Pill}
                IconButton={IconButton}
                sessionStatus={sessionStatus}
                nativeNotificationsEnabled={nativeNotificationsEnabled}
                busy={busy}
                events={events}
                selectedEventId={selectedEventId}
                refresh={refresh}
                withBusy={withBusy}
                runAllEventChecks={runAllEventChecks}
                runEventCheck={runEventCheck}
                openEventCalendar={openEventCalendar}
                setEditingEvent={setEditingEvent}
                setFormVisible={setFormVisible}
                eventRecurrenceLabel={eventRecurrenceLabel}
                eventLastCheckedAt={eventLastCheckedAt}
                nextCheckText={nextCheckText}
              />
            )}
          </Tab.Screen>
          <Tab.Screen name="Calendar">
            {() => (
              <CalendarScreen
                styles={styles}
                Screen={Screen}
                EmptyState={EmptyState}
                Pill={Pill}
                IconButton={IconButton}
                IrctcLinkButton={IrctcLinkButton}
                selectedEvent={selectedEvent}
                busy={busy}
                refresh={refresh}
                withBusy={withBusy}
                runEventCheck={runEventCheck}
                runOccurrenceCheck={runOccurrenceCheck}
                openRailConnect={openRailConnect}
                bookingWindowInfo={bookingWindowInfo}
                occurrenceVisualState={occurrenceVisualState}
                occurrenceVisualLabel={occurrenceVisualLabel}
                calendarAvailabilityText={calendarAvailabilityText}
                calendarAvailabilityValue={calendarAvailabilityValue}
                formatBookingDate={formatBookingDate}
                formatFriendlyBookingDate={formatFriendlyBookingDate}
              />
            )}
          </Tab.Screen>
          <Tab.Screen name="Alerts">
            {() => (
              <AlertsScreen
                styles={styles}
                Screen={Screen}
                EmptyState={EmptyState}
                Pill={Pill}
                notifications={notifications}
                refresh={refresh}
                withBusy={withBusy}
                handleNotificationPress={handleNotificationPress}
                isCaptchaNotification={isCaptchaNotification}
              />
            )}
          </Tab.Screen>
          <Tab.Screen name="About">
            {() => (
              <AboutScreen
                styles={styles}
                Screen={Screen}
              />
            )}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>

      <EventFormModal
        visible={formVisible}
        editingEvent={editingEvent}
        onClose={() => setFormVisible(false)}
        onSaveTrip={saveEventFromForm}
      />
      <CaptchaModal
        visible={captchaVisible}
        imageUri={captchaImage}
        value={captchaValue}
        loading={captchaLoading || busy}
        onChangeText={setCaptchaValue}
        onReload={reloadCaptcha}
        onCancel={cancelCaptcha}
        onSubmit={submitCaptcha}
      />
      {(loadingStatus || refreshing || autoChecking) && (
        <View style={styles.loadingCard} pointerEvents="none">
          <View style={styles.loadingCardSpinner}>
            <ActivityIndicator size="small" color="#1d3557" />
          </View>
          <View style={styles.loadingCardTextBlock}>
            <Text style={styles.loadingCardTitle}>
              {loadingStatus?.title || (autoChecking ? 'Checking scheduled alerts' : 'Refreshing trips')}
            </Text>
            <Text style={styles.loadingCardDetail}>
              {loadingStatus?.detail || (autoChecking
                ? 'Seat availability checks are running one by one.'
                : 'Updating trips, occurrences, and session status.')}
            </Text>
          </View>
        </View>
      )}
    </>
  );
}

function Screen({ children }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.screenScroll}
        contentContainerStyle={[
          styles.screenContent,
          {
            paddingTop: Math.max(insets.top, 16) + 18,
            paddingBottom: 16
          }
        ]}
      >
        {children}
      </ScrollView>
      <View style={styles.stickyAdFooter}>
        <AdBanner placement="sticky" />
      </View>
    </View>
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
  loadingCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 96,
    minHeight: 72,
    borderRadius: 8,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#d5dde8',
    zIndex: 80,
    elevation: 80,
    shadowColor: '#172033',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 }
  },
  loadingCardSpinner: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#edf3f8',
    alignItems: 'center',
    justifyContent: 'center'
  },
  loadingCardTextBlock: {
    flex: 1,
    minWidth: 0
  },
  loadingCardTitle: {
    color: '#172033',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 3
  },
  loadingCardDetail: {
    color: '#526175',
    fontSize: 12,
    lineHeight: 16
  },
  screen: {
    flex: 1,
    backgroundColor: '#f6f8fb'
  },
  screenScroll: {
    flex: 1,
    backgroundColor: '#f6f8fb'
  },
  stickyAdFooter: {
    backgroundColor: '#f6f8fb',
    borderTopWidth: 1,
    borderTopColor: '#e1e7ef',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    zIndex: 20,
    elevation: 20
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
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
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
  occurrenceHeaderTitle: {
    flex: 1,
    minWidth: 0
  },
  occurrenceHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    maxWidth: '58%'
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
  infoText: {
    color: '#526175',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8
  },
  linkRow: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe3ee',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9
  },
  linkRowText: {
    color: '#1d3557',
    fontSize: 14,
    fontWeight: '800',
    flexShrink: 1
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
  irctcLinkButton: {
    alignSelf: 'flex-start',
    minHeight: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd6e3',
    backgroundColor: '#fff',
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5
  },
  irctcLinkButtonText: {
    color: '#1d3557',
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
  autocompleteField: {
    position: 'relative',
    zIndex: 1,
    elevation: 1
  },
  autocompleteFieldActive: {
    zIndex: 1000,
    elevation: 1000
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
  suggestionList: {
    position: 'absolute',
    top: 70,
    left: 0,
    right: 0,
    zIndex: 1100,
    elevation: 1100,
    maxHeight: 230,
    borderWidth: 1,
    borderColor: '#dbe3ee',
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
    shadowColor: '#172033',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }
  },
  suggestionItem: {
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#edf1f6'
  },
  suggestionLabel: {
    color: '#172033',
    fontSize: 13,
    fontWeight: '800'
  },
  suggestionValue: {
    color: '#60708a',
    fontSize: 12,
    marginTop: 2
  },
  suggestionMeta: {
    color: '#60708a',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  timeChipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  timeChip: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd6e3',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  timeChipText: {
    color: '#1d3557',
    fontSize: 13,
    fontWeight: '900'
  },
  timeChipRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2f6'
  },
  timeAddButton: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: '#1d3557',
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  timeAddButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900'
  },
  timePickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 51, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18
  },
  timePickerPanel: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 8,
    backgroundColor: '#f6f8fb',
    paddingBottom: 14
  },
  timePickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 4
  },
  timeStepper: {
    alignItems: 'center',
    gap: 6
  },
  timeStepButton: {
    width: 48,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eaf0f6'
  },
  timeInput: {
    width: 64,
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ced7e4',
    backgroundColor: '#fff',
    color: '#172033',
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '900'
  },
  timeSeparator: {
    color: '#172033',
    fontSize: 28,
    fontWeight: '900',
    paddingBottom: 20
  },
  timePartLabel: {
    color: '#60708a',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase'
  },
  timePickerPreview: {
    alignItems: 'center',
    marginTop: 12
  },
  timePickerPreviewText: {
    color: '#1d3557',
    fontSize: 16,
    fontWeight: '900'
  },
  timePickerWarning: {
    color: '#a9162a',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4
  },
  formValidationText: {
    color: '#a9162a',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 10
  },
  weekdayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14
  },
  recurrenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14
  },
  recurrenceChip: {
    minWidth: 78,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ced7e4',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 10
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
    gap: 10,
    zIndex: 1
  },
  twoColActive: {
    zIndex: 900,
    elevation: 900
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4
  },
  toggleSelection: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ced7e4',
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 12
  },
  toggleSelectionActive: {
    backgroundColor: '#1d3557',
    borderColor: '#1d3557'
  },
  toggleSelectionLabel: {
    color: '#31405a',
    fontWeight: '900',
    fontSize: 14
  },
  toggleSelectionTextActive: {
    color: '#fff'
  },
  toggleSelectionDescription: {
    color: '#60708a',
    fontSize: 12,
    lineHeight: 17,
    paddingRight: 44
  },
  toggleSelectionDescriptionActive: {
    color: '#dce8f5'
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
