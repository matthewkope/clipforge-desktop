// ClipForge YouTube clip picker.
// Adds a scissor button to the player controls; clicking it opens a panel to
// pick a start/end range, choose a saved ClipForge preset, and send the clip
// to the desktop app for a section download.
// Note: YouTube enforces Trusted Types, so all DOM here is built with
// createElement/createElementNS — innerHTML would throw.

const SELECTION_STORAGE_KEY = 'clipforgeClipSelection';
const SVG_NS = 'http://www.w3.org/2000/svg';

let panel = null;
let barOverlay = null;
let previewStopHandler = null;

const observer = new MutationObserver(() => {
  ensureScissorButton();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('yt-navigate-finish', () => {
  closePanel();
  ensureScissorButton();
});
ensureScissorButton();

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

function currentVideoId() {
  const url = new URL(location.href);
  if (url.pathname === '/watch') {
    return url.searchParams.get('v');
  }
  const shortsMatch = url.pathname.match(/^\/shorts\/([\w-]{6,})/);
  return shortsMatch ? shortsMatch[1] : null;
}

function playerVideo() {
  return document.querySelector('.html5-video-player video.html5-main-video') || document.querySelector('video');
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
  const container = document.querySelector('.html5-video-player');
  if (!video || !container || !currentVideoId()) {
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
  barOverlay = createBarMarkers(video, sliderMax, range, () => {
    startRow.input.value = formatTime(range.start);
    endRow.input.value = formatTime(range.end);
  });

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
  container.appendChild(panel);

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
  sendButton.addEventListener('click', () => {
    void sendClip(startRow.input, endRow.input, presetSelect, sendButton, video);
  });

  await populateOutputs(presetSelect, sendButton);
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
    handle.appendChild(el('div', 'clipforge-bar-handle-grip'));
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
  } else if (body.downloadActive) {
    showPanelStatus('Wait for the active ClipForge download to finish.', 'error');
  } else {
    sendButton.disabled = false;
    showPanelStatus('');
  }
}

async function sendClip(startInput, endInput, presetSelect, sendButton, video) {
  const range = readRange(startInput, endInput, video);
  if (!range) {
    return;
  }
  const videoId = currentVideoId();
  if (!videoId) {
    showPanelStatus('Could not detect the YouTube video ID.', 'error');
    return;
  }
  const selection = presetSelect.value.startsWith('preset:')
    ? { presetId: presetSelect.value.slice('preset:'.length) }
    : { format: presetSelect.value.slice('format:'.length) || 'mp4' };

  sendButton.disabled = true;
  showPanelStatus('Sending clip to ClipForge…');
  const response = await chrome.runtime
    .sendMessage({
      type: 'clipforge-download',
      payload: {
        url: `https://www.youtube.com/watch?v=${videoId}`,
        source: 'youtube-player',
        clipStart: range.start,
        clipEnd: range.end,
        ...selection
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
