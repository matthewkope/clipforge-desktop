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

## YouTube Clips

On YouTube watch pages and Shorts, a white scissor button appears in the
player controls next to the settings gear.

1. Click the scissor to open the clip panel.
2. Drag the two markers on YouTube's progress bar to set the range. The
   screen dims and a frame preview follows the marker while you drag; the
   video pauses and steps through frames so you can land on the exact cut.
3. Or type times (`1:23`, `1:02:03.5`) in the Start/End fields, or click
   **Set** to grab the current playhead position.
4. **Preview** plays just the selected range in the player.
5. Choose a saved preset (or direct MP4/MP3/GIF) and click **Send to ClipForge**.

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

On Twitch, Vimeo, and Reddit a small floating scissor button appears over the
main video; clicking it opens the same clip panel (without progress-bar
markers or transcript search). The current page URL is sent to the desktop
app, which handles those sites via yt-dlp.

You can also right-click any link, video, or page and choose
**Download with ClipForge** to send its URL as an MP4 download; a browser
notification reports the result.

The desktop app downloads only the selected section using yt-dlp
`--download-sections` with keyframe-accurate cuts, saved with a
`[clip start-end]` filename suffix.

The extension sends requests only to ClipForge's local bridge at
`http://127.0.0.1:38473` (via its background service worker). The desktop app
performs URL analysis and downloading. The bridge does not listen on the
network.
