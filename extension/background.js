const bridgeUrl = 'http://127.0.0.1:38473';
const contextMenuId = 'clipforge-download';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: contextMenuId,
      title: 'Download with ClipForge',
      contexts: ['link', 'video', 'page']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== contextMenuId) {
    return;
  }
  const url = info.linkUrl || info.srcUrl || info.pageUrl;
  void sendContextDownload(url);
});

async function sendContextDownload(url) {
  let message;
  try {
    const response = await fetch(`${bridgeUrl}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, source: 'active-tab', format: 'mp4' })
    });
    const body = await response.json().catch(() => ({}));
    message = response.ok ? 'Sent to ClipForge' : body.error || 'ClipForge rejected the download.';
  } catch {
    message = 'Open the ClipForge desktop app first.';
  }
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'ClipForge',
    message
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept messages from this extension's own pages/content scripts.
  if (sender.id !== chrome.runtime.id) {
    return false;
  }
  if (message?.type === 'clipforge-status') {
    relay(`${bridgeUrl}/status`, undefined, sendResponse);
    return true;
  }
  if (message?.type === 'clipforge-transcript') {
    relay(
      `${bridgeUrl}/transcript`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.payload)
      },
      sendResponse
    );
    return true;
  }
  if (message?.type === 'clipforge-download') {
    relay(
      `${bridgeUrl}/download`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.payload)
      },
      sendResponse
    );
    return true;
  }
  return false;
});

async function relay(url, init, sendResponse) {
  try {
    const response = await fetch(url, init);
    const body = await response.json();
    sendResponse({ ok: response.ok, body });
  } catch {
    sendResponse({ ok: false, body: { error: 'Open the ClipForge desktop app first.' } });
  }
}
