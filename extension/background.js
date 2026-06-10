const bridgeUrl = 'http://127.0.0.1:38473';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'clipforge-status') {
    relay(`${bridgeUrl}/status`, undefined, sendResponse);
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
