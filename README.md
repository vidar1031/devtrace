# DevTrace v3.0.5

DevTrace is a Chrome extension for developers who need to inspect page requests, debug APIs and resource loading, and export selected assets with preserved directory structure.

## What It Does

- Captures network requests for a target domain, subdomains, all domains, or a whitelist.
- Restores capture sessions across popup reopen and service worker restart.
- Filters requests by domain, status, and type.
- Exports selected resource URLs as JSON for debugging and trace review.
- Exports downloadable assets into structured folders based on domain and path.
- Persists download status so completed resources stay marked after page refresh or popup reopen.
- Includes a built-in help page opened from the popup title area.

## Core Workflow

1. Open the extension popup.
2. Enter a URL and click `Start`.
3. The extension resets the previous active session, requests the required host permission, and reloads the current browser tab with the target URL.
4. Browse the page while DevTrace captures requests in real time.
5. Filter, inspect, export URLs, or export resources.

## Export Behavior

- `Export JSON` saves the selected downloadable resource URLs as a JSON array.
- `Export Resources` first asks for a destination folder, then writes files into that folder using `domain/path/file` layout whenever the browser allows it.
- If direct folder writes are blocked by browser or site restrictions, DevTrace falls back to the Chrome Downloads API.
- During batch export, previously completed downloads are skipped and newly arriving resources can still be picked up until the queue settles.

## Permissions

- `tabs`, `activeTab`: navigate and inspect the active browser tab.
- `webRequest`, `webNavigation`: capture request and response activity.
- `storage`: persist sessions, settings, and download status.
- `downloads`: export resources and JSON files.
- optional host permissions: requested at runtime for the chosen capture scope.

## Current Product Status

This repository represents the `v3.0.5` shareable release line.

- Product usability: good for developer-focused workflows.
- Architecture: still lightweight and intentionally simple.
- Project site: [docs/index.html](/Users/zhanghongqin/work/devtrace-v2.4/docs/index.html)
- Privacy page: [docs/privacy.html](/Users/zhanghongqin/work/devtrace-v2.4/docs/privacy.html)
- Support page: [docs/support.html](/Users/zhanghongqin/work/devtrace-v2.4/docs/support.html)

## Limitations

- DevTrace captures requests after capture starts; it cannot retroactively recover requests that completed before the listener was active.
- Some resource downloads are limited by browser security, CORS, or origin policy.
- The UI is optimized for desktop Chrome extension usage, not mobile browsers.
- Product positioning should remain developer-facing: network inspection, API debugging, and resource analysis.

## Local Validation

- `python3 -m json.tool manifest.json`
- `node --check popup.js`
- `node --check background.js`

## Versioning

- Current version: `3.0.5`
- Patch updates increment by `0.0.1`
