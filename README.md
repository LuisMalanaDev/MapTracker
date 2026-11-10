# 🍜 CraveNav — Expo (React Native) Live Restaurant & Walking Path Tracker

A native **React Native + Expo** mobile application built in `C:\Tracker` that tracks your real-time hardware GPS (`expo-location`), discovers nearby restaurants/cafés/fast food, draws the exact street path to get there, and guides you step-by-step as you walk closer to your destination.

---

## 🧱 Tech Stack (Expo / React Native)

| Layer | Package | Purpose |
| :--- | :--- | :--- |
| **Framework** | **React Native + Expo** | Cross-platform native Android & iOS mobile app |
| **Live Hardware GPS** | **`expo-location` (`watchPositionAsync`)** | `BestForNavigation` real-time GPS tracking every 1 meter |
| **Voice Navigation** | **`expo-speech`** | Native text-to-speech turn-by-turn street announcements |
| **Screen Wake Lock** | **`expo-keep-awake`** | Keeps phone screen awake while walking |
| **Map Engine** | **`react-native-webview` + Leaflet + Google Tiles** | Direct Google Maps Street, Dark Mode & Satellite views (Zero Google Cloud billing key required; never crashes in APK!) |
| **Favorites Storage** | **`@react-native-async-storage/async-storage`** | Persistent saved favorite food spots on device |
| **APK Builder** | **EAS Build (`eas.json`)** | Pre-configured with `"buildType": "apk"` |

---

## 📂 Project Structure (`C:\Tracker`)

```text
C:\Tracker\
├── App.js                           # Main React Native UI, GPS Watcher & Navigation HUD
├── index.js                         # Expo Root Entry
├── app.json                         # Expo Config & Android GPS Permissions
├── eas.json                         # EAS Build Config (Pre-set to output .apk)
├── package.json                     # Dependencies & Scripts
└── src\
    ├── components\
    │   └── MapCanvas.js             # Interactive Map Bridge (Google Street / Dark / Satellite)
    └── services\
        ├── placesService.js         # Overpass Restaurant Radar + Photon Search + Haversine
        └── routeService.js          # OSRM Street Routing, Turn-by-Turn & Live Progress %
```

---

## 🚀 How to Run in Expo Go & Build the `.apk`

### 1. Test Live on Your Phone with Expo Go
```bash
cd C:\Tracker
npm install
npx expo start
```
Scan the QR code in the terminal using the **Expo Go** app on your phone!

### 2. Build a Standalone Downloadable Android `.apk`
`eas.json` is already configured with `"buildType": "apk"` under the `preview` profile:
```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```
When the build finishes, EAS gives you a direct download link + QR code to install the `.apk` on your phone!
