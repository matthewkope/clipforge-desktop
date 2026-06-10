const bridgeUrl = 'http://127.0.0.1:38473';
const formatsSection = document.querySelector('.formats');
const formatButtons = [...document.querySelectorAll('.format-option')];
const presetBar = document.querySelector('.preset-bar');
const usePresetCheckbox = document.querySelector('#use-preset');
const presetSelect = document.querySelector('#preset');
const activeTabButton = document.querySelector('#active-tab');
const clipboardButton = document.querySelector('#clipboard');
const status = document.querySelector('#status');
const selectedFormatStorageKey = 'selectedFormat';
const selectedPresetStorageKey = 'selectedPresetId';
const usePresetStorageKey = 'usePreset';
const allowedFormats = new Set(['mp4', 'mp3', 'markdown']);
let selectedFormat = restoreSelectedFormat();
let presets = [];
let ready = false;

selectFormat(selectedFormat, false);
void loadStatus();

formatButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setPresetMode(false);
    selectFormat(button.dataset.format);
  });
});

usePresetCheckbox.addEventListener('change', () => {
  setPresetMode(usePresetCheckbox.checked);
});

for (const eventName of ['pointerdown', 'focus']) {
  presetSelect.addEventListener(eventName, () => {
    if (ready && presets.length > 0 && !usePresetCheckbox.checked) {
      setPresetMode(true);
    }
  });
}

presetSelect.addEventListener('change', () => {
  localStorage.setItem(selectedPresetStorageKey, presetSelect.value);
  setPresetMode(true);
});

activeTabButton.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      throw new Error('The active tab does not have a downloadable URL.');
    }
    await sendDownload(tab.url, 'active-tab');
  } catch (error) {
    showStatus(errorMessage(error), 'error');
  }
});

clipboardButton.addEventListener('click', async () => {
  try {
    const clipboardText = await navigator.clipboard.readText();
    const url = firstUrl(clipboardText);
    if (!url) {
      throw new Error('The clipboard does not contain an HTTP or HTTPS URL.');
    }
    await sendDownload(url, 'clipboard');
  } catch (error) {
    showStatus(errorMessage(error), 'error');
  }
});

async function loadStatus() {
  try {
    const response = await fetch(`${bridgeUrl}/status`);
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'Could not connect to ClipForge.');
    }

    presets = Array.isArray(body.presets) ? body.presets : [];
    populatePresets();
    ready = body.ready && body.saveFolderConfigured && !body.downloadActive;
    const storedPresetMode = localStorage.getItem(usePresetStorageKey) === 'true';
    setPresetMode(storedPresetMode && presets.length > 0, false);
    setControlsDisabled(!ready);

    if (!body.ready) {
      showStatus('Open ClipForge to use the extension.', 'error');
    } else if (!body.saveFolderConfigured) {
      showStatus('Choose a save folder in ClipForge first.', 'error');
    } else if (body.downloadActive) {
      showStatus('Wait for the active ClipForge download to finish.', 'error');
    } else {
      showStatus('');
    }
  } catch {
    ready = false;
    setControlsDisabled(true);
    showStatus('Open the ClipForge desktop app, then reopen this popup.', 'error');
  }
}

function populatePresets() {
  presetSelect.replaceChildren();
  for (const preset of presets) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = `${preset.name} · ${preset.formats.join(' + ').toUpperCase()}`;
    presetSelect.append(option);
  }

  const storedPresetId = localStorage.getItem(selectedPresetStorageKey);
  if (storedPresetId && presets.some((preset) => preset.id === storedPresetId)) {
    presetSelect.value = storedPresetId;
  } else if (presets.length > 0) {
    presetSelect.value = presets[0].id;
    localStorage.setItem(selectedPresetStorageKey, presetSelect.value);
  } else {
    presetSelect.append(new Option('No presets saved'));
    localStorage.removeItem(selectedPresetStorageKey);
  }
}

async function sendDownload(url, source) {
  const usePreset = usePresetCheckbox.checked;
  if (usePreset && !presetSelect.value) {
    throw new Error('Choose a saved preset.');
  }

  setControlsDisabled(true);
  showStatus('Sending URL to ClipForge...');
  try {
    const selection = usePreset ? { presetId: presetSelect.value } : { format: selectedFormat };
    const response = await fetch(`${bridgeUrl}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, source, ...selection })
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'ClipForge rejected the download.');
    }
    showStatus(
      body.preset ? `Sent to ClipForge with “${body.preset}”.` : `Sent to ClipForge as ${formatLabel(body.format)}.`,
      'success'
    );
  } finally {
    setControlsDisabled(!ready);
  }
}

function setControlsDisabled(disabled) {
  activeTabButton.disabled = disabled;
  clipboardButton.disabled = disabled;
  formatButtons.forEach((button) => {
    button.disabled = disabled;
  });
  usePresetCheckbox.disabled = disabled || presets.length === 0;
  presetSelect.disabled = disabled || presets.length === 0;
}

function setPresetMode(enabled, persist = true) {
  const active = enabled && presets.length > 0;
  usePresetCheckbox.checked = active;
  formatsSection.classList.toggle('preset-active', active);
  presetBar.classList.toggle('inactive', !active);
  presetSelect.disabled = !ready || presets.length === 0;
  if (persist) {
    localStorage.setItem(usePresetStorageKey, String(active));
  }
  showStatus('');
}

function restoreSelectedFormat() {
  const stored = localStorage.getItem(selectedFormatStorageKey);
  return allowedFormats.has(stored) ? stored : 'mp4';
}

function selectFormat(format, persist = true) {
  if (!allowedFormats.has(format)) {
    return;
  }
  selectedFormat = format;
  if (persist) {
    localStorage.setItem(selectedFormatStorageKey, format);
  }
  formatButtons.forEach((button) => {
    const selected = button.dataset.format === format;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function formatLabel(format) {
  return format === 'markdown' ? 'Markdown' : format.toUpperCase();
}

function firstUrl(value) {
  const match = value.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) {
    return null;
  }
  try {
    return new URL(match[0]).toString();
  } catch {
    return null;
  }
}

function showStatus(message, kind = '') {
  status.textContent = message;
  status.className = kind;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
