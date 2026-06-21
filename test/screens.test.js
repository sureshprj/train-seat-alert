const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const path = require('path');
const { loadSourceModule, projectRoot } = require('./loadSourceModule');

const reactNativeMock = {
  Alert: { alert: () => {} },
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View'
};

const ioniconsMock = {
  Ionicons: (props) => React.createElement('Ionicons', props)
};

function collectStrings(node, values = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return values;
  if (typeof node === 'string' || typeof node === 'number') {
    values.push(String(node));
    return values;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectStrings(child, values));
    return values;
  }
  if (React.isValidElement(node)) {
    for (const key of ['title', 'body', 'label']) {
      if (node.props?.[key]) values.push(String(node.props[key]));
    }
    collectStrings(node.props?.children, values);
  }
  return values;
}

function loadScreen(relativePath, extraMocks = {}) {
  return loadSourceModule(relativePath, {
    react: React,
    'react-native': reactNativeMock,
    '@expo/vector-icons': ioniconsMock,
    [path.join(projectRoot, 'src/database.js')]: {
      deleteEvent: async () => {},
      updateOccurrenceStatus: async () => {}
    },
    [path.join(projectRoot, 'src/notifications.js')]: {
      clearAllNotifications: async () => {}
    },
    ...extraMocks
  }).default;
}

const Screen = ({ children }) => React.createElement('Screen', null, children);
const EmptyState = (props) => React.createElement('EmptyState', props);
const Pill = (props) => React.createElement('Pill', props);
const IconButton = (props) => React.createElement('IconButton', props);
const IrctcLinkButton = (props) => React.createElement('IrctcLinkButton', props);

const styles = new Proxy({}, {
  get: (_target, property) => String(property)
});

function isoDateFromLocalDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

test('TripsScreen renders empty and populated trip states after extraction', () => {
  const TripsScreen = loadScreen('src/screens/TripsScreen.js');
  const baseProps = {
    styles,
    Screen,
    EmptyState,
    Pill,
    IconButton,
    sessionStatus: { isActive: true },
    nativeNotificationsEnabled: true,
    busy: false,
    selectedEventId: 1,
    refresh: async () => {},
    withBusy: (fn) => fn(),
    runAllEventChecks: async () => {},
    runEventCheck: async () => {},
    openEventCalendar: () => {},
    openCreateTripForm: () => {},
    openEditTripForm: () => {},
    openSeatCheckFromHoliday: () => {},
    eventRecurrenceLabel: () => 'Tuesday',
    eventTypeLabel: () => 'Regular Trip',
    eventLastCheckedAt: () => '2026-06-14T08:00:00.000Z',
    nextCheckText: () => 'Today, 8:00 AM',
    hasCompleteRailDetails: () => true
  };

  const emptyText = collectStrings(TripsScreen({ ...baseProps, events: [] }));
  assert.ok(emptyText.includes('Trips'));
  assert.ok(emptyText.includes('No trips yet'));

  const populatedText = collectStrings(TripsScreen({
    ...baseProps,
    events: [{
      id: 1,
      name: 'Chennai weekly',
      is_active: true,
      recurrence_type: 'weekly',
      train_no: '12627',
      source_station: 'MAS',
      destination_station: 'SBC',
      class_code: '3A',
      quota: 'GN',
      threshold: 5,
      booking_window_reminders: true,
      check_times: '08:00'
    }]
  }));
  assert.ok(populatedText.includes('Chennai weekly'));
  assert.ok(populatedText.includes('Active'));
  assert.ok(populatedText.join('').includes('Booking reminders: enabled'));

  const holidayWarningText = collectStrings(TripsScreen({
    ...baseProps,
    events: [{
      id: 2,
      name: 'Diwali travel',
      trip_type: 'holiday',
      is_active: true,
      recurrence_type: 'weekly',
      booking_window_reminders: true,
      occurrences: [{ id: 20, travel_date: isoDateFromLocalDate(new Date()) }]
    }],
    hasCompleteRailDetails: () => false,
    eventTypeLabel: () => 'Holiday Travel',
    eventRecurrenceLabel: () => '1 selected date'
  }));
  assert.ok(holidayWarningText.some((value) => value.includes('Booking open for')));
  assert.ok(holidayWarningText.join('').includes('Create a Seat Check Trip'));

  const todayIso = isoDateFromLocalDate(new Date());
  const coveredHolidayText = collectStrings(TripsScreen({
    ...baseProps,
    events: [
      {
        id: 2,
        name: 'Diwali travel',
        trip_type: 'holiday',
        is_active: true,
        recurrence_type: 'weekly',
        booking_window_reminders: true,
        occurrences: [{ id: 20, travel_date: todayIso }]
      },
      {
        id: 3,
        name: 'Diwali travel seat check',
        trip_type: 'seat_check',
        is_active: true,
        recurrence_type: 'weekly',
        booking_window_reminders: false,
        occurrences: [{ id: 30, travel_date: todayIso }]
      }
    ],
    hasCompleteRailDetails: () => false,
    eventTypeLabel: (event) => (event.trip_type === 'holiday' ? 'Holiday Travel' : 'Seat Check Trip'),
    eventRecurrenceLabel: () => '1 selected date'
  }));
  assert.ok(!coveredHolidayText.some((value) => value.includes('Booking open for')));
  assert.ok(!coveredHolidayText.includes('Create seat check'));
});

test('CalendarScreen renders selected trip occurrences after extraction', () => {
  const CalendarScreen = loadScreen('src/screens/CalendarScreen.js');
  const selectedEvent = {
    id: 1,
    name: 'Chennai weekly',
    threshold: 5,
    occurrences: [{
      id: 10,
      travel_date: '2026-06-20',
      availability_status: 'AVAILABLE-0004',
      available_count: 4,
      user_status: 'pending',
      last_checked_at: '2026-06-14T08:00:00.000Z'
    }]
  };

  const text = collectStrings(CalendarScreen({
    styles,
    Screen,
    EmptyState,
    Pill,
    IconButton,
    IrctcLinkButton,
    selectedEvent,
    busy: false,
    refresh: async () => {},
    withBusy: (fn) => fn(),
    runEventCheck: async () => {},
    runOccurrenceCheck: async () => {},
    openRailConnect: () => {},
    bookingWindowInfo: () => ({
      bookingEnd: new Date(2026, 5, 20),
      outsideWindow: new Date(2026, 5, 27),
      nextOpenDate: new Date(2026, 3, 28)
    }),
    occurrenceVisualState: () => 'low',
    occurrenceVisualLabel: () => 'Seat alert',
    calendarAvailabilityText: () => '4 confirmed tickets',
    calendarAvailabilityValue: () => '4',
    formatBookingDate: () => 'Sat, Jun 20',
    formatFriendlyBookingDate: () => 'Tue, Apr 28',
    hasCompleteRailDetails: () => true,
    occurrenceBookingOpenText: () => 'Booking opens Tue, Apr 28'
  }));

  assert.ok(text.includes('Trip Calendar'));
  assert.ok(text.some((value) => value.includes('Chennai weekly: 1 generated dates')));
  assert.ok(text.includes('Seat alert'));
  assert.ok(text.includes('4 confirmed tickets'));
  assert.ok(text.includes('Booking window'));
});

test('CalendarScreen renders holiday reminder cards with countdown and seat check actions', () => {
  const CalendarScreen = loadScreen('src/screens/CalendarScreen.js');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const activeDate = new Date(today);
  activeDate.setDate(activeDate.getDate() + 1);
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + 70);
  const activeIso = isoDateFromLocalDate(activeDate);
  const futureIso = isoDateFromLocalDate(futureDate);

  const baseProps = {
    styles,
    Screen,
    EmptyState,
    Pill,
    IconButton,
    IrctcLinkButton,
    selectedEvent: {
      id: 2,
      name: 'Festival travel',
      trip_type: 'holiday',
      occurrences: [{
        id: 20,
        travel_date: activeIso,
        source_label: 'Day before festival',
        user_status: 'pending'
      }, {
        id: 21,
        travel_date: futureIso,
        source_label: 'Festival day',
        user_status: 'pending'
      }]
    },
    busy: false,
    refresh: async () => {},
    withBusy: (fn) => fn(),
    runEventCheck: async () => {},
    runOccurrenceCheck: async () => {},
    openRailConnect: () => {},
    bookingWindowInfo: () => null,
    occurrenceVisualState: () => 'neutral',
    occurrenceVisualLabel: () => 'Not checked',
    calendarAvailabilityText: () => 'Not checked',
    calendarAvailabilityValue: () => '-',
    formatBookingDate: (date) => isoDateFromLocalDate(date),
    formatFriendlyBookingDate: (date) => isoDateFromLocalDate(date),
    hasCompleteRailDetails: () => false,
    occurrenceBookingOpenText: () => 'Booking opens soon',
    coveredSeatCheckDates: new Set(),
    openSeatCheckFromHoliday: () => {}
  };

  const text = collectStrings(CalendarScreen(baseProps));
  assert.ok(text.includes('Booking window open'));
  assert.ok(text.includes('Create seat check'));
  assert.ok(text.some((value) => value.includes('Booking opens in')));
  assert.ok(text.includes('Day before festival'));
  assert.ok(text.includes('Festival day'));
  assert.ok(!text.includes('Not checked'));
  assert.ok(!text.includes('Last checked'));

  const coveredText = collectStrings(CalendarScreen({
    ...baseProps,
    selectedEvent: {
      ...baseProps.selectedEvent,
      occurrences: [baseProps.selectedEvent.occurrences[0]]
    },
    coveredSeatCheckDates: new Set([activeIso])
  }));
  assert.ok(coveredText.includes('Seat check created'));
  assert.ok(coveredText.includes('Availability monitoring is already set for this travel date.'));
  assert.ok(!coveredText.includes('Create seat check'));
});

test('AlertsScreen renders empty and populated notification states after extraction', () => {
  const AlertsScreen = loadScreen('src/screens/AlertsScreen.js');
  const baseProps = {
    styles,
    Screen,
    EmptyState,
    Pill,
    refresh: async () => {},
    withBusy: (fn) => fn(),
    handleNotificationPress: async () => {},
    isCaptchaNotification: (notification) => /captcha/i.test(notification.message)
  };

  const emptyText = collectStrings(AlertsScreen({ ...baseProps, notifications: [] }));
  assert.ok(emptyText.includes('Notifications'));
  assert.ok(emptyText.includes('No notifications'));

  const populatedText = collectStrings(AlertsScreen({
    ...baseProps,
    notifications: [{
      id: 1,
      message: 'Captcha required before automatic checks can continue.',
      created_at: '2026-06-14T08:00:00.000Z',
      is_read: 0
    }]
  }));
  assert.ok(populatedText.includes('Captcha required before automatic checks can continue.'));
  assert.ok(populatedText.includes('Enter captcha'));
  assert.ok(populatedText.includes('Unread'));
});
