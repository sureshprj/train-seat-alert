# Play Store Readiness

## Implemented In This Repo

- Android package: `com.sureshkumarkgm.trainseatalert`
- Android `versionCode`: `1`
- Production build profile outputs an Android App Bundle through EAS.
- In-app About screen includes an independent-app disclaimer, privacy summary, AdMob notice, privacy-policy link, and support contact.
- Privacy policy draft exists at `docs/privacy-policy.md`.

## Before Public Production

1. Enable GitHub Pages for this repository using the `docs` folder, or host the privacy policy on another public HTTPS page.
2. Confirm `https://sureshprj.github.io/train-seat-alert/privacy-policy.html` opens publicly before Play Console submission.
3. Complete Google Play Data Safety using the real production behavior.
4. Complete Play Console app access, ads, content rating, target audience, and government apps declarations.
5. Confirm AdMob app and ad unit are approved, and configure app-ads.txt if required for the publisher account.
6. Build and test an Android APK on a real phone:

   ```sh
   npm run build:android:preview
   ```

7. Build a production Android App Bundle for Play Console:

   ```sh
   npm run build:android:production
   ```

8. Run closed testing if the Play developer account requires it.

## Data Safety Draft Notes

Likely disclosures to review in Play Console:

- App activity / app interactions may be collected by Google AdMob for ads, analytics, fraud prevention, and diagnostics.
- Device or other IDs may be collected by Google AdMob for advertising, analytics, fraud prevention, and diagnostics.
- Approximate location may be inferred/processed by advertising services depending on Google SDK behavior and user settings.
- User-entered trip/search data is sent to Indian Rail services to provide seat availability checks.
- Locally stored trip details and notification history are not sent to a developer-operated backend.

Treat these as drafting notes, not legal advice. The final Data Safety form must match the exact production build and third-party SDK behavior.
