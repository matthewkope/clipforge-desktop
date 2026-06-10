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
  dimmed frame-by-frame preview), fine-tune the times, pick a saved preset,
  and the desktop app downloads only that section via yt-dlp
  `--download-sections`.
- **Instagram** — reels and videos through the standard video workflow;
  photo posts and carousels analyze into a selectable grid (first photo as
  the cover, photo/video counts shown) and download via gallery-dl.
- **TikTok, X/Twitter** — video downloads with the same format controls.
- **Facebook** — videos via yt-dlp; photos and albums via gallery-dl with
  the same selectable grid.
- **Pinterest** — pins, boards, and board sections with rate-limit-aware
  queueing, hidden download archives, and Brave cookie integration.
- **Browser extension** — send the active tab, a clipboard URL, or a YouTube
  clip selection to the app with one click, using saved format presets.

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

## Browser Extension

ClipForge includes an unpacked Chromium extension in
[`extension`](extension/README.md). It can send the active browser tab or a URL
from the clipboard to the running desktop app using one of the three saved
format presets.

On YouTube watch pages and Shorts, the extension also adds a **scissor button
to the player controls**. Clicking it opens a clip panel: drag the start/end
markers directly on YouTube's progress bar (the screen dims and a live frame
preview follows the marker, like native scrubbing), refine the times in the
panel or grab them from the playhead, preview the range, choose a preset, and
send it to ClipForge. The app downloads only that section, saved as
`Title [clip 1.23-2.45].mp4` so it never overwrites a full download.

The extension connects only to `127.0.0.1:38473`. Before using it, keep
ClipForge open, choose a save folder, and create at least one preset under
**Formats > Presets**.

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
