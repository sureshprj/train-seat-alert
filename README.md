# Train Seat Alert Mobile

Standalone React Native + Expo mobile app for train seat alerts and booking-window reminders.

The app stores all data locally on the phone with `expo-sqlite`. It calls Indian Rail directly from the device, persists session cookies locally, asks for captcha only when the rail session is inactive, runs scheduled background checks through Expo background fetch, and raises native notifications for low availability, RAC, WL/RLWL, and captcha-required automation pauses.

## Local Development With A Custom Expo Dev Client

1. Install dependencies:

   ```sh
   cd mobile_app
   npm install
   ```

2. Build and install a development client once for your device or emulator:

   ```sh
   npx expo run:android
   ```

   For iOS, use an EAS development build or `npx expo run:ios` on a configured Mac.

3. Start Expo on your local network:

   ```sh
   npm start
   ```

4. Open the installed development build and connect to the Metro server.

Your phone and computer must be on the same Wi-Fi network. This app uses `expo-dev-client` and `react-native-google-mobile-ads`, so Expo Go is not the reliable target. The mobile app does not use the local Express server.

## Current Feature Set

- Create, edit, delete, and select trips
- Train number input, class, quota, source station, destination station, seat alert limit, active status
- User-selectable check times
- 60-day occurrence generation for the selected weekday
- Check one travel date or all pending travel dates for a trip
- Captcha modal only when the direct rail session is inactive or rejected
- Display availability, last checked time, pending/booked/ignored state
- Highlight seat alert limit matches, RAC, WL, and RLWL
- Mark booked or ignored; ignored occurrences clear their notifications
- Local notifications list with mark-read and clear-all
- Background fetch registration for scheduled checks

## Notes

Background execution is controlled by iOS/Android power rules, so scheduled checks may not fire exactly at the selected minute during local development. Manual `Check` remains the reliable validation path while developing.

## Play Store Release Prep

The Android app includes an in-app About screen with the unofficial-app disclaimer, data summary, AdMob notice, privacy-policy link, and support contact.

Before submitting to production, replace the placeholder privacy URL and support email in `src/screens/AboutScreen.js`, publish `docs/privacy-policy.md` at that URL, and complete the Play Console checklist in `docs/play-store-readiness.md`.

Build an Android APK for phone testing with:

```sh
npm run build:android:preview
```

Preview APKs use AdMob test ads. Production builds use the configured production AdMob unit.

To check real AdMob fill in an APK, build the explicit real-ad preview profile:

```sh
npm run build:android:preview-real-ads
```

Do not click real ads while testing.

Build a production Android App Bundle for Play Console with:

```sh
npm run build:android:production
```

Run unit tests with:

```sh
npm test
```

If Expo reports package version mismatches, run:

```sh
npx expo install --fix
```
