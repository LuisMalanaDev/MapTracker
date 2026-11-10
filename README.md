# 🍜 CraveNav — Live Restaurant & Walking Path Tracker

A real-time **Progressive Web App (PWA)** built in `C:\Tracker` that locates your current GPS position, discovers nearby restaurants/cafés/fast food, draws the exact street path to get there, and tracks you in real time as you walk closer to your destination.

---

## 🧱 Tech Stack & Architecture (100% Free, Zero API Key Billing Required)

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Map Engine** | **Leaflet.js 1.9.4 + CARTO / Esri Tiles** | High-speed interactive map with Dark Mode, Clean Street, and Satellite views |
| **Live GPS Tracking** | **HTML5 Geolocation API (`watchPosition`)** | Continuous high-accuracy GPS tracking as you walk |
| **Restaurant Radar** | **OpenStreetMap Overpass API** | Automatically scans real restaurants, cafés, milk tea, and fast-food spots around your live radius |
| **Place Search** | **Photon (Komoot) Geocoding API** | Search any restaurant name or landmark locally or globally |
| **Street Routing** | **OSRM (Open Source Routing Machine)** | Calculates exact street geometry, turn-by-turn directions, distance, and walking/riding ETA |
| **Voice Guide** | **Web Speech API (`speechSynthesis`)** | Speaks turn-by-turn street instructions aloud while you walk |
| **Installable App** | **PWA (`manifest.json` + `sw.js`)** | Installable onto Android & iOS home screens |

---

## 📂 Project Structure (`C:\Tracker`)

```text
C:\Tracker\
├── index.html          # Main App Shell (Responsive Desktop + Mobile Bottom Sheet)
├── css\
│   └── styles.css      # Glassmorphism Dark UI, Glowing GPS Pulse & Custom Pin Styles
├── js\
│   ├── app.js          # Core Controller, Filters, Favorites & Random Roulette
│   ├── map.js          # Leaflet Map Engine, Tile Switcher & Split Walked/Remaining Polyline
│   ├── gps.js          # Real-Time GPS watchPosition + Built-In Street Walk Simulator
│   ├── places.js       # Overpass Restaurant Scanner + Photon Search + Haversine Distance
│   └── router.js       # OSRM Turn-by-Turn Routing, Live Progress % & Voice Synthesis
├── manifest.json       # Progressive Web App Manifest
├── sw.js               # Offline Service Worker
├── launch.bat          # 1-Click Server & Browser Launcher
└── README.md           # Documentation
```

---

## 🚀 Key Features

1. **📍 Live "Getting Closer" Walk Tracker:**
   * Shows your remaining distance (`e.g. 420 m -> 380 m -> 310 m`), estimated minutes left, and a live **0% → 100% Progress Bar**.
   * Splits the route line on the map into **Walked Path (dashed)** and **Remaining Path (glowing emerald green)**.
   * Pops up an **Arrival Celebration** when you get within 25 meters of the restaurant!
2. **🚶 Built-in "Simulate Walk" Mode:**
   * Want to test how it behaves while sitting at your desk? Click **🚶 Simulate Walk** in the navigation HUD to watch your GPS marker walk along the streets turn-by-turn in real time!
3. **🎲 "Can't Decide?" Random Restaurant Roulette:**
   * Click the **🎲 dice button** next to the search bar to randomly pick a nearby food spot and immediately route to it.
4. **🖱️ Right-Click Teleport (Desktop Testing):**
   * Right-click anywhere on the map to move your starting location to any street or city and immediately scan restaurants there.
