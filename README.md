# ClipForge Desktop

ClipForge is an Electron desktop app for downloading video, audio, images,
captions, and transcripts from supported social-media URLs. It uses local
command-line tools; media and transcription stay on your computer.

Only download content you own, have rights to, or are permitted to save.

## Features

- **YouTube** — videos, Shorts, and playlists as MP4, WEBM, MP3, WAV, or M4A,
  with quality selection, subtitles, timed transcripts, and Markdown
  transcripts (source captions first, whisper.cpp fallback).
- **YouTube clips** — the browser extension adds a scissor button to the
  YouTube player. Drag start/end markers directly on the playbar (with a
  dimmed frame-by-frame preview and an audio waveform under the scrubber), or
  search the transcript to jump the clip points to a phrase. Export the
  section with optional **9:16 vertical crop**, **burned-in captions** (static,
  or word-by-word **karaoke** highlighting), or **GIF** — the desktop app
  downloads only that section via yt-dlp `--download-sections`.
- **Twitch, Vimeo & Reddit clips** — the same clip panel works on these sites;
  the desktop app handles them via yt-dlp.
- **Instagram** — reels and videos through the standard video workflow;
  photo posts and carousels analyze into a selectable grid (first photo as
  the cover, photo/video counts shown) and download via gallery-dl.
- **TikTok, X/Twitter** — video downloads with the same format controls.
- **SoundCloud** — tracks, sets, and playlists as MP3, WAV, or M4A audio.
- **Facebook** — videos via yt-dlp; photos and albums via gallery-dl with
  the same selectable grid.
- **Pinterest** — pins, boards, and board sections with rate-limit-aware
  queueing, hidden download archives, and Brave cookie integration.
- **SponsorBlock auto-cut** — optionally remove sponsor, intro, outro, and
  self-promo segments from full downloads using yt-dlp's native SponsorBlock
  integration (toggle in **Settings**, off by default).
- **Downloads queue, history & batch** — paste many URLs at once, run several
  downloads concurrently, and browse a persisted history with cover thumbnails
  and search.
- **Watch folders** — subscribe to a channel, playlist, or profile and have
  new uploads download automatically on a schedule.
- **Browser extension** — send the active tab, a clipboard URL, or a YouTube
  clip selection to the app with one click, using saved format presets. It
  connects over Chrome Native Messaging (no local network port).

## Supported Tools

ClipForge expects these commands to be available on `PATH`:

| Tool | Required | Used for |
| --- | --- | --- |
| Node.js and npm | Development only | Running and building the Electron app |
| `yt-dlp` | Yes | Video analysis and video/audio downloads |
| `gallery-dl` | Yes | Instagram, Facebook, Pinterest, and general galleries |
| `ffmpeg` and `ffprobe` | Yes | Merging, conversion, metadata, and transcription audio |
| `whisper-cli` from whisper.cpp | For transcript fallback | Transcribing media without source captions |
| `instaloader` | Optional | Instagram fallback support |
| Brave Browser | Pinterest default setup | Reading Pinterest cookies through the macOS Keychain |

## macOS Setup

### 1. Install Homebrew

If `brew` is not already installed, follow the instructions at
[brew.sh](https://brew.sh/).

### 2. Install Node.js and media tools

```bash
brew install node ffmpeg yt-dlp whisper-cpp
```

Verify the commands:

```bash
node --version
npm --version
yt-dlp --version
ffmpeg -version
ffprobe -version
whisper-cli --help
```

### 3. Install the Python downloaders

Using `pipx` keeps command-line applications isolated from the system Python:

```bash
brew install pipx
pipx ensurepath
pipx install gallery-dl
pipx install instaloader
```

Open a new Terminal window after `pipx ensurepath`, then verify:

```bash
gallery-dl --version
instaloader --version
```

`instaloader` is optional. ClipForge requires `gallery-dl` for photo posts,
carousels, albums, Pinterest boards, and similar gallery content.

## Instagram and Facebook Photos

Instagram photo posts and carousels, and Facebook photos and albums, are
analyzed with `gallery-dl` into a selectable media grid: the preview card
shows the first photo and how many photos/videos the post contains, and you
can download everything or only the items you check.

Both platforms require a logged-in session for most content. ClipForge
defaults to reading Brave Browser cookies when no cookie source is configured,
so sign in to instagram.com / facebook.com in Brave (or pick another cookie
source / cookies.txt file in **Settings**) before analyzing photo links.

## Transcription Setup

ClipForge first uses captions supplied by the source website. If captions are
unavailable, Timed Transcript and Markdown Transcript use
[whisper.cpp](https://github.com/ggerganov/whisper.cpp) locally.

The app requires a whisper.cpp-compatible GGML model ending in `.bin`. Download
models from the official
[ggerganov/whisper.cpp Hugging Face repository](https://huggingface.co/ggerganov/whisper.cpp).
Do not select the Core ML `.zip` files.

### Recommended models

| Model | Approximate size | Best use |
| --- | ---: | --- |
| [`ggml-base.en.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin?download=true) | 142 MiB | Recommended default for English |
| [`ggml-base.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true) | 142 MiB | Recommended default for multiple languages |
| [`ggml-small.en.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin?download=true) | 466 MiB | More accurate English transcription |
| [`ggml-small.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin?download=true) | 466 MiB | More accurate multilingual transcription |
| [`ggml-base.en-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin?download=true) | 57 MiB | Smaller, faster English model |

`base.en` is the practical default for English media. Use `base` rather than
`base.en` when the audio is not English. Larger models generally improve
accuracy but require more memory and take longer.

After downloading a model:

1. Open **Settings** in ClipForge.
2. Find **Transcripts**.
3. Select **Choose model**.
4. Choose the downloaded `ggml-*.bin` file.

The selected path is saved locally by the app. Alternatively, set:

```bash
export WHISPER_CPP_BIN="$(command -v whisper-cli)"
export WHISPER_CPP_MODEL="$HOME/Downloads/ggml-base.en.bin"
```

ClipForge also checks common Homebrew model folders and `$HOME/Downloads`.

## Pinterest Setup

Pinterest boards and pins use `gallery-dl`. The default ClipForge Pinterest
profile reads Pinterest cookies from Brave Browser on macOS.

1. Install [Brave Browser](https://brave.com/download/).
2. Sign in to Pinterest in Brave.
3. Keep **Use working terminal profile** enabled in ClipForge Settings.
4. Approve the macOS Keychain request for Brave Safe Storage when prompted.

ClipForge does not ask for or store your Pinterest password. Pinterest may rate
limit large boards; the app uses delays, retries, and a single-download queue.

## Run the App

From this project directory:

```bash
npm install
npm run electron:dev
```

Other development commands:

```bash
npm run typecheck
npm test
npm run build
```

## Building & Distributing

ClipForge ships the tools it needs so end users don't have to install anything.
`scripts/fetch-binaries.mjs` assembles **yt-dlp**, **ffmpeg**, and **ffprobe**
into `resources/bin/` for the current platform (yt-dlp from its GitHub release;
ffmpeg/ffprobe from the `ffmpeg-static`/`ffprobe-static` dev dependencies), and
electron-builder bundles them with the app. At runtime `toolResolver.ts` prefers,
in order: an env override → an auto-updated copy in `userData/bin` → the bundled
copy → whatever is on `PATH`. So a packaged build is self-contained, while a dev
checkout keeps using your Homebrew tools. yt-dlp is refreshed automatically on
launch so site breakages self-heal.

> gallery-dl is **not** bundled (its releases ship no standalone binary). It is
> optional — only needed for photo galleries — and can be installed with
> `pipx install gallery-dl` or `brew install gallery-dl`.

Build commands:

```bash
npm run pack    # unpacked app in release/ (no installer) — quick local test
npm run dist    # full installers (.dmg/.zip on macOS, NSIS on Windows, AppImage on Linux)
```

### Code signing & notarization (required for macOS distribution)

Without signing + notarization, macOS Gatekeeper blocks the download for most
users ("ClipForge is damaged / from an unidentified developer"). To produce a
distributable macOS build, set these environment variables before `npm run dist`
(they are read automatically by electron-builder), and flip `mac.notarize` to
`true` in `electron-builder.yml`:

```bash
export CSC_LINK=/path/to/DeveloperIDApplication.p12   # your Developer ID cert
export CSC_KEY_PASSWORD=...                            # cert password
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=...                 # app-specific password
export APPLE_TEAM_ID=XXXXXXXXXX
```

A free unsigned `npm run pack` is fine for testing on your own machine.

## Browser Extension

ClipForge includes an unpacked Chromium extension in
[`extension`](extension/README.md). It can send the active browser tab or a URL
from the clipboard to the running desktop app using one of the three saved
format presets.

On YouTube watch pages and Shorts, the extension also adds a **scissor button
to the player controls**. Clicking it opens a clip panel: drag the start/end
markers directly on YouTube's progress bar (the screen dims and a live frame
preview follows the marker, like native scrubbing, with an audio waveform under
the scrubber), search the transcript to set the clip points, refine the times
in the panel or grab them from the playhead, and preview the range. You can
export with a **9:16 vertical crop**, **burned-in captions** (static or
word-by-word **karaoke** highlighting), or as a **GIF**, and the app saves only
that section as `Title [clip 1.23-2.45].mp4` so it never overwrites a full
download. The same clip panel also works on Twitch, Vimeo, and Reddit.

The extension talks to the desktop app over **Chrome Native Messaging** — there
is no listening network port. Register the host once with
`npm run install:extension-host`, then keep ClipForge open, choose a save
folder, and create at least one preset under **Formats > Presets**. See
[`extension/README.md`](extension/README.md) for full extension setup.

## Troubleshooting

### A tool is reported missing

Run the tool directly in Terminal. If Terminal cannot find it, ClipForge cannot
find it either:

```bash
command -v yt-dlp
command -v gallery-dl
command -v ffmpeg
command -v ffprobe
command -v whisper-cli
```

Restart ClipForge after installing tools or changing `PATH`.

### Transcription cannot start

- Confirm `whisper-cli --help` works.
- Confirm the selected file ends in `.bin`.
- Re-select the model under **Settings > Transcripts**.
- Use `ggml-base.en.bin` for English or `ggml-base.bin` for multilingual audio.
- Transcript fallback currently supports single videos, not playlists.

### YouTube reports a sign-in or bot check

Update `yt-dlp`:

```bash
brew upgrade yt-dlp
```

Some account, age, region, or network restrictions may still require cookies
or a different network.

### Update the Python downloaders

```bash
pipx upgrade gallery-dl
pipx upgrade instaloader
```

## Legal

ClipForge is a general-purpose tool provided **"as is", without warranty**, and
is **not affiliated with** YouTube, Meta, Instagram, Facebook, TikTok, Pinterest,
X, or any other platform. You are solely responsible for the content you download
and must only use ClipForge for content you own, that is in the public domain,
that is licensed for your use, or that you are otherwise permitted to save. Always
respect copyright law and the terms of service of the sites you use.

The full policies live in [`legal/`](./legal/):

- [Terms of Use](./legal/TERMS_OF_USE.md)
- [Privacy Policy](./legal/PRIVACY_POLICY.md)
- [Acceptable Use Policy](./legal/ACCEPTABLE_USE_POLICY.md)
- [Copyright / DMCA Policy](./legal/DMCA_POLICY.md)
- [Disclaimer](./legal/DISCLAIMER.md)
- [MIT License](./LICENSE) (source code)

> These documents are templates, not legal advice. Fill in the `[BRACKETED]`
> placeholders and have a lawyer review them before distributing the app,
> especially commercially. See [`legal/README.md`](./legal/README.md).
