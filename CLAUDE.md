# ClipForge Desktop Downloader Handoff

This project is an Electron + React + TypeScript desktop app that wraps local downloader tools. The current app name shown in the UI is ClipForge. It is intended to stay modular so the desktop shell could later move from Electron to Tauri.

## Current Stack

- Electron main process in `src/main`
- Electron preload bridge in `src/preload`
- React renderer in `src/renderer`
- Shared TypeScript types in `src/shared/media.ts`
- External tools:
  - `yt-dlp` for YouTube/video/audio/source captions
  - `ffmpeg` and `ffprobe` for merging/conversion
  - `gallery-dl` for Instagram/Facebook/Pinterest gallery/image support
  - `instaloader` is optional and only a future Instagram fallback
  - `whisper.cpp` support exists conceptually as a fallback transcript path, but current YouTube markdown transcript work prefers source captions

## Main User Flows Already Built

### YouTube

- Paste URL, auto-analyze.
- Supports videos, Shorts, and playlists.
- Shows title, thumbnail/opening frame, uploader, duration, formats, captions.
- Output choices include MP4, MP3, WAV, M4A, WEBM, subtitles/captions, markdown transcript, timed transcript.
- YouTube/source captions are preferred for transcripts.
- Markdown transcript format should be one sentence per line with a blank line between sentences.
- Whisper fallback was discussed, but for YouTube the current desired behavior is source captions first.

### Instagram

- Instagram is currently video-first.
- Reels/video URLs should use the same yt-dlp-backed output workflow as YouTube.
- The Instagram section should show the standard video preview and format controls: MP4, MP3, WAV, M4A, WEBM, subtitles, timed transcript, and markdown transcript.
- For now, do not focus on photo posts or carousel/gallery selection in the Instagram UI.
- Photo/carousel-only Instagram posts should be rejected with a clear message rather than shown in a media grid.

### TikTok

- TikTok is a first-class video tab next to Instagram.
- TikTok should use the same yt-dlp-backed video workflow as YouTube and Instagram.
- The TikTok section should show preview metadata, opening-frame thumbnail support, MP4, MP3, WAV, M4A, WEBM, subtitles, timed transcript, markdown transcript, quality selection, save folder, progress, and cancel controls.

### Facebook/Pinterest/General URL

- URL router detects platform and switches tabs.
- Facebook video URLs should use the same shared yt-dlp video workflow as YouTube, Instagram, and TikTok.
- Do not duplicate per-platform video command builders for Facebook unless Facebook needs a truly different extractor workaround.
- Generic gallery analysis uses gallery-dl JSON where possible.
- Facebook/Pinterest have gallery grids with selectable media items.
- Pinterest has the most custom logic because board previews and downloads were unreliable with naive gallery-dl ranges.

## Preferred Video Architecture

Use one shared video-download pipeline for YouTube, Instagram, TikTok, Facebook video, and General URL video:

- Analyze with yt-dlp JSON.
- Normalize the result into the same renderer state and controls.
- Build download commands from one output recipe table keyed by output type.
- Keep platform-specific behavior as small strategy flags, such as cookie strategy, playlist support, thumbnail extraction, or fallback analyzer.

Avoid copying the YouTube section into each platform. It creates drift: Facebook can end up with different output mappings, stale progress parsing, duplicate temp files, or different transcript behavior.

Current output recipe decision:

- MP4 uses `-f bv*+ba/b --merge-output-format mp4`.
- MP3/WAV/M4A use yt-dlp audio extraction.
- WEBM uses `--recode-video webm` instead of only `--merge-output-format webm`, because sites like Facebook may provide MP4 video plus M4A audio streams that cannot be directly muxed into a valid WEBM container.
- Captions, timed transcript, and markdown transcript should continue to use the shared caption/whisper path.

## Important Pinterest Decisions

The user has a working terminal command for Pinterest:

```sh
python -m gallery_dl \
  --cookies-from-browser brave/.pinterest.com \
  --download-archive "$HOME/Downloads/Pinterest/paprika-archive.txt" \
  --sleep-429 300 \
  -d "$HOME/Downloads/Pinterest/paprika" \
  "https://www.pinterest.com/OperationAlgernon/paprika/"
```

The app should mirror this structure for Pinterest downloads:

- Use `python -m gallery_dl` style args.
- Use `--cookies-from-browser brave/.pinterest.com`.
- Use `--sleep-429 300`.
- Use a hidden internal archive under Electron `app.getPath("userData")`, not a user-selected archive file.
- The user only chooses the visible output folder used by `-d`.
- Do not show a cookies.txt workflow for Pinterest.
- Pinterest should use Brave cookies via macOS Keychain/browser-cookie extraction.

Because this Mac has no global `python` executable and `python3` does not have `gallery_dl`, the app currently auto-detects Homebrew gallery-dl's bundled Python by reading the shebang from `/opt/homebrew/bin/gallery-dl`, then runs that Python with `-m gallery_dl`.

## Current Pinterest Architecture

Key files:

- `src/main/downloaders/pinterestAdapter.ts`
  - Builds Pinterest analysis/download args.
  - Normalizes Pinterest URLs.
  - Parses gallery-dl JSON into normalized `MediaItem`s.
  - Assigns `originalGalleryDlIndex` so selected downloads can map back to gallery-dl order.
  - Builds full-board command args with hidden board-specific archive.
  - Builds selected `--range` command args.
  - Attempts to unlock Brave Safe Storage via macOS `security` before running gallery-dl.

- `src/main/downloaders/downloadSelectedPinterestItems.ts`
  - Uses manifest items and `originalGalleryDlIndex` to build gallery-dl `--range`.
  - No longer uses custom direct media fetch as the primary Pinterest path.
  - Logs selected command/failure output.

- `src/main/utils/mediaManifest.ts`
  - Stores Pinterest manifests under app userData.
  - Builds internal archive paths like:
    `~/Library/Application Support/clipforge-desktop/archives/pinterest/operationalgernon-paprika-archive.txt`

- `src/main/downloadManager.ts`
  - Runs Pinterest downloads through a single Pinterest queue.
  - Forces one Pinterest job at a time.
  - Handles rate-limit pause state.
  - Logs Pinterest command/failure output to the Pinterest debug log.

- `src/main/downloaders/pinterestRateLimiter.ts`
  - Tracks 429/rate limit state and queue pause/resume.

- `src/main/utils/pinterestDebug.ts`
  - Writes logs to `~/Library/Logs/clipforge-desktop/pinterest-debug.log`.

## Current Known Problem

The user can analyze the board and sees 49 displayed items for:

`https://www.pinterest.com/OperationAlgernon/paprika/`

But downloads still fail with the friendly error:

`This link looks private or requires login/cookies. Import a cookies.txt file or use browser cookies for content you are permitted to save.`

The UI now hides cookies.txt for Pinterest and says Brave Pinterest cookies via macOS Keychain. The user reports there is no Keychain prompt. The debug log shows:

- Keychain preflight succeeds with `service:"Brave Safe Storage"` or `service:"cached"`.
- The actual gallery-dl command is shaped correctly:
  `/opt/homebrew/Cellar/gallery-dl/1.32.0/libexec/bin/python -m gallery_dl --cookies-from-browser brave/.pinterest.com --download-archive ... --sleep-429 300 -d ... https://www.pinterest.com/OperationAlgernon/paprika/`

Next debugging step:

- Use the new debug logging from `download:full:failed` and `download:selected:failed-process` to inspect the real gallery-dl output tail after a failed app download.
- Compare it against the terminal command that succeeds.
- If needed, run the exact equivalent command printed in the debug log from the same environment and compare stdout/stderr.

## Recent Important Change

When all visible Pinterest items are selected, the app now treats "Download selected" as a full-board download instead of a large `--range` selected download. This matches the user’s current goal: download everything on the board.

## UX Requirements To Preserve

- Pinterest should not ask the user to choose cookies.txt.
- Pinterest should not expose the hidden archive file as something to pick.
- The user can reset the archive for the current board.
- The user can choose the visible output folder.
- The app should stay responsive while downloads run.
- Subprocess calls must use argument arrays and `shell: false`.
- Do not collect social media passwords in the app.
- Only support downloading content the user owns, has rights to, or is permitted to save.

## Verification Commands

Run these after changes:

```sh
npm run typecheck
npm test
npm run build
```

To launch during development:

```sh
npm run electron:dev
```

## Coding Guidelines

- Keep changes scoped.
- Use existing patterns in `src/main/downloaders`.
- Do not reintroduce direct media fetching as the primary Pinterest download path unless it is clearly a fallback.
- Preserve YouTube behavior while changing Pinterest.
- Use safe subprocess calls with arrays and `shell: false`.
- Add/maintain debug logging for Pinterest command args and failure output, but never log cookie contents.
