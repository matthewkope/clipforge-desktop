// ClipForge clip picker.
// On YouTube: adds a scissor button to the player controls; clicking it opens
// a panel to pick a start/end range, choose a saved ClipForge preset, and send
// the clip to the desktop app for a section download.
// On Twitch: a scissor button is added to the player control bar (next to the
// settings gear). On Vimeo/Reddit: a floating scissor button over the main
// <video>. Both toggle the same panel (without the progress-bar markers and
// transcript search, which are YouTube-player specific).
// Note: YouTube enforces Trusted Types, so all DOM here is built with
// createElement/createElementNS — innerHTML would throw.

const SELECTION_STORAGE_KEY = 'clipforgeClipSelection';
const CROP_STORAGE_KEY = 'clipforgeClipCrop';
const CAPTIONS_STORAGE_KEY = 'clipforgeBurnCaptions';
const KARAOKE_STORAGE_KEY = 'clipforgeKaraokeCaptions';
const SVG_NS = 'http://www.w3.org/2000/svg';
const IS_YOUTUBE = /(^|\.)youtube\.com$/i.test(location.hostname);
const IS_TWITCH = /(^|\.)twitch\.tv$/i.test(location.hostname);

// Transcript segments cached per video id so repeated searches while picking a
// clip do not refetch captions through the desktop app.
const transcriptCache = new Map();

let panel = null;
let barOverlay = null;
let previewStopHandler = null;
let panelKeydownCleanup = null;
let floatButton = null;
let floatVideo = null;
let waveform = null;

// Peak arrays cached per video id so re-opening the picker (or re-rendering
// across SPA navigation) keeps the audio profile already sampled. Each entry is
// a Float32Array indexed by time bucket holding the running peak amplitude.
const waveformCache = new Map();

const observer = new MutationObserver(() => {
  ensureClipButton();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('yt-navigate-finish', () => {
  closePanel();
  ensureClipButton();
});
ensureClipButton();

function ensureClipButton() {
  if (IS_YOUTUBE) {
    ensureScissorButton();
  } else if (IS_TWITCH) {
    ensureTwitchBarButton();
  } else {
    ensureFloatingButton();
  }
}

function scissorIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', '#ffffff');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const shapes = [
    ['circle', { cx: '6', cy: '6', r: '3' }],
    ['circle', { cx: '6', cy: '18', r: '3' }],
    ['line', { x1: '20', y1: '4', x2: '8.12', y2: '15.88' }],
    ['line', { x1: '14.47', y1: '14.48', x2: '20', y2: '20' }],
    ['line', { x1: '8.12', y1: '8.12', x2: '12', y2: '12' }]
  ];
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) {
      shape.setAttribute(name, value);
    }
    svg.appendChild(shape);
  }
  return svg;
}

function ensureScissorButton() {
  // YouTube's redesigned player nests buttons in .ytp-right-controls-left;
  // the classic player keeps them directly in .ytp-right-controls.
  const controls = document.querySelector('.ytp-right-controls-left') || document.querySelector('.ytp-right-controls');
  if (!controls || document.querySelector('.clipforge-clip-button') || !currentVideoId()) {
    return;
  }

  const button = document.createElement('button');
  button.className = 'ytp-button clipforge-clip-button';
  button.title = 'Clip with ClipForge';
  button.setAttribute('aria-label', 'Clip with ClipForge');
  const icon = document.createElement('span');
  icon.className = 'clipforge-clip-button-icon';
  icon.appendChild(scissorIcon());
  button.appendChild(icon);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
  });

  const settingsButton = controls.querySelector('.ytp-settings-button');
  if (settingsButton) {
    controls.insertBefore(button, settingsButton);
  } else {
    controls.prepend(button);
  }
}

// Twitch: place the scissor button inside the player control bar (next to the
// settings gear) rather than floating it over the video. Twitch re-renders the
// controls on theatre/fullscreen toggles and SPA navigation, so the
// MutationObserver re-runs this and re-inserts the button when it disappears.
function ensureTwitchBarButton() {
  const existing = document.querySelector('.clipforge-twitch-button');
  if (existing && existing.isConnected) {
    return;
  }

  const settingsButton = document.querySelector('[data-a-target="player-settings-button"]');
  if (!settingsButton) {
    // Controls not mounted yet (or a non-player page); the observer retries.
    return;
  }
  const group = settingsButton.closest('.player-controls__right-control-group');
  if (!group || group.querySelector('.clipforge-twitch-button')) {
    return;
  }

  // The settings button is wrapped in layout divs; find its wrapper that is a
  // direct child of the control group so we can insert just to its left.
  let wrapper = settingsButton;
  while (wrapper.parentElement && wrapper.parentElement !== group) {
    wrapper = wrapper.parentElement;
  }

  const button = el('button', 'clipforge-twitch-button');
  button.type = 'button';
  button.title = 'Clip with ClipForge';
  button.setAttribute('aria-label', 'Clip with ClipForge');
  button.appendChild(scissorIcon());
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
  });
  group.insertBefore(button, wrapper);
}

// Non-YouTube sites (Vimeo/Reddit): the main playing video is taken to
// be the largest <video> by rendered area. Reddit nests its video inside the
// open shadow root of <shreddit-player>, so peek into those too.
function allVideos() {
  const videos = [...document.querySelectorAll('video')];
  for (const host of document.querySelectorAll('shreddit-player, shreddit-player-2, shreddit-async-loader')) {
    if (host.shadowRoot) {
      videos.push(...host.shadowRoot.querySelectorAll('video'));
    }
  }
  return videos;
}

function largestVideo() {
  let best = null;
  let bestArea = 0;
  for (const video of allVideos()) {
    const area = video.clientWidth * video.clientHeight;
    if (area > bestArea) {
      best = video;
      bestArea = area;
    }
  }
  return best;
}

// Walks out of any shadow roots so injected elements land in the light DOM,
// where the extension's stylesheet applies.
function lightDomAnchor(video) {
  let node = video;
  while (node.getRootNode() instanceof ShadowRoot) {
    node = node.getRootNode().host;
  }
  return node;
}

// Floating scissor button rendered top-right over the main video on
// non-YouTube sites. Re-attached whenever SPA navigation swaps the video out.
function ensureFloatingButton() {
  const video = largestVideo();
  if (!video) {
    if (floatButton) {
      floatButton.remove();
      floatButton = null;
      floatVideo = null;
    }
    return;
  }
  if (floatButton && floatButton.isConnected && floatVideo === video) {
    return;
  }
  floatButton?.remove();
  floatVideo = video;

  const anchor = lightDomAnchor(video);
  const container = anchor.parentElement || document.body;
  if (container !== document.body && getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  floatButton = el('button', 'clipforge-float-button');
  floatButton.type = 'button';
  floatButton.title = 'Clip with ClipForge';
  floatButton.setAttribute('aria-label', 'Clip with ClipForge');
  floatButton.appendChild(scissorIcon());
  floatButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
  });
  container.appendChild(floatButton);
}

function currentVideoId() {
  const url = new URL(location.href);
  if (url.pathname === '/watch') {
    return url.searchParams.get('v');
  }
  const shortsMatch = url.pathname.match(/^\/shorts\/([\w-]{6,})/);
  return shortsMatch ? shortsMatch[1] : null;
}

function playerVideo() {
  if (IS_YOUTUBE) {
    return document.querySelector('.html5-video-player video.html5-main-video') || document.querySelector('video');
  }
  return floatVideo?.isConnected ? floatVideo : largestVideo();
}

function togglePanel() {
  if (panel) {
    closePanel();
    return;
  }
  void openPanel();
}

function closePanel() {
  stopPreview();
  panelKeydownCleanup?.();
  panelKeydownCleanup = null;
  waveform?.destroy();
  waveform = null;
  panel?.remove();
  panel = null;
  barOverlay?.remove();
  barOverlay = null;
}

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

async function openPanel() {
  const video = playerVideo();
  const container = IS_YOUTUBE ? document.querySelector('.html5-video-player') : document.body;
  if (!video || !container || (IS_YOUTUBE && !currentVideoId())) {
    return;
  }

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const start = Math.floor(video.currentTime);
  const end = duration > 0 ? Math.min(Math.floor(start + 15), Math.floor(duration)) : Math.floor(start + 15);

  panel = el('div', 'clipforge-panel');

  const header = el('div', 'clipforge-panel-header');
  header.appendChild(el('span', '', 'ClipForge clip'));
  const closeButton = el('button', 'clipforge-close', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close');
  header.appendChild(closeButton);
  panel.appendChild(header);

  const makeTimeRow = (labelText, inputClass, markClass, value) => {
    const row = el('div', 'clipforge-row');
    row.appendChild(el('label', '', labelText));
    const input = el('input', inputClass);
    input.type = 'text';
    input.value = value;
    input.spellcheck = false;
    row.appendChild(input);
    const mark = el('button', markClass, 'Set');
    mark.type = 'button';
    mark.title = 'Use current playback time';
    row.appendChild(mark);
    panel.appendChild(row);
    return { input, mark };
  };

  const startRow = makeTimeRow('Start', 'clipforge-start', 'clipforge-mark-start', formatTime(start));
  const endRow = makeTimeRow('End', 'clipforge-end', 'clipforge-mark-end', formatTime(Math.max(end, start + 1)));

  const sliderMax = duration > 0 ? duration : Math.max(end, start + 1) + 60;
  const range = { start, end: Math.max(end, start + 1) };
  barOverlay?.remove();
  barOverlay = null;
  waveform?.destroy();
  waveform = null;
  if (IS_YOUTUBE) {
    // Progress-bar carets only exist on YouTube's player.
    barOverlay = createBarMarkers(video, sliderMax, range, () => {
      startRow.input.value = formatTime(range.start);
      endRow.input.value = formatTime(range.end);
    });
    // Audio waveform strip flush under the progress bar, between the carets.
    waveform = createWaveform(video, sliderMax);
  }

  const syncSlidersFromInputs = () => {
    const startValue = parseTime(startRow.input.value);
    const endValue = parseTime(endRow.input.value);
    if (startValue !== null) {
      range.start = Math.min(Math.max(0, startValue), sliderMax);
    }
    if (endValue !== null) {
      range.end = Math.min(Math.max(0, endValue), sliderMax);
    }
    barOverlay?.update();
  };
  startRow.input.addEventListener('change', syncSlidersFromInputs);
  endRow.input.addEventListener('change', syncSlidersFromInputs);

  const outputRow = el('div', 'clipforge-row');
  outputRow.appendChild(el('label', '', 'Output'));
  const presetSelect = el('select', 'clipforge-preset');
  presetSelect.append(new Option('Loading presets…', ''));
  outputRow.appendChild(presetSelect);
  panel.appendChild(outputRow);

  // MP4-only ffmpeg treatments applied by the desktop app after download.
  const optionsRow = el('div', 'clipforge-row clipforge-options-row');
  const cropToggle = makeOptionToggle('9:16 crop', 'clipforge-crop-toggle', CROP_STORAGE_KEY);
  const captionsToggle = makeOptionToggle('Burn captions', 'clipforge-captions-toggle', CAPTIONS_STORAGE_KEY);
  optionsRow.appendChild(cropToggle.wrapper);
  optionsRow.appendChild(captionsToggle.wrapper);
  panel.appendChild(optionsRow);

  // Karaoke captions: word-by-word highlighted captions. Only meaningful when
  // "Burn captions" is on, so this toggle gates on it — hidden/disabled and
  // reset whenever burn-captions is off. When on, sendClip sets
  // captionStyle.animate = 'word' (the agreed contract with the desktop app).
  const karaokeRow = el('div', 'clipforge-row clipforge-options-row clipforge-karaoke-row');
  const karaokeToggle = makeOptionToggle('🎤 Karaoke captions', 'clipforge-karaoke-toggle', KARAOKE_STORAGE_KEY);
  karaokeRow.appendChild(karaokeToggle.wrapper);
  panel.appendChild(karaokeRow);

  const syncKaraokeGate = () => {
    const captionsOn = captionsToggle.checkbox.checked;
    karaokeRow.classList.toggle('clipforge-disabled', !captionsOn);
    karaokeToggle.checkbox.disabled = !captionsOn;
    if (!captionsOn && karaokeToggle.checkbox.checked) {
      // Reset karaoke when burn-captions is turned off.
      karaokeToggle.checkbox.checked = false;
      karaokeToggle.checkbox.dispatchEvent(new Event('change'));
    }
  };
  captionsToggle.checkbox.addEventListener('change', syncKaraokeGate);
  syncKaraokeGate();

  // One-click export presets for the major short-form platforms.
  const platformRow = el('div', 'clipforge-row clipforge-platform-row');
  const makePlatformButton = (label) => {
    const button = el('button', 'clipforge-platform-button', label);
    button.type = 'button';
    platformRow.appendChild(button);
    return button;
  };
  const reelsButton = makePlatformButton('Reels/TikTok');
  const shortsButton = makePlatformButton('Shorts');
  const xButton = makePlatformButton('X');
  panel.appendChild(platformRow);

  // Transcript search: type a phrase, click a match, and the clip window jumps
  // to that moment (keeping its current length). YouTube only — the bridge
  // transcript endpoint works off the YouTube video id.
  let searchInput = null;
  let searchResults = null;
  if (IS_YOUTUBE) {
    const searchSection = el('div', 'clipforge-search');
    searchInput = el('input', 'clipforge-search-input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search transcript… (e.g. a quote)';
    searchInput.spellcheck = false;
    searchResults = el('div', 'clipforge-search-results');
    searchSection.appendChild(searchInput);
    searchSection.appendChild(searchResults);
    panel.appendChild(searchSection);
  }

  const actions = el('div', 'clipforge-actions');
  const previewButton = el('button', 'clipforge-preview', 'Preview');
  previewButton.type = 'button';
  const sendButton = el('button', 'clipforge-send', 'Send to ClipForge');
  sendButton.type = 'button';
  sendButton.disabled = true;
  actions.appendChild(previewButton);
  actions.appendChild(sendButton);
  panel.appendChild(actions);

  panel.appendChild(el('div', 'clipforge-status'));
  if (IS_YOUTUBE) {
    container.appendChild(panel);
  } else {
    // Fixed-position panel pinned near the video's top-right corner.
    panel.classList.add('clipforge-panel-floating');
    const rect = video.getBoundingClientRect();
    const width = 300;
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 20, rect.right - width - 12))}px`;
    panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 120, rect.top + 48))}px`;
    document.body.appendChild(panel);
  }

  // Keep typing inside the panel from triggering YouTube player shortcuts.
  for (const eventName of ['keydown', 'keyup', 'keypress']) {
    panel.addEventListener(eventName, (event) => event.stopPropagation());
  }

  closeButton.addEventListener('click', closePanel);
  startRow.mark.addEventListener('click', () => {
    startRow.input.value = formatTime(video.currentTime);
    syncSlidersFromInputs();
  });
  endRow.mark.addEventListener('click', () => {
    endRow.input.value = formatTime(video.currentTime);
    syncSlidersFromInputs();
  });
  previewButton.addEventListener('click', () => {
    const range = readRange(startRow.input, endRow.input, video);
    if (range) {
      previewRange(video, range);
    }
  });
  presetSelect.addEventListener('change', () => {
    chrome.storage.local.set({ [SELECTION_STORAGE_KEY]: presetSelect.value });
  });
  if (searchInput && searchResults) {
    setupTranscriptSearch(searchInput, searchResults, (segment) => {
      const currentStart = parseTime(startRow.input.value) ?? 0;
      const currentEnd = parseTime(endRow.input.value);
      const length = currentEnd && currentEnd > currentStart ? currentEnd - currentStart : 15;
      const nextStart = Math.max(0, Math.min(segment.start, Math.max(0, sliderMax - 1)));
      const nextEnd = Math.min(sliderMax, nextStart + length);
      startRow.input.value = formatTime(nextStart);
      endRow.input.value = formatTime(nextEnd);
      syncSlidersFromInputs();
      video.currentTime = nextStart;
    });
  }
  sendButton.addEventListener('click', () => {
    void sendClip(startRow.input, endRow.input, presetSelect, sendButton, video);
  });

  // Platform export presets: toggle crop/captions and sanity-check the
  // selection length against each platform's limit.
  const setToggle = (toggle, checked) => {
    if (toggle.checkbox.checked !== checked) {
      toggle.checkbox.checked = checked;
      // Fire change so the persisted storage value stays in sync.
      toggle.checkbox.dispatchEvent(new Event('change'));
    }
  };
  const selectionLength = () => {
    const startValue = parseTime(startRow.input.value);
    const endValue = parseTime(endRow.input.value);
    return startValue !== null && endValue !== null ? endValue - startValue : 0;
  };
  reelsButton.addEventListener('click', () => {
    setToggle(cropToggle, true);
    setToggle(captionsToggle, true);
    if (selectionLength() > 90) {
      showPanelStatus('Reels are limited to 90s.', 'error');
    } else {
      showPanelStatus('Set up for Reels/TikTok: 9:16 crop + captions.');
    }
  });
  shortsButton.addEventListener('click', () => {
    setToggle(cropToggle, true);
    setToggle(captionsToggle, true);
    if (selectionLength() > 60) {
      const startValue = parseTime(startRow.input.value) ?? 0;
      endRow.input.value = formatTime(Math.min(sliderMax, startValue + 60));
      syncSlidersFromInputs();
      showPanelStatus('End clamped to a 60s window for Shorts.');
    } else {
      showPanelStatus('Set up for Shorts: 9:16 crop + captions.');
    }
  });
  xButton.addEventListener('click', () => {
    setToggle(cropToggle, false);
    if (selectionLength() > 140) {
      showPanelStatus('X clips are limited to 140s.', 'error');
    } else {
      showPanelStatus('Set up for X: original aspect ratio.');
    }
  });

  // Document-level keyboard shortcuts while the panel is open. Capture phase
  // plus stopImmediatePropagation keeps YouTube's own player shortcuts (and
  // other site hotkeys) from also firing on handled keys.
  const slideWindow = (delta) => {
    syncSlidersFromInputs();
    const length = Math.max(0.1, range.end - range.start);
    const newStart = Math.max(0, Math.min(Math.max(0, sliderMax - length), range.start + delta));
    range.start = newStart;
    range.end = Math.min(sliderMax, newStart + length);
    startRow.input.value = formatTime(range.start);
    endRow.input.value = formatTime(range.end);
    barOverlay?.update();
    video.currentTime = range.start;
  };
  const onPanelKeydown = (event) => {
    const target = event.target;
    if (
      (panel && target instanceof Node && panel.contains(target)) ||
      (target instanceof Element &&
        (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable))
    ) {
      return;
    }
    let handled = true;
    switch (event.key) {
      case '[':
        startRow.input.value = formatTime(video.currentTime);
        syncSlidersFromInputs();
        break;
      case ']':
        endRow.input.value = formatTime(video.currentTime);
        syncSlidersFromInputs();
        break;
      case 'ArrowLeft':
        slideWindow(event.shiftKey ? -0.1 : -1);
        break;
      case 'ArrowRight':
        slideWindow(event.shiftKey ? 0.1 : 1);
        break;
      case 'Enter':
        if (!sendButton.disabled) {
          sendButton.click();
        }
        break;
      case 'Escape':
        closePanel();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };
  document.addEventListener('keydown', onPanelKeydown, true);
  panelKeydownCleanup = () => document.removeEventListener('keydown', onPanelKeydown, true);

  await populateOutputs(presetSelect, sendButton);
}

// Checkbox persisted in extension storage; used for the crop/caption options.
function makeOptionToggle(labelText, className, storageKey) {
  const wrapper = el('label', 'clipforge-option');
  const checkbox = el('input', className);
  checkbox.type = 'checkbox';
  wrapper.appendChild(checkbox);
  wrapper.appendChild(el('span', '', labelText));
  chrome.storage.local
    .get(storageKey)
    .then((stored) => {
      checkbox.checked = Boolean(stored?.[storageKey]);
    })
    .catch(() => undefined);
  checkbox.addEventListener('change', () => {
    chrome.storage.local.set({ [storageKey]: checkbox.checked });
  });
  return { wrapper, checkbox };
}

async function loadTranscript() {
  const videoId = currentVideoId();
  if (!videoId) {
    throw new Error('Could not detect the YouTube video ID.');
  }
  if (transcriptCache.has(videoId)) {
    return transcriptCache.get(videoId);
  }
  const response = await chrome.runtime
    .sendMessage({
      type: 'clipforge-transcript',
      payload: { url: `https://www.youtube.com/watch?v=${videoId}` }
    })
    .catch(() => null);
  if (!response?.ok || !Array.isArray(response.body?.segments)) {
    throw new Error(response?.body?.error || 'Open the ClipForge desktop app to search transcripts.');
  }
  transcriptCache.set(videoId, response.body.segments);
  return response.body.segments;
}

function setupTranscriptSearch(input, results, onPick) {
  let debounceTimer = null;
  let loading = false;

  const renderMessage = (message) => {
    results.replaceChildren(el('div', 'clipforge-search-hint', message));
  };

  const renderMatches = (segments, query) => {
    const needle = query.toLowerCase();
    const matches = segments.filter((segment) => segment.text.toLowerCase().includes(needle)).slice(0, 8);
    if (matches.length === 0) {
      renderMessage('No transcript lines match.');
      return;
    }
    results.replaceChildren();
    for (const match of matches) {
      const button = el('button', 'clipforge-search-result');
      button.type = 'button';
      button.appendChild(el('span', 'clipforge-search-time', formatTime(match.start)));
      button.appendChild(el('span', 'clipforge-search-text', match.text));
      button.addEventListener('click', () => onPick(match));
      results.appendChild(button);
    }
  };

  const run = async () => {
    const query = input.value.trim();
    if (query.length < 2) {
      results.replaceChildren();
      return;
    }
    try {
      if (!transcriptCache.has(currentVideoId()) && !loading) {
        loading = true;
        renderMessage('Loading transcript…');
      }
      const segments = await loadTranscript();
      loading = false;
      // The query may have changed while the transcript was loading.
      const latest = input.value.trim();
      if (latest.length >= 2) {
        renderMatches(segments, latest);
      }
    } catch (caught) {
      loading = false;
      renderMessage(caught?.message || 'Transcript search is unavailable.');
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void run(), 250);
  });
}

// Draggable start/end markers rendered directly on YouTube's progress bar.
// Dragging a marker scrubs the video to that moment so the exact frame is visible.
function createBarMarkers(video, max, range, onChange) {
  const bar = document.querySelector('.ytp-progress-bar');
  if (!bar) {
    return null;
  }

  const overlay = el('div', 'clipforge-bar-overlay');
  const fill = el('div', 'clipforge-bar-fill');
  overlay.appendChild(fill);

  // YouTube-style scrub feedback while a handle is dragged: the video dims
  // with a fade, and a live frame preview with the timestamp floats above the
  // bar at the handle position. The preview canvas is painted from the video
  // element itself, which is already seeked to the handle time.
  const player = document.querySelector('.html5-video-player');
  let scrubDim = null;
  let scrubPreview = null;
  let scrubCanvas = null;
  let scrubTime = null;
  let scrubHideTimer = null;
  let pendingSeek = null;
  const drawScrubFrame = () => {
    if (!scrubCanvas || video.videoWidth === 0) {
      return;
    }
    try {
      scrubCanvas.getContext('2d').drawImage(video, 0, 0, scrubCanvas.width, scrubCanvas.height);
    } catch {
      // Frame not decodable yet; the next completed seek redraws.
    }
  };
  // Seek-chaining: while dragging, a new seek is only issued once the previous
  // one finishes. Flooding currentTime on every pointer move cancels in-flight
  // seeks before any frame gets decoded, which froze the main video.
  const onSeeked = () => {
    drawScrubFrame();
    if (pendingSeek !== null && Math.abs(video.currentTime - pendingSeek) > 0.05) {
      video.currentTime = pendingSeek;
    } else {
      pendingSeek = null;
    }
  };
  const seekTo = (time) => {
    pendingSeek = time;
    if (!video.seeking) {
      video.currentTime = time;
    }
  };
  const showScrub = () => {
    if (!player) {
      return;
    }
    clearTimeout(scrubHideTimer);
    player.classList.add('clipforge-scrubbing');
    if (!scrubDim) {
      scrubDim = el('div', 'clipforge-scrub-dim');
      player.appendChild(scrubDim);
      scrubPreview = el('div', 'clipforge-scrub-preview');
      scrubCanvas = el('canvas', 'clipforge-scrub-canvas');
      scrubCanvas.width = 320;
      scrubCanvas.height = 180;
      scrubTime = el('div', 'clipforge-scrub-preview-time');
      scrubPreview.appendChild(scrubCanvas);
      scrubPreview.appendChild(scrubTime);
      player.appendChild(scrubPreview);
    }
    video.addEventListener('seeked', onSeeked);
    drawScrubFrame();
    requestAnimationFrame(() => {
      scrubDim?.classList.add('clipforge-scrub-visible');
      scrubPreview?.classList.add('clipforge-scrub-visible');
    });
  };
  const updateScrub = (which) => {
    if (!scrubPreview || !player) {
      return;
    }
    const time = which === 'start' ? range.start : range.end;
    scrubTime.textContent = formatTime(time);
    const barRect = bar.getBoundingClientRect();
    const playerRect = player.getBoundingClientRect();
    const half = scrubPreview.offsetWidth / 2 || 90;
    const x = barRect.left - playerRect.left + (time / max) * barRect.width;
    scrubPreview.style.left = `${Math.max(half + 8, Math.min(playerRect.width - half - 8, x))}px`;
    scrubPreview.style.bottom = `${playerRect.bottom - barRect.top + 14}px`;
    drawScrubFrame();
  };
  const hideScrub = () => {
    player?.classList.remove('clipforge-scrubbing');
    video.removeEventListener('seeked', onSeeked);
    pendingSeek = null;
    scrubDim?.classList.remove('clipforge-scrub-visible');
    scrubPreview?.classList.remove('clipforge-scrub-visible');
    scrubHideTimer = setTimeout(() => {
      scrubDim?.remove();
      scrubPreview?.remove();
      scrubDim = null;
      scrubPreview = null;
      scrubCanvas = null;
      scrubTime = null;
    }, 300);
  };

  const handles = {};
  for (const which of ['start', 'end']) {
    const handle = el('div', `clipforge-bar-handle clipforge-bar-handle-${which}`);
    overlay.appendChild(handle);
    handles[which] = handle;

    // Keep YouTube's own seek handling away from our markers.
    for (const eventName of ['mousedown', 'click', 'dblclick', 'touchstart']) {
      handle.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }

    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const wasPlaying = !video.paused;
      // Keep the video paused for the whole drag even if the player tries to
      // resume it; paused seeks are what make the frames visibly step.
      const pauseGuard = () => video.pause();
      video.pause();
      video.addEventListener('play', pauseGuard);
      showScrub();
      updateScrub(which);

      const applyPointer = (clientX) => {
        const rect = bar.getBoundingClientRect();
        if (rect.width === 0) {
          return;
        }
        const time = Math.max(0, Math.min(max, ((clientX - rect.left) / rect.width) * max));
        if (which === 'start') {
          range.start = Math.min(time, range.end - 0.1);
          seekTo(range.start);
        } else {
          range.end = Math.max(time, range.start + 0.1);
          seekTo(range.end);
        }
        update();
        updateScrub(which);
        onChange();
      };

      // Track the drag at window level in the capture phase: YouTube's player
      // grabs pointer capture for its own scrubbing, which would otherwise
      // steal the drag from our handle after a few pixels.
      const move = (moveEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopImmediatePropagation();
        applyPointer(moveEvent.clientX);
      };
      const release = (upEvent) => {
        upEvent?.stopImmediatePropagation?.();
        hideScrub();
        video.removeEventListener('play', pauseGuard);
        if (wasPlaying) {
          void video.play();
        }
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', release, true);
        window.removeEventListener('pointercancel', release, true);
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', release, true);
      window.addEventListener('pointercancel', release, true);
    });
  }

  const update = () => {
    const startPercent = (Math.max(0, range.start) / max) * 100;
    const endPercent = (Math.min(max, range.end) / max) * 100;
    fill.style.left = `${startPercent}%`;
    fill.style.width = `${Math.max(0, endPercent - startPercent)}%`;
    handles.start.style.left = `${startPercent}%`;
    handles.end.style.left = `${endPercent}%`;
  };

  // Dragging the shaded region between the handles slides the whole selection
  // window, preserving its length. The scrub preview follows the start time.
  for (const eventName of ['mousedown', 'click', 'dblclick', 'touchstart']) {
    fill.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }
  fill.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const grabX = event.clientX;
    const grabStart = range.start;
    const length = range.end - range.start;
    const wasPlaying = !video.paused;
    const pauseGuard = () => video.pause();
    video.pause();
    video.addEventListener('play', pauseGuard);
    showScrub();
    updateScrub('start');

    const move = (moveEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopImmediatePropagation();
      const rect = bar.getBoundingClientRect();
      if (rect.width === 0) {
        return;
      }
      const delta = ((moveEvent.clientX - grabX) / rect.width) * max;
      const newStart = Math.max(0, Math.min(max - length, grabStart + delta));
      range.start = newStart;
      range.end = newStart + length;
      seekTo(range.start);
      update();
      updateScrub('start');
      onChange();
    };
    const release = (upEvent) => {
      upEvent?.stopImmediatePropagation?.();
      hideScrub();
      video.removeEventListener('play', pauseGuard);
      if (wasPlaying) {
        void video.play();
      }
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
  });

  update();
  bar.appendChild(overlay);

  return {
    update,
    remove: () => {
      overlay.remove();
      clearTimeout(scrubHideTimer);
      video.removeEventListener('seeked', onSeeked);
      player?.classList.remove('clipforge-scrubbing');
      scrubDim?.remove();
      scrubPreview?.remove();
      scrubDim = null;
      scrubPreview = null;
    }
  };
}

// Audio waveform strip drawn directly beneath YouTube's progress bar so the
// user can see silence vs. speech/beats while picking a clip range.
//
// APPROACH (and its limitation):
// We attempt `new AudioContext()` + `createMediaElementSource(video)` +
// `AnalyserNode`. If that succeeds we MUST route the source through to
// `audioContext.destination`, otherwise the page audio is muted. We then
// progressively sample the analyser's peak/RMS amplitude on every animation
// frame and store it in a per-video-id peak array, drawing only the buckets we
// have actually heard play (the waveform fills in across the played region).
//
// LIMITATION ON YOUTUBE: the <video> media is typically cross-origin /
// EME-protected, so `createMediaElementSource` may throw or yield a tainted
// (silent / all-zero) stream, and decoding the whole track via
// OfflineAudioContext is blocked. So this is necessarily a LIVE, progressive
// waveform: it only fills in audio that has been played back while the picker
// is open (it cannot pre-render the whole track). Everything is wrapped in
// try/catch and bails out cleanly (disconnecting nodes, restoring audio) the
// moment anything looks wrong, so it can never break the picker or page audio.
function createWaveform(video, max) {
  const bar = document.querySelector('.ytp-progress-bar');
  if (!bar || !(max > 0)) {
    return null;
  }

  const BUCKETS = 800; // Time resolution of the cached peak array.
  const videoId = currentVideoId() || 'unknown';
  let peaks = waveformCache.get(videoId);
  if (!peaks || peaks.length !== BUCKETS) {
    peaks = new Float32Array(BUCKETS);
    waveformCache.set(videoId, peaks);
  }

  const canvas = el('canvas', 'clipforge-waveform-canvas');
  bar.appendChild(canvas);

  let audioContext = null;
  let sourceNode = null;
  let analyser = null;
  let sampleBuffer = null;
  let rafId = null;
  let destroyed = false;
  let ratio = window.devicePixelRatio || 1;

  const resizeCanvas = () => {
    const rect = bar.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }
    ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(canvas.offsetHeight * ratio) || Math.round(28 * ratio);
  };

  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const mid = canvas.height / 2;
    const colWidth = canvas.width / BUCKETS;
    ctx.fillStyle = 'rgba(127, 227, 212, 0.65)';
    for (let i = 0; i < BUCKETS; i += 1) {
      const amp = peaks[i];
      if (amp <= 0) {
        continue;
      }
      const h = Math.max(1 * ratio, amp * (canvas.height - 2 * ratio));
      ctx.fillRect(i * colWidth, mid - h / 2, Math.max(1, colWidth - 0.5), h);
    }
  };

  // Live sampling loop: read the current peak from the analyser and fold it
  // into the bucket for whatever time is playing now (max of what we've heard).
  const tick = () => {
    if (destroyed) {
      return;
    }
    if (analyser && sampleBuffer && !video.paused && Number.isFinite(video.currentTime)) {
      analyser.getFloatTimeDomainData(sampleBuffer);
      let peak = 0;
      for (let i = 0; i < sampleBuffer.length; i += 1) {
        const v = Math.abs(sampleBuffer[i]);
        if (v > peak) {
          peak = v;
        }
      }
      const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.floor((video.currentTime / max) * BUCKETS)));
      if (peak > peaks[bucket]) {
        peaks[bucket] = Math.min(1, peak);
      }
    }
    draw();
    rafId = requestAnimationFrame(tick);
  };

  // Try to wire up Web Audio. Any failure bails out leaving page audio intact
  // and the canvas showing whatever (cached) peaks we already have.
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      audioContext = new Ctx();
      sourceNode = audioContext.createMediaElementSource(video);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      sampleBuffer = new Float32Array(analyser.fftSize);
      // CRITICAL: route source -> analyser -> destination, or the page mutes.
      sourceNode.connect(analyser);
      analyser.connect(audioContext.destination);
    }
  } catch {
    // Cross-origin / EME tainting (the common YouTube case) or no Web Audio.
    // Disconnect anything partially wired so we never affect page audio, and
    // fall back to drawing the cached peaks only (static, may be empty).
    try {
      sourceNode?.disconnect();
    } catch {
      // ignore
    }
    try {
      analyser?.disconnect();
    } catch {
      // ignore
    }
    try {
      audioContext?.close();
    } catch {
      // ignore
    }
    audioContext = null;
    sourceNode = null;
    analyser = null;
    sampleBuffer = null;
  }

  resizeCanvas();
  rafId = requestAnimationFrame(tick);
  const onResize = () => {
    resizeCanvas();
    draw();
  };
  window.addEventListener('resize', onResize);

  return {
    destroy: () => {
      destroyed = true;
      window.removeEventListener('resize', onResize);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      // Reconnect the element source straight to the speakers before closing,
      // so tearing down our analyser never leaves the page muted.
      try {
        sourceNode?.disconnect();
        analyser?.disconnect();
        if (sourceNode && audioContext) {
          sourceNode.connect(audioContext.destination);
        }
      } catch {
        // ignore
      }
      try {
        audioContext?.close();
      } catch {
        // ignore
      }
      audioContext = null;
      sourceNode = null;
      analyser = null;
      sampleBuffer = null;
      canvas.remove();
    }
  };
}

async function populateOutputs(presetSelect, sendButton) {
  const status = await chrome.runtime.sendMessage({ type: 'clipforge-status' }).catch(() => null);
  presetSelect.replaceChildren();

  if (!status?.ok) {
    presetSelect.append(new Option('ClipForge app not running', ''));
    showPanelStatus(status?.body?.error || 'Open the ClipForge desktop app first.', 'error');
    return;
  }

  const body = status.body;
  const presets = Array.isArray(body.presets) ? body.presets : [];
  for (const preset of presets) {
    presetSelect.append(new Option(`${preset.name} · ${preset.formats.join(' + ').toUpperCase()}`, `preset:${preset.id}`));
  }
  presetSelect.append(new Option('MP4 video', 'format:mp4'));
  presetSelect.append(new Option('MP3 audio', 'format:mp3'));
  presetSelect.append(new Option('GIF clip', 'format:gif'));

  const stored = await chrome.storage.local.get(SELECTION_STORAGE_KEY).catch(() => ({}));
  const storedValue = stored?.[SELECTION_STORAGE_KEY];
  if (storedValue && [...presetSelect.options].some((option) => option.value === storedValue)) {
    presetSelect.value = storedValue;
  } else if (presets.length > 0) {
    presetSelect.value = `preset:${presets[0].id}`;
  } else {
    presetSelect.value = 'format:mp4';
  }

  if (!body.ready) {
    showPanelStatus('Open ClipForge to send clips.', 'error');
  } else if (!body.saveFolderConfigured) {
    showPanelStatus('Choose a save folder in ClipForge first.', 'error');
  } else {
    sendButton.disabled = false;
    showPanelStatus(body.downloadActive ? 'A download is running; new clips will queue.' : '');
  }
}

async function sendClip(startInput, endInput, presetSelect, sendButton, video) {
  const range = readRange(startInput, endInput, video);
  if (!range) {
    return;
  }
  let clipUrl = location.href;
  if (IS_YOUTUBE) {
    const videoId = currentVideoId();
    if (!videoId) {
      showPanelStatus('Could not detect the YouTube video ID.', 'error');
      return;
    }
    clipUrl = `https://www.youtube.com/watch?v=${videoId}`;
  }
  const selection = presetSelect.value.startsWith('preset:')
    ? { presetId: presetSelect.value.slice('preset:'.length) }
    : { format: presetSelect.value.slice('format:'.length) || 'mp4' };
  const cropChecked = panel?.querySelector('.clipforge-crop-toggle')?.checked;
  const captionsChecked = panel?.querySelector('.clipforge-captions-toggle')?.checked;
  // Karaoke only applies when captions are being burned. When on, the desktop
  // app renders word-by-word highlighted captions for captionStyle.animate === 'word'.
  const karaokeChecked = captionsChecked && panel?.querySelector('.clipforge-karaoke-toggle')?.checked;
  const captionStyle = karaokeChecked ? { animate: 'word' } : null;

  sendButton.disabled = true;
  showPanelStatus('Sending clip to ClipForge…');
  const response = await chrome.runtime
    .sendMessage({
      type: 'clipforge-download',
      payload: {
        url: clipUrl,
        source: IS_YOUTUBE ? 'youtube-player' : 'active-tab',
        clipStart: range.start,
        clipEnd: range.end,
        ...selection,
        ...(cropChecked ? { crop: 'vertical' } : {}),
        ...(captionsChecked ? { burnCaptions: true } : {}),
        ...(captionStyle ? { captionStyle } : {})
      }
    })
    .catch(() => null);

  if (response?.ok) {
    const label = response.body?.preset ? `“${response.body.preset}”` : (response.body?.format || 'clip').toUpperCase();
    showPanelStatus(`Clip ${formatTime(range.start)}–${formatTime(range.end)} sent to ClipForge as ${label}.`, 'success');
    setTimeout(() => closePanel(), 2000);
  } else {
    sendButton.disabled = false;
    showPanelStatus(response?.body?.error || 'ClipForge rejected the clip.', 'error');
  }
}

function readRange(startInput, endInput, video) {
  const start = parseTime(startInput.value);
  const end = parseTime(endInput.value);
  if (start === null || end === null) {
    showPanelStatus('Times must look like 1:23 or 1:02:03.', 'error');
    return null;
  }
  if (end <= start) {
    showPanelStatus('The end time must be after the start time.', 'error');
    return null;
  }
  const duration = Number.isFinite(video.duration) ? video.duration : null;
  const clampedEnd = duration ? Math.min(end, duration) : end;
  showPanelStatus('');
  return { start: Math.max(0, start), end: clampedEnd };
}

function previewRange(video, range) {
  stopPreview();
  video.currentTime = range.start;
  void video.play();
  previewStopHandler = () => {
    if (video.currentTime >= range.end) {
      video.pause();
      stopPreview();
    }
  };
  video.addEventListener('timeupdate', previewStopHandler);
}

function stopPreview() {
  const video = playerVideo();
  if (previewStopHandler && video) {
    video.removeEventListener('timeupdate', previewStopHandler);
  }
  previewStopHandler = null;
}

function showPanelStatus(message, kind = '') {
  const status = panel?.querySelector('.clipforge-status');
  if (status) {
    status.textContent = message;
    status.className = `clipforge-status${kind ? ` ${kind}` : ''}`;
  }
}

function formatTime(value) {
  const totalTenths = Math.max(0, Math.round(value * 10));
  const total = Math.floor(totalTenths / 10);
  const tenths = totalTenths % 10;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0') + (tenths > 0 ? `.${tenths}` : '');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function parseTime(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(':');
  if (parts.length > 3 || parts.some((part) => part === '' || !/^\d+(\.\d+)?$/.test(part))) {
    return null;
  }
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}
