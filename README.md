# WatchSync

A tiny, installable web app (PWA) that talks to Bluetooth smartwatches using Web Bluetooth.
No build step, no dependencies: static files only.

## What works now
- Connect to any BLE watch, list its services and characteristics
- Standard features, if the watch exposes them: battery level, heart rate, current time sync, device info
- **Watch profiles** (`profiles/*.json`) describe a watch family's custom services and commands
- Raw hex writer, notification listener, log export, and **Save profile draft** to capture a new watch
- Auto-reconnect and an offline-capable shell

## Limits
- Chrome or Edge on Android or desktop only (no iPhone/Safari). HTTPS or localhost required.
- Syncs only while the page is open; browsers can't keep Bluetooth alive in the background.
- Services are only visible if their UUIDs are requested before connecting, so each watch family needs a profile.
- No firmware updates (proprietary and risky).

## Run locally
```
python3 -m http.server 8000
```
Open http://localhost:8000 in Chrome (localhost counts as secure).

## Deploy on GitHub Pages
1. Push these files to the root of the `main` branch.
2. Repo Settings, then Pages, then Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Open `https://<your-username>.github.io/<repo>/` in Chrome and choose *Install app*.

## Supporting a new watch
See `profiles/README.md`. In short: connect, press *Save profile draft*, work out the byte formats
(nRF Connect plus the Android Bluetooth HCI snoop log), fill in the profile, and add it to `profiles/index.json`.
