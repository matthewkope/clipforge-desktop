// All communication with the ClipForge desktop app goes through Chrome Native
// Messaging: the browser spawns the native host (extension/native-host) which
// relays to the app's Unix socket. There is no localhost HTTP server anymore.
const HOST_NAME = 'com.clipforge.host';
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
  const response = await callHost({ type: 'clipforge-download', payload: { url, source: 'active-tab', format: 'mp4' } });
  const message = response.ok ? 'Sent to ClipForge' : response.body?.error || 'ClipForge rejected the download.';
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
  if (
    message?.type === 'clipforge-status' ||
    message?.type === 'clipforge-transcript' ||
    message?.type === 'clipforge-download'
  ) {
    callHost(message).then(sendResponse);
    return true;
  }
  return false;
});

// Sends one message to the native host and resolves to { ok, body } — the same
// shape the old HTTP relay returned, so callers are unchanged. A missing host
// or a stopped app both resolve to a friendly error instead of throwing.
function callHost(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false, body: { error: 'Open the ClipForge desktop app first.' } });
        } else {
          resolve(response);
        }
      });
    } catch {
      resolve({ ok: false, body: { error: 'The ClipForge native host is not installed.' } });
    }
  });
}
