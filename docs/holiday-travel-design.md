# Holiday Travel Design

## Goal

Holiday Travel helps users plan one-time vacation or festival travel before they know the exact train details.

The user can select Indian holiday dates, nearby surrounding dates, or custom dates. The app reminds them when the railway booking window is about to open. If train details are available, the same selected dates can also be monitored for seat availability.

This feature extends the app from recurring commute-style trips into vacation planning.

## Problems Solved

- Users often plan travel around holidays before they know the train number.
- Festival and long-weekend tickets need booking-window reminders more than normal recurring trips.
- Users may want to watch several possible dates around one holiday, such as the holiday itself, the previous day, and the next day.
- Train details should not be required just to receive a booking-opening reminder.

## MVP Scope

The first version should support:

- A new trip type: `Holiday Travel`
- Manual date selection
- Indian holiday suggestions for the current and next calendar year
- Surrounding date shortcuts: `-2`, `-1`, holiday, `+1`, `+2`
- Optional train details
- Booking-window reminders for selected dates
- Seat availability checks only when train details are complete
- Existing statuses: `pending`, `booked`, `ignored`

Out of scope for MVP:

- Hotel planning
- Leave/vacation balance tracking
- Multi-city itinerary planning
- Automatic alternate train discovery
- Server-side holiday syncing
- User account sync

## User Experience

### Entry Point

Add a trip type selector when creating a trip:

- Regular Trip
- Holiday Travel

Regular Trip keeps the existing recurrence flow.

Holiday Travel opens a date-focused flow where train details are optional.

### Holiday Travel Form

Core fields:

- Trip name
- Selected travel dates
- Booking-window reminders toggle
- Active status

Optional rail fields:

- Train number
- Class
- Quota
- Source station
- Destination station
- Seat alert limit
- Check times

If rail fields are incomplete, the app should save the holiday plan but disable availability checks for it.

### Holiday Suggestions

Show a simple list grouped by month:

```text
January
  Pongal
    Jan 14
    Jan 13  Jan 14  Jan 15

August
  Independence Day
    Aug 15
    Aug 14  Aug 15  Aug 16
```

Each date should be selectable independently. A holiday can expose nearby dates through chips:

- `-2`
- `-1`
- `Holiday`
- `+1`
- `+2`

The user can also add a custom date.

### Calendar Screen Behavior

For Holiday Travel trips, the calendar should display only the selected dates, not generated recurrence dates.

Each date card can show:

- Date
- Holiday name, if applicable
- Booking opens date
- Reminder status
- Train details status
- Availability status, if train details are present and checks have run

If booking is inside the railway booking window and train details are missing, show a clear action:

```text
Add train details to monitor seats
```

### Notifications

Booking-window notifications should work even without train details:

```text
Booking opens tomorrow for Diwali Holiday Travel. Add train details or book your ticket.
```

If train details are present, existing availability notifications continue to work:

```text
Oct 19 has only 8 seats available. Please book the ticket.
```

## Data Model

The current model can support this feature with small extensions.

### `trip_events`

Add:

```sql
trip_type TEXT NOT NULL DEFAULT 'regular'
holiday_name TEXT
```

Suggested values:

- `regular`
- `holiday`

For `holiday` trips:

- `recurrence_type` can be stored as `custom`
- `weekday` can be blank or ignored
- Train fields may be blank until the user adds them

### `trip_occurrences`

Add:

```sql
source_label TEXT
```

Examples:

- `Diwali`
- `Diwali -1`
- `Diwali +1`
- `Custom date`

Holiday Travel occurrences are inserted directly from selected dates instead of being generated from recurrence rules.

### Optional Dedicated Table

If the selected-date metadata grows, add this table later:

```sql
CREATE TABLE holiday_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  travel_date TEXT NOT NULL,
  holiday_name TEXT,
  offset_days INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES trip_events(id) ON DELETE CASCADE,
  UNIQUE(event_id, travel_date)
);
```

For MVP, storing selected dates as `trip_occurrences` is simpler.

## Holiday Data Source

Use a local static India holiday list for the MVP. The static fixture is generated from Calendarific holiday responses for 2026 through 2030, but the app should not call Calendarific directly from the mobile client because a bundled API key is not confidential.

Static fixture:

```text
src/holidays/indiaHolidays.js
```

The fixture should keep only the fields needed by the Holiday Travel picker:

```js
{
  date: 'YYYY-MM-DD',
  name: 'Holiday name'
}
```

For MVP, include Calendarific entries where `primary_type` is:

- `Gazetted Holiday`
- `Restricted Holiday`

Do not include long descriptions, URLs, country metadata, observances, seasonal entries, or type metadata in the app bundle. Those fields are not needed for date selection and make the mobile bundle larger.

Later versions can support:

- Region/state filters
- A backend or serverless proxy for refreshing Calendarific data without exposing the API key
- Remote holiday configuration
- User-created holiday templates

## Booking Window Logic

Reuse existing constants:

- `ADVANCE_DAYS`
- `BOOKING_WINDOW_REMINDER_DAYS`

For every selected Holiday Travel date:

```text
booking_open_date = travel_date - ADVANCE_DAYS
reminder_date = booking_open_date - reminder_days
```

The existing `booking_window_reminder_runs` table can prevent duplicate reminders.

## Availability Check Rules

Holiday Travel should use this rule:

```text
If train details are complete:
  allow manual and scheduled seat checks
Else:
  send booking-window reminders only
```

A helper can make this explicit:

```js
function hasCompleteRailDetails(event) {
  return Boolean(
    event.train_no &&
    event.class_code &&
    event.quota &&
    event.source_station &&
    event.destination_station
  );
}
```

Scheduled checks should skip Holiday Travel events without complete rail details.

## Implementation Plan

### Phase 1: Foundation

- Add `trip_type` and `holiday_name` columns to `trip_events`
- Add `source_label` column to `trip_occurrences`
- Add `custom` recurrence support or bypass recurrence generation for holiday trips
- Add holiday date fixture file
- Add utility helpers for surrounding dates and booking-open date labels

### Phase 2: Create/Edit Flow

- Add trip type selector
- Build Holiday Travel date picker section
- Let users select suggested holiday dates and custom dates
- Save selected dates directly as occurrences
- Make train details optional for holiday trips

### Phase 3: Calendar And Reminders

- Display Holiday Travel dates with source labels
- Show booking-open date per selected occurrence
- Reuse booking-window reminder flow for selected dates
- Prompt for train details when the date is inside the booking window

### Phase 4: Availability Integration

- Allow checks only when rail details are complete
- Reuse existing `checkOccurrence` and `checkEvent`
- Add UI messaging for incomplete rail details
- Add tests for skipped scheduled checks

## Edge Cases

- User selects duplicate dates from multiple holidays: store one occurrence per date and preserve the clearest label.
- Holiday falls outside the railway booking window: show booking-open date and reminder status.
- Booking window already opened: show “Booking open now” and prompt for train details.
- User adds train details later: existing selected dates become eligible for availability checks.
- User edits selected dates: preserve booked/ignored dates unless explicitly removed.
- Holiday list is missing a local/state holiday: allow custom dates.

## Testing Notes

Add unit tests for:

- Holiday surrounding date generation
- Duplicate selected-date handling
- Booking-window reminder eligibility without train details
- Scheduled availability skipping when train details are incomplete
- Scheduled availability running when train details are complete
- Editing a holiday trip without deleting booked/ignored occurrences unexpectedly

## Recommended Product Name

Use **Holiday Travel** in the UI.

It is clear, simple, and broad enough for festivals, vacations, long weekends, and custom travel dates.
