/**
 * Email TAT Tracker - Popup Controller (Enhanced UI)
 */

document.addEventListener('DOMContentLoaded', async () => {
  const todayKey = TatUtils.formatDateKey(Date.now());
  document.getElementById('today-date-label').innerText = todayKey;

  // Load settings & threads data
  const settings = await TatUtils.getSettings();
  const slaHours = settings.slaThresholdHours || 2;
  const agentDisplay = document.getElementById('popup-agent-email-display');
  if (agentDisplay && settings.agentEmails && settings.agentEmails.length > 0) {
    agentDisplay.innerText = `Tracking: ${settings.agentEmails[0]}`;
  }
  const threadsMap = await TatUtils.getAllThreads();
  const allThreads = Object.values(threadsMap);

  // Compute Today's Stats (includes threads opened today OR reopened/replied today)
  const todayThreads = allThreads.filter(t => t.dateKey === todayKey || (Array.isArray(t.activeDates) && t.activeDates.includes(todayKey)));
  const totalTodayQueries = todayThreads.length;
  
  // Reverts and Reopens
  let totalTodayReverts = 0;
  let totalTodayReopened = 0;
  let totalTatMs = 0;
  let tatCount = 0;
  let withinSlaCount = 0;

  todayThreads.forEach(t => {
    totalTodayReverts += (t.agentReplyCount || 0);
    totalTodayReopened += (t.customerReopenCount || 0);
    if (t.firstResponseTimeMs !== null && t.firstResponseTimeMs !== undefined) {
      totalTatMs += t.firstResponseTimeMs;
      tatCount++;
      if (t.firstResponseTimeMs <= slaHours * 3600 * 1000) {
        withinSlaCount++;
      }
    }
  });

  const avgTatMs = tatCount > 0 ? (totalTatMs / tatCount) : 0;
  const slaPct = tatCount > 0 ? Math.round((withinSlaCount / tatCount) * 100) : 100;

  // Update UI Elements
  document.getElementById('metric-today-queries').innerText = totalTodayQueries;
  document.getElementById('metric-today-avg-tat').innerText = tatCount > 0 ? TatUtils.formatDuration(avgTatMs) : '0m';
  document.getElementById('metric-today-reverts').innerText = totalTodayReverts;
  document.getElementById('metric-today-reopened').innerText = totalTodayReopened;
  document.getElementById('recent-count').innerText = `${allThreads.length} total`;

  // Update SLA Progress
  const slaPctElem = document.getElementById('sla-compliance-pct');
  const slaFillElem = document.getElementById('sla-progress-fill');
  if (slaPctElem && slaFillElem) {
    slaPctElem.innerText = `${slaPct}%`;
    slaFillElem.style.width = `${slaPct}%`;
    if (slaPct < 75) {
      slaFillElem.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
      slaPctElem.style.color = '#dc2626';
    } else if (slaPct < 90) {
      slaFillElem.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
      slaPctElem.style.color = '#d97706';
    } else {
      slaFillElem.style.background = 'linear-gradient(90deg, #10b981, #059669)';
      slaPctElem.style.color = '#16a34a';
    }
  }

  // Render Recent List
  renderRecentList(allThreads);

  // Check Active Tab (Gmail)
  checkActiveGmailTab();

  // Button Listeners
  document.getElementById('btn-export-csv').addEventListener('click', () => {
    if (allThreads.length === 0) {
      alert('No email TAT data recorded yet to export.');
      return;
    }
    const csvContent = TatUtils.exportToCSV(allThreads);
    TatUtils.downloadCSVFile(csvContent, `email_tat_all_${todayKey}.csv`);
  });

  document.getElementById('btn-open-dashboard').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
  });

  document.getElementById('btn-open-dashboard-header').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
  });
});

function renderRecentList(allThreads) {
  const listContainer = document.getElementById('recent-list');
  if (!allThreads || allThreads.length === 0) {
    listContainer.innerHTML = '<div class="empty-state">No emails tracked yet. Open an email thread in Gmail to start tracking!</div>';
    return;
  }

  // Sort by latest activity desc
  const sorted = [...allThreads].sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0)).slice(0, 5);

  listContainer.innerHTML = sorted.map(t => {
    const tagClass = t.tagClassification || TatUtils.classifyThreadTags(t.tags || [], t);
    const isResolved = tagClass.isResolved;
    const tatDisplay = t.avgReplyTatMs ? TatUtils.formatDuration(t.avgReplyTatMs) : (t.firstResponseTimeMs ? TatUtils.formatDuration(t.firstResponseTimeMs) : 'Follow Up');
    const badgeClass = isResolved ? 'pill-resolved' : 'pill-pending';
    const statusText = tagClass.primaryLabel || (isResolved ? 'Resolved' : 'Follow Up');
    const initials = TatUtils.getInitials(t.customerName, t.customerEmail);
    const color = TatUtils.getAvatarColor(t.customerEmail || t.customerName);

    return `
      <div class="recent-item">
        <div class="avatar-bubble" style="background-color: ${color.bg}; color: ${color.text}; border-color: ${color.border};">
          ${initials}
        </div>
        <div class="recent-content">
          <div class="recent-header">
            <span class="recent-subj" title="${t.subject}">${t.subject || '(No Subject)'}</span>
            <span class="status-pill ${badgeClass}">${statusText}</span>
          </div>
          <div class="recent-footer">
            <span>${t.customerName || t.customerEmail}</span>
            <span class="recent-tat">Avg TAT: ${tatDisplay} • ↩️ ${t.agentReplyCount || 0}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Request active thread information from Gmail tab
async function checkActiveGmailTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('mail.google.com')) return;

    chrome.tabs.sendMessage(tab.id, { action: 'GET_ACTIVE_THREAD_DATA' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.data) return;

      const data = response.data;
      const activeSection = document.getElementById('active-thread-section');
      activeSection.style.display = 'block';

      document.getElementById('active-subject').innerText = data.subject || '(No Subject)';
      document.getElementById('active-customer').innerText = data.customerEmail || 'Customer';

      const tagClass = data.tagClassification || TatUtils.classifyThreadTags(data.tags || [], data);
      const isResolved = tagClass.isResolved;
      const statusBadge = document.getElementById('active-status-badge');
      statusBadge.innerText = tagClass.primaryLabel || (isResolved ? 'Resolved' : 'Follow Up Needed');
      statusBadge.className = `status-pill ${isResolved ? 'pill-resolved' : 'pill-pending'}`;

      document.getElementById('active-tat-val').innerText = data.firstResponseTimeMs 
        ? TatUtils.formatDuration(data.firstResponseTimeMs) 
        : (data.currentPendingDurationMs ? `⏳ ${TatUtils.formatDuration(data.currentPendingDurationMs)}` : '--');

      document.getElementById('active-reverts-val').innerText = data.agentReplyCount || 0;
      document.getElementById('active-reopened-val').innerText = data.customerReopenCount || 0;
    });
  } catch (e) {
    // Tab querying or messaging error ignored
  }
}
