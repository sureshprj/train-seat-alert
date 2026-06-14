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
    setEditingEvent: () => {},
    setFormVisible: () => {},
    eventRecurrenceLabel: () => 'Tuesday',
    eventLastCheckedAt: () => '2026-06-14T08:00:00.000Z',
    nextCheckText: () => 'Today, 8:00 AM'
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
    formatFriendlyBookingDate: () => 'Tue, Apr 28'
  }));

  assert.ok(text.includes('Trip Calendar'));
  assert.ok(text.some((value) => value.includes('Chennai weekly: 1 generated dates')));
  assert.ok(text.includes('Seat alert'));
  assert.ok(text.includes('4 confirmed tickets'));
  assert.ok(text.includes('Booking window'));
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
