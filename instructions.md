Create Mobile Version of Trip Event Planner (React Native + Expo)

Build a complete mobile version of the existing Trip Event Planner application using React Native and Expo.

The mobile application must provide all functionality available in the web version while delivering a mobile-first user experience with local storage, background monitoring, and native mobile notifications.

Technology Stack
Mobile Framework
React Native
Expo SDK (latest stable version)
Local Storage
expo-sqlite
Background Processing
expo-background-fetch
expo-task-manager
Notifications
expo-notifications
Networking
axios
Session Management
axios-cookiejar-support (if compatible)
otherwise implement custom cookie persistence using AsyncStorage
Captcha
Display captcha image using React Native Image component
Input captcha through modal dialog
Navigation
React Navigation
State Management
React Context or Zustand
Date Handling
dayjs
Architecture
React Native App
        ↓
Local SQLite Database
        ↓
Trip Events
        ↓
Trip Occurrences
        ↓
Background Availability Checks
        ↓
Local Notifications

All application data must remain on the device.

No backend server required.

No cloud dependency required.


Features list take from the main app