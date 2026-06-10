# ClipForge Desktop

ClipForge is an Electron desktop app for downloading video, audio, images,
captions, and transcripts from supported social-media URLs. It uses local
command-line tools; media and transcription stay on your computer.

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
albums, Pinterest boards, and similar gallery content.

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
