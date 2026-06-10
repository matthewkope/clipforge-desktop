# ClipForge Browser Extension

This Manifest V3 extension works with Chromium browsers including Chrome,
Brave, and Microsoft Edge. ClipForge Desktop must be running.

## Install for development

1. Open ClipForge and choose a default download folder.
2. Keep ClipForge running.
3. Open `chrome://extensions` in Chrome or Brave.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Choose this repository's `extension` folder.
7. Pin ClipForge to the browser toolbar.

## Use

1. Click the blue/teal ClipForge toolbar icon.
2. Choose the Video (MP4), Audio (MP3), or Transcript (Markdown) symbol.
3. Alternatively, check **Use preset** and select a preset saved in ClipForge.
4. Clicking a format symbol turns **Use preset** off and uses that symbol instead.
5. Click **Current tab** to send the active page URL.
6. Click **Paste URL** to read the first HTTP or HTTPS URL from the clipboard.

The extension sends requests only to ClipForge's local bridge at
`http://127.0.0.1:38473`. The desktop app performs URL analysis and downloading.
The bridge does not listen on the network.
