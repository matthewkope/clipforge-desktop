# ClipForge Desktop

ClipForge is an Electron + React + TypeScript desktop wrapper around `yt-dlp`.

## Features

- Paste a media URL and analyze it with `yt-dlp -J --no-playlist`.
- Paste a media URL and the app analyzes it automatically after a short pause.
- Paste a playlist URL and the app analyzes it as a playlist.
- Playlist previews use the first video's thumbnail when available.
- Preview title, thumbnail, uploader, duration, source, formats, and captions.
- Download several outputs from the same video or playlist in one run, such as MP4 plus SRT captions.
- Create a Markdown transcript from existing captions with one sentence per line and a blank line between sentences.
- Create a timed `.srt` transcript with timestamps.
- Choose a save folder with the native desktop picker.
- Track download progress, speed, ETA, status, and final output location.
- Cancel active downloads.
- Check for `yt-dlp`, `ffmpeg`, and `ffprobe` on startup.
- Automatic no-login YouTube compatibility retries for sign-in or bot-confirmation prompts.

## Commands

```bash
npm install
npm run electron:dev
npm run typecheck
npm run build
```

## Required System Tools

The app calls these tools as subprocesses using `child_process.spawn` with argument arrays:

- `yt-dlp`
- `ffmpeg`
- `ffprobe`

They can be installed on the system during development or bundled later for distribution.

## YouTube Sign-In / Bot Checks

The app does not use browser cookies or macOS keychain access in the normal flow. For YouTube and YouTube Shorts, Analyze first tries standard yt-dlp, then automatically retries with no-login YouTube extractor compatibility modes. Downloads reuse the strategy that worked during analysis.

Some YouTube blocks are account, age, region, or network dependent. Those may still fail without cookies, but the app should not hang or ask for a keychain password.

## Command Mapping

- Analyze: `yt-dlp -J --no-playlist "URL"`
- MP4: `yt-dlp -f "bv*+ba/b" --merge-output-format mp4 -o "OUTPUT_PATH/%(title)s.%(ext)s" "URL"`
- MP3: `yt-dlp -x --audio-format mp3 -o "OUTPUT_PATH/%(title)s.%(ext)s" "URL"`
- WAV: `yt-dlp -x --audio-format wav -o "OUTPUT_PATH/%(title)s.%(ext)s" "URL"`
- M4A: `yt-dlp -x --audio-format m4a -o "OUTPUT_PATH/%(title)s.%(ext)s" "URL"`
- WEBM: `yt-dlp -f "bv*+ba/b" --merge-output-format webm -o "OUTPUT_PATH/%(title)s.%(ext)s" "URL"`
- English subtitles: `yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs "en.*" --sub-format srt -o "OUTPUT_PATH/%(title)s.%(ext)s" "URL"`
- Timed transcript: uses source captions when available; otherwise uses whisper.cpp for non-YouTube single videos and outputs `.srt` with timestamps.
- Markdown transcript: uses source captions when available; otherwise uses whisper.cpp for non-YouTube single videos. It converts each video to its own `.md` named like `Title.en.md`, with no timestamps. Lines end with punctuation and are separated by a blank line. Temporary caption files are removed unless the user selected SRT captions or Timed Transcript separately.
- List subtitles: `yt-dlp --list-subs "URL"`

Quality choices use the same best-video-plus-audio pattern by default. When a specific height is selected, the app constrains the video selector to that height or lower.

Playlist-only URLs are analyzed with `yt-dlp -J --flat-playlist`. Downloads use `--yes-playlist` and include `%(playlist_index)03d` in the output filename. Single-video URLs use `--no-playlist` so a video link with a playlist parameter does not accidentally download the whole playlist.

## Transcription Roadmap

Existing subtitles/captions are not true transcription. The app prefers source captions, especially for YouTube. When captions are unavailable on platforms like Instagram, whisper.cpp can generate transcript files if `whisper-cli` is installed and a ggml `.bin` model is selected.

The app auto-detects Homebrew whisper.cpp installs in common locations, including `/opt/homebrew/Cellar/whisper-cpp/*/bin/whisper-cli`. You can override the executable with `WHISPER_CPP_BIN` and the model with `WHISPER_CPP_MODEL`.

Future improvements: let users choose model size/language presets, add TXT/VTT exports, and show the transcript inside the app.
