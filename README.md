# Route Optimizer PWA

A Progressive Web App that optimizes multi-stop driving routes for the fastest/shortest path. Works on iPhone Safari and can be added to your home screen.

## Quick Start

### 1. Get a Google Maps API Key (Free)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable these APIs:
   - **Directions API**
   - **Maps JavaScript API**
   - **Places API**
4. Go to "Credentials" → "Create Credentials" → "API Key"
5. Copy your API key

> Google gives you $200/month free credit — enough for ~40,000 route optimizations.

### 2. Host the App (Free)

**Option A: GitHub Pages (Recommended)**

1. Create a new GitHub repository
2. Push this folder to it
3. Go to Settings → Pages → Source: Deploy from branch → Main
4. Your app will be live at `https://yourusername.github.io/route-optimizer/`

**Option B: Netlify (Drag & Drop)**

1. Go to [netlify.com](https://www.netlify.com/)
2. Drag this entire folder onto the deploy area
3. Done — you get a URL immediately

**Option C: Local Testing**

```bash
# If you have Python installed:
python -m http.server 8000

# Or Node.js:
npx serve .
```

Then open `http://localhost:8000` in your browser.

### 3. Add to iPhone Home Screen

1. Open your hosted app URL in Safari
2. Tap the Share button (square with arrow)
3. Scroll down and tap "Add to Home Screen"
4. Tap "Add"

Now it looks and feels like a native app!

## How It Works

1. **Enter your starting location** (or tap the GPS button)
2. **Add your destination stops** (minimum 2)
3. **Tap "Optimize Route"** — the app calls Google's Directions API with `optimizeWaypoints: true`, which reorders your stops for the fastest route
4. **View the optimized order** with total time and distance
5. **Tap "Open in Google Maps"** for turn-by-turn navigation

## Features

- 📍 GPS location detection
- 🔍 Address autocomplete (powered by Google Places)
- 🗺️ Interactive map showing optimized route
- ⚡ Waypoint optimization (up to 25 stops)
- 📱 Installable as home screen app (PWA)
- 🔒 API key stored locally on your device

## Limitations

- Maximum 25 waypoints (Google API limit)
- Requires internet connection for route calculation
- Turn-by-turn navigation handled by Google Maps app (not built-in)

## Files

```
route-optimizer/
├── index.html          # Main HTML
├── styles.css          # Styling
├── app.js              # Application logic
├── manifest.json       # PWA manifest
├── sw.js               # Service worker for offline caching
├── icon-192.svg        # App icon
├── generate-icons.html # Helper to generate PNG icons
└── README.md           # This file
```

## API Key Security Note

Your API key is stored in your browser's localStorage. For production use, you should:
1. Restrict the key to your domain in Google Cloud Console
2. Enable only the APIs you need (Directions, Maps JS, Places)
