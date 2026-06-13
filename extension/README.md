# ClipForge Browser Extension

This Manifest V3 extension works with Chromium browsers including Chrome,
Brave, and Microsoft Edge. ClipForge Desktop must be running.

## How it connects

The extension talks to the desktop app over **Chrome Native Messaging**, not a
local web server. The browser launches a tiny host process
(`native-host/clipforge-host.mjs`) that relays each request to the app's
Unix-domain socket (`~/Library/Application Support/clipforge-desktop/clipforge.sock`).
There is no listening network port at all.

## Install for development

1. Open ClipForge and choose a default download folder; keep it running.
2. Register the native messaging host (one time, and again if you move the repo):
   ```sh
   npm run install:extension-host
   ```
   This writes a launcher plus a `com.clipforge.host.json` manifest into the
   `NativeMessagingHosts` folder of each installed Chromium browser, whitelisting
   the extension's pinned ID.
3. Open `chrome://extensions` (or `brave://extensions`) and enable **Developer mode**.
4. **Load unpacked** → choose this repository's `extension` folder.
5. The extension has a pinned `key`, so its ID is always
   `peadlpdlblilnhopcbbngocoggegjfof` — it must match the manifest written in
   step 2. If you reload after a code change, no re-install is needed.
6. Pin ClipForge to the browser toolbar.

> The host launches the system `node` baked into the launcher at install time.
> If you change which `node` you use, re-run `npm run install:extension-host`.

## Use

1. Click the blue/teal ClipForge toolbar icon.
2. Choose the Video (MP4), Audio (MP3), or Transcript (Markdown) symbol.
3. Alternatively, check **Use preset** and select a preset saved in ClipForge.
4. Clicking a format symbol turns **Use preset** off and uses that symbol instead.
5. Click **Current tab** to send the active page URL.
6. Click **Paste URL** to read the first HTTP or HTTPS URL from the clipboard.

## YouTube Clips

On YouTube watch pages and Shorts, a white scissor button appears in the
player controls next to the settings gear.

1. Click the scissor to open the clip panel.
2. Drag the two markers on YouTube's progress bar to set the range. The
   screen dims and a frame preview follows the marker while you drag; the
   video pauses and steps through frames so you can land on the exact cut. An
   audio waveform fills in under the scrubber as the video plays, so you can
   see speech vs. silence.
3. Or type times (`1:23`, `1:02:03.5`) in the Start/End fields, or click
   **Set** to grab the current playhead position.
4. Or **search the transcript** for a phrase and click a result to jump the
   clip start/end to where it's spoken.
5. **Preview** plays just the selected range in the player.
6. Optionally enable **9:16 crop** and **Burn captions** — turning on captions
   reveals a **Karaoke captions** toggle that burns in word-by-word highlighted
   captions instead of static blocks.
7. Choose a saved preset (or direct MP4/MP3/GIF) and click **Send to ClipForge**.

While the panel is open these keyboard shortcuts work (outside text fields):

- `[` / `]` — set the clip start/end to the current playhead
- `←` / `→` — slide the whole selection by 1s (0.1s with Shift), seeking to the new start
- `Enter` — Send to ClipForge
- `Esc` — close the panel

The **Reels/TikTok**, **Shorts**, and **X** buttons apply per-platform export
defaults (9:16 crop + burned captions for Reels/Shorts, original aspect for X)
and warn or clamp when the selection exceeds the platform's length limit
(90s Reels, 60s Shorts, 140s X).

## Other Sites

On Twitch a scissor button appears in the player control bar (next to the
settings gear). On Vimeo and Reddit a small floating scissor button appears
over the main video. Either opens the same clip panel (without progress-bar
markers or transcript search). The current page URL is sent to the desktop
app, which handles those sites via yt-dlp.

You can also right-click any link, video, or page and choose
**Download with ClipForge** to send its URL as an MP4 download; a browser
notification reports the result.

The desktop app downloads only the selected section using yt-dlp
`--download-sections` with keyframe-accurate cuts, saved with a
`[clip start-end]` filename suffix.

The extension never opens a network connection. Its background service worker
calls `chrome.runtime.sendNativeMessage`, the browser spawns the native host,
and the host relays to the app's local Unix socket (owner-only, `0600`). The
desktop app performs URL analysis and downloading.
