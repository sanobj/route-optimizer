# Route Optimizer PWA

A Progressive Web App that optimizes multi-stop driving routes for the fastest/shortest path. Works on iPhone Safari and can be added to your home screen like a native app. Supports 25+ stops with automatic batching.

## Live App

**https://sanobj.github.io/route-optimizer/**

## Features

- 📍 GPS location detection (shows your street address, not coordinates)
- 🔍 Address autocomplete powered by Google Places
- 🗺️ Interactive map with numbered markers (tap a marker to see the address)
- ⚡ Waypoint optimization — reorders stops in place for fastest route
- 📦 Auto-batching for 25+ stops (nearest-neighbor pre-sort, split into multiple routes)
- 📌 Pin stops to lock them in position — only unpinned stops get optimized
- ☰ Drag to reorder stops manually (hold the handle on mobile)
- 🔄 End mode options: No End, Round Trip, or custom End Address
- 📊 Collapsible route breakdown showing distance/time between each stop
- 💾 Save and load routes with overwrite protection
- 🕘 Auto-saved route history (optimizations and clears, expires after 3 days)
- ✕ Clear button to reset all fields (auto-saves to history first)
- 🌙 Dark/Light mode toggle
- 📱 Installable as home screen app (PWA)
- 🔒 API key stored locally on your device

### Advanced UI (toggle in Settings)

- 🟠 **Business priority** — swipe right on a stop, tap "Bus" to mark. Businesses always route first.
- 🟣 **Residence** — swipe right, tap "Res". Residences route after all businesses.
- 🟡 **Rush** — tap the numbered circle to mark as gold/rush for urgency.
- 🗺️ **Map filter** — All/Bus/Res tabs above the map to view specific types only.
- 🎨 **Color-coded** route lines, map markers, and breakdown labels by type.
- 👆 **Swipe left** on addresses, saved routes, or history cards to delete.

## How It Works

1. **Enter your starting location** (or tap the GPS button for your current address)
2. **Choose an end mode**: No End, Round Trip, or enter an End Address
3. **Add your stops** — type and select from autocomplete suggestions
4. **Pin any stops** you need in a fixed position (📌 button)
5. **Drag stops** to reorder manually (hold the ☰ handle on mobile)
6. **Tag stops** (Advanced UI): swipe right for Bus/Res, tap circle for Rush
7. **Tap "Optimize Route"** — reorders stops for the fastest route, businesses first
8. **Tap the summary bar** to see a breakdown of distance/time between each stop
9. **Tap "Open in Google Maps"** for turn-by-turn navigation (multiple links for 25+ stop routes)
10. **Save the route** for later — saving with the same name overwrites, a new name creates a new save

## Setup

### 1. Google Maps API Key (Free)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable these APIs:
   - **Directions API**
   - **Maps JavaScript API**
   - **Places API**
   - **Geocoding API** (for GPS → street address)
4. Create an API key under Credentials
5. Restrict the key:
   - HTTP referrers: `https://sanobj.github.io/*`
   - API restrictions: select the 4 APIs above

> Google gives $200/month free credit — more than enough for personal use.

### 2. Use the App

1. Open https://sanobj.github.io/route-optimizer/ on your phone
2. Tap ⚙️ and enter your API key (one-time setup)
3. Tap Share → "Add to Home Screen" for app-like experience

## Install as a Phone App

This is a Progressive Web App (PWA), so you can install it to your home screen and use it like a native app — no app store needed.

### iPhone (Safari)

1. Open https://sanobj.github.io/route-optimizer/ in **Safari**
2. Tap the **Share** button (square with arrow at the bottom)
3. Scroll down and tap **"Add to Home Screen"**
4. Name it whatever you want and tap **Add**
5. The app icon will appear on your home screen

### Android (Chrome)

1. Open https://sanobj.github.io/route-optimizer/ in **Chrome**
2. Tap the **three-dot menu** (top right)
3. Tap **"Add to Home screen"** or **"Install app"**
4. Confirm the install

### Notes

- The app works offline for cached pages, but needs internet to calculate routes
- Your API key and saved routes are stored locally on the device
- To update the app after changes are pushed, close it completely and reopen — or delete and re-add to home screen if the cache is stuck

## Hosting (Already Deployed)

The app is deployed on GitHub Pages via the workflow in `.github/workflows/deploy.yml`. Any push to `master` auto-deploys.

To host your own copy:
- Fork the repo
- Enable GitHub Pages in Settings → Pages → GitHub Actions
- Update the API key referrer restriction to your domain

## Limitations

- Google API limits 25 waypoints per request (auto-batched for larger routes)
- Requires internet connection for route calculation
- Turn-by-turn navigation handled by Google Maps app
- Business priority optimization uses nearest-neighbor sorting (may differ slightly from theoretical optimal)

## Files

```
route-optimizer/
├── .github/workflows/deploy.yml  # GitHub Pages deployment
├── index.html                    # Main HTML
├── styles.css                    # Styling
├── app.js                        # Application logic
├── manifest.json                 # PWA manifest
├── sw.js                         # Service worker for caching
├── icon-192.svg                  # App icon
└── README.md                     # This file
```
