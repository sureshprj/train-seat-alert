# Indian Rail Trip Planner Mobile

Standalone React Native + Expo mobile version of the Trip Event Planner.

The app stores all data locally on the phone with `expo-sqlite`. It calls Indian Rail directly from the device, persists session cookies locally, asks for captcha only when the rail session is inactive, runs scheduled background checks through Expo background fetch, and raises native notifications for low availability, RAC, WL/RLWL, and captcha-required automation pauses.

## Local Development With Expo Go

1. Install dependencies:

   ```sh
   cd mobile_app
   npm install
   ```

2. Start Expo on your local network:

   ```sh
   npm start
   ```

3. Open Expo Go on a real phone and scan the QR code.

Your phone and computer must be on the same Wi-Fi network. The mobile app does not use the local Express server.

## Current Feature Set

- Create, edit, delete, and select trip events
- Train number input, class, quota, source station, destination station, threshold, active status
- User-selectable check times and max triggers per day
- 60-day occurrence generation for the selected weekday
- Check one occurrence or all pending occurrences for an event
- Captcha modal only when the direct rail session is inactive or rejected
- Display availability, last checked time, pending/booked/ignored state
- Highlight below-threshold confirmed seats, RAC, WL, and RLWL
- Mark booked or ignored; ignored occurrences clear their notifications
- Local notifications list with mark-read and clear-all
- Background fetch registration for scheduled checks

## Notes

Expo Go background execution is controlled by iOS/Android power rules, so scheduled checks may not fire exactly at the selected minute during local development. Manual `Check` remains the reliable validation path in Expo Go.

If Expo reports package version mismatches, run:

```sh
npx expo install --fix
```
