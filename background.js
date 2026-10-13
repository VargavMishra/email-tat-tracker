/**
 * Email TAT & SLA Tracker - Background Service Worker
 */

importScripts('utils.js');

// On installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Email TAT Tracker] Extension installed successfully.');
  updateBadge();
});

// Update badge when storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.threads) {
    updateBadge();
  }
});

// Open dashboard or handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    sendResponse({ success: true });
  } else if (request.action === 'UPDATE_BADGE') {
    updateBadge();
    sendResponse({ success: true });
  }
  return true;
});

// Update extension icon badge with pending queries count
async function updateBadge() {
  try {
    const threads = await TatUtils.getAllThreads();
    const list = Object.values(threads);
    const pendingCount = list.filter(t => t.status === 'PENDING_REPLY').length;

    if (pendingCount > 0) {
      chrome.action.setBadgeText({ text: String(pendingCount) });
      chrome.action.setBadgeBackgroundColor({ color: '#EA8600' }); // Warning Amber
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.error('[Email TAT Tracker] Error updating badge:', err);
  }
}
