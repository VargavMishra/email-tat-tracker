/**
 * Email TAT Tracker - Full Analytics Dashboard Controller (Premium UI Edition)
 */

(function () {
  'use strict';

  let allThreadsMap = {};
  let currentFilteredThreads = [];
  let currentSettings = {};

  // Sorting state
  let dateSummarySort = { column: 'date', order: 'desc' };
  let threadLogSort = { column: 'threadDate', order: 'desc' };

  document.addEventListener('DOMContentLoaded', async () => {
    await init();
  });

  async function init() {
    initTheme();
    currentSettings = await TatUtils.getSettings();
    TatUtils._cachedSettings = currentSettings;
    updateSlaBadge();
    await reloadData();
    setupEventListeners();
  }

  // Theme Management (Light / Dark)
  function initTheme() {
    const savedTheme = localStorage.getItem('tat_theme') || 'light';
    setTheme(savedTheme);

    const toggleBtn = document.getElementById('btn-theme-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        setTheme(next);
      });
    }
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('tat_theme', theme);
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    if (icon && label) {
      icon.innerText = theme === 'dark' ? '☀️' : '🌙';
      label.innerText = theme === 'dark' ? 'Light' : 'Dark';
    }
  }

  function updateSlaBadge() {
    const badge = document.getElementById('sla-target-badge');
    const hours = currentSettings.slaThresholdHours || 2;
    if (badge) badge.innerText = `SLA: < ${hours}h`;

    const bhBadge = document.getElementById('business-hours-badge');
    if (bhBadge) {
      if (currentSettings.useBusinessHours !== false) {
        const start = currentSettings.businessHoursStart || '09:30';
        const end = currentSettings.businessHoursEnd || '18:30';
        bhBadge.style.display = 'inline-flex';
        bhBadge.innerHTML = `<span>🏢 Shift: ${start}–${end}</span>`;
        bhBadge.title = `Business hours enabled (${start} to ${end}, excluding off-days & nights)`;
      } else {
        bhBadge.style.display = 'inline-flex';
        bhBadge.innerHTML = `<span>🕒 24/7 Clock</span>`;
        bhBadge.title = '24/7 Calendar Clock active (all nights & weekends counted)';
      }
    }
  }

  let livePollInterval = null;
  let lastStorageFingerprint = '';

  async function reloadData(silent = false) {
    allThreadsMap = await TatUtils.getAllThreads();
    const currentFingerprint = generateFingerprint(allThreadsMap);
    if (!silent || currentFingerprint !== lastStorageFingerprint) {
      lastStorageFingerprint = currentFingerprint;
      applyFilters();
    }
  }

  function generateFingerprint(threadsMap) {
    if (!threadsMap) return '';
    return Object.keys(threadsMap).sort().map(k => {
      const t = threadsMap[k];
      return `${k}:${t.lastUpdated || 0}:${t.agentReplyCount || 0}:${(t.tags || []).join(',')}:${t.status}`;
    }).join('|');
  }

  function setupEventListeners() {
    // 1. Live storage updates when Gmail tab scans or saves a thread
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.threads || changes.settings)) {
          if (changes.settings && changes.settings.newValue) {
            currentSettings = changes.settings.newValue;
            updateSlaBadge();
          }
          reloadData(false);
        }
      });
    }

    // 2. Real-time background sync interval (checks every 2.5 seconds with zero UI stutter)
    if (livePollInterval) clearInterval(livePollInterval);
    livePollInterval = setInterval(() => {
      reloadData(true);
    }, 2500);

    // 3. Refresh whenever user switches back to the Dashboard tab
    window.addEventListener('focus', () => reloadData(false));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reloadData(false);
    });

    // 4. "Sync Now" button in navbar: scans open Gmail tabs and reloads
    const refreshBtn = document.getElementById('btn-refresh-data');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.classList.add('loading');
        refreshBtn.innerHTML = '<span>⏳ Syncing...</span>';

        // Message open Gmail tabs to force scan active conversation
        try {
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
            chrome.tabs.query({ url: '*://mail.google.com/*' }, (tabs) => {
              if (tabs && tabs.length > 0) {
                tabs.forEach(tab => {
                  try {
                    chrome.tabs.sendMessage(tab.id, { action: 'FORCE_SCAN_THREAD' }, () => {
                      if (chrome.runtime?.lastError) {}
                    });
                  } catch (e) {}
                });
              }
            });
          }
        } catch (e) {}

        setTimeout(async () => {
          await reloadData(false);
          refreshBtn.classList.remove('loading');
          refreshBtn.innerHTML = '<span>✓ Synced</span>';
          setTimeout(() => { refreshBtn.innerHTML = '<span>🔄 Sync Now</span>'; }, 1500);
          showToast('Real-time data synced with Gmail!', 'success');
        }, 500);
      });
    }

    // Close open All Replies dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      const clickedDropdown = e.target.closest('details.dash-replies-dropdown');
      document.querySelectorAll('details.dash-replies-dropdown[open]').forEach(d => {
        if (d !== clickedDropdown) d.removeAttribute('open');
      });
    });

    // Range selector change
    const rangeSelect = document.getElementById('filter-range');
    const customContainer = document.getElementById('custom-date-container');
    rangeSelect.addEventListener('change', () => {
      if (rangeSelect.value === 'custom') {
        customContainer.style.display = 'flex';
      } else {
        customContainer.style.display = 'none';
      }
      applyFilters();
    });

    // Filters
    document.getElementById('filter-start-date').addEventListener('change', applyFilters);
    document.getElementById('filter-end-date').addEventListener('change', applyFilters);
    document.getElementById('filter-status').addEventListener('change', applyFilters);
    document.getElementById('search-input').addEventListener('input', applyFilters);

    document.getElementById('btn-apply-filters').addEventListener('click', applyFilters);
    document.getElementById('btn-reset-filters').addEventListener('click', () => {
      document.getElementById('filter-range').value = 'today';
      customContainer.style.display = 'none';
      document.getElementById('filter-status').value = 'all';
      document.getElementById('search-input').value = '';
      applyFilters();
      showToast('Filters reset to Today', 'info');
    });

    // CSV Exports
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      if (currentFilteredThreads.length === 0) {
        showToast('No email data available to export.', 'warning');
        return;
      }
      const csv = TatUtils.exportToCSV(currentFilteredThreads);
      const filename = `email_tat_export_${TatUtils.formatDateKey(Date.now())}.csv`;
      TatUtils.downloadCSVFile(csv, filename);
      showToast(`Exported ${currentFilteredThreads.length} threads to CSV!`, 'success');
    });

    document.getElementById('btn-export-date-summary').addEventListener('click', exportDateSummaryCSV);

    // Modal Close
    document.getElementById('modal-close').addEventListener('click', () => {
      document.getElementById('timeline-modal').style.display = 'none';
    });
    document.getElementById('timeline-modal').addEventListener('click', (e) => {
      if (e.target.id === 'timeline-modal') {
        document.getElementById('timeline-modal').style.display = 'none';
      }
    });

    // Settings Modal
    document.getElementById('btn-settings-toggle').addEventListener('click', openSettingsModal);
    document.getElementById('settings-close').addEventListener('click', () => {
      document.getElementById('settings-modal').style.display = 'none';
    });
    document.getElementById('settings-modal').addEventListener('click', (e) => {
      if (e.target.id === 'settings-modal') {
        document.getElementById('settings-modal').style.display = 'none';
      }
    });

    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-load-sample-data').addEventListener('click', loadSampleData);
    document.getElementById('btn-clear-all-data').addEventListener('click', clearAllData);

    const bhToggle = document.getElementById('setting-business-hours-enable');
    const bhWrap = document.getElementById('business-hours-config-wrap');
    if (bhToggle && bhWrap) {
      bhToggle.addEventListener('change', () => {
        bhWrap.style.display = bhToggle.checked ? 'flex' : 'none';
      });
    }

    // Table Header Sorting Listeners
    setupTableSorting();
  }

  function setupTableSorting() {
    // Date Summary Table Sorting
    document.querySelectorAll('#date-summary-table th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort');
        if (dateSummarySort.column === col) {
          dateSummarySort.order = dateSummarySort.order === 'asc' ? 'desc' : 'asc';
        } else {
          dateSummarySort.column = col;
          dateSummarySort.order = 'desc';
        }
        updateSortIcons('#date-summary-table', dateSummarySort);
        renderDateSummaryTable(currentFilteredThreads);
      });
    });

    // Threads Table Sorting
    document.querySelectorAll('#threads-table th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort');
        if (threadLogSort.column === col) {
          threadLogSort.order = threadLogSort.order === 'asc' ? 'desc' : 'asc';
        } else {
          threadLogSort.column = col;
          threadLogSort.order = 'desc';
        }
        updateSortIcons('#threads-table', threadLogSort);
        renderThreadLogsTable(currentFilteredThreads);
      });
    });
  }

  function updateSortIcons(tableSelector, sortState) {
    document.querySelectorAll(`${tableSelector} th.sortable`).forEach(th => {
      const col = th.getAttribute('data-sort');
      const icon = th.querySelector('.sort-icon');
      if (icon) {
        if (col === sortState.column) {
          icon.innerText = sortState.order === 'asc' ? '▲' : '▼';
        } else {
          icon.innerText = '⇅';
        }
      }
    });
  }

  // Helper: check if a dateKey matches the current active date filter
  function isDateInSelectedRange(d) {
    if (!d) return false;
    const range = document.getElementById('filter-range').value;
    const now = new Date();
    const todayStr = TatUtils.formatDateKey(now.getTime());

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = TatUtils.formatDateKey(yesterday.getTime());

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = TatUtils.formatDateKey(sevenDaysAgo.getTime());

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = TatUtils.formatDateKey(thirtyDaysAgo.getTime());

    const customStart = document.getElementById('filter-start-date').value;
    const customEnd = document.getElementById('filter-end-date').value;

    if (range === 'today') return d === todayStr;
    if (range === 'yesterday') return d === yesterdayStr;
    if (range === 'last7') return d >= sevenDaysAgoStr;
    if (range === 'last30') return d >= thirtyDaysAgoStr;
    if (range === 'custom') {
      if (customStart && d < customStart) return false;
      if (customEnd && d > customEnd) return false;
      return true;
    }
    return true;
  }

  function applyFilters() {
    const rawList = Object.values(allThreadsMap);
    const status = document.getElementById('filter-status').value;
    const query = document.getElementById('search-input').value.trim().toLowerCase();

    currentFilteredThreads = rawList.filter(t => {
      const primaryDate = t.dateKey || TatUtils.formatDateKey(t.latestAgentTime || t.latestCustomerTime || t.initialCustomerTime || t.lastUpdated);
      const threadDates = Array.isArray(t.activeDates) && t.activeDates.length > 0
        ? t.activeDates
        : [primaryDate, t.initialDateKey].filter(Boolean);

      // 1. Date Range Filter
      const matchesDate = threadDates.some(d => isDateInSelectedRange(d));
      if (!matchesDate) return false;

      const tagClass = t.tagClassification || TatUtils.classifyThreadTags(t.tags || [], t);

      // 2. Status & Tag Matrix Filter
      if (status === 'RESOLVED' && !tagClass.isResolved) return false;
      if (status === 'FOLLOWUP_ALL' && !tagClass.isFollowUpNeeded) return false;
      if (status === 'FOLLOWUP_GENERAL' && !tagClass.isFollowUpGeneral) return false;
      if (status === 'FOLLOWUP_RETURN' && !tagClass.isFollowUpReturn) return false;
      if (status === 'FOLLOWUP_REPLACEMENT' && !tagClass.isFollowUpReplacement) return false;
      if (status === 'PAYMENT_PENDING' && !tagClass.isPaymentPending) return false;
      if (status === 'REOPENED' && (!t.customerReopenCount || t.customerReopenCount === 0)) return false;

      // 3. Search Query (Matches subject, customer name, email, or Gmail tag)
      if (query) {
        const subj = (t.subject || '').toLowerCase();
        const email = (t.customerEmail || '').toLowerCase();
        const name = (t.customerName || '').toLowerCase();
        const matchTag = (t.tags || []).some(tg => String(tg).toLowerCase().includes(query));
        if (!subj.includes(query) && !email.includes(query) && !name.includes(query) && !matchTag) {
          return false;
        }
      }

      return true;
    });

    // Render components
    renderKpiMetrics(currentFilteredThreads);
    renderVolumeChart(currentFilteredThreads);
    renderSlaDistribution(currentFilteredThreads);
    renderDateSummaryTable(currentFilteredThreads);
    renderThreadLogsTable(currentFilteredThreads);
  }

  // Render top KPI stats (Real-time Matrix: Threads, Customer Mails, Agent Replied, Avg Reply TAT, Resolved, Follow Up Needed, Payment Pending)
  // Calculates TAT specifically for the active date filter (Today by default)
  function renderKpiMetrics(threads) {
    const range = document.getElementById('filter-range').value;
    const now = Date.now();
    const todayStr = TatUtils.formatDateKey(now);
    const yesterdayStr = TatUtils.formatDateKey(now - 86400000);

    const dateGroups = buildDateSummaryGroups(threads);

    let targetGroupKeys = [];
    let rangeLabel = 'Today';
    if (range === 'today') {
      targetGroupKeys = [todayStr];
      rangeLabel = `Today (${todayStr})`;
    } else if (range === 'yesterday') {
      targetGroupKeys = [yesterdayStr];
      rangeLabel = `Yesterday (${yesterdayStr})`;
    } else if (range === 'last7') {
      targetGroupKeys = Object.keys(dateGroups).filter(d => isDateInSelectedRange(d));
      rangeLabel = 'Last 7 Days';
    } else if (range === 'last30') {
      targetGroupKeys = Object.keys(dateGroups).filter(d => isDateInSelectedRange(d));
      rangeLabel = 'Last 30 Days';
    } else if (range === 'custom') {
      targetGroupKeys = Object.keys(dateGroups).filter(d => isDateInSelectedRange(d));
      const s = document.getElementById('filter-start-date').value;
      const e = document.getElementById('filter-end-date').value;
      rangeLabel = (s && e && s === e) ? s : (s && e ? `${s} to ${e}` : 'Custom Range');
    } else {
      targetGroupKeys = Object.keys(dateGroups);
      rangeLabel = 'All Time';
    }

    let totalThreads = 0;
    let totalCustomerMails = 0;
    let totalAgentReplies = 0;
    let totalAllRepliesTatMs = 0;
    let totalAllRepliesCount = 0;
    let totalFirstTatMs = 0;
    let firstTatCount = 0;
    let totalLastTatMs = 0;
    let lastTatCount = 0;
    let resolvedCount = 0;
    let followupTotal = 0;
    let followupGeneral = 0;
    let followupReturn = 0;
    let followupReplacement = 0;
    let paymentPendingCount = 0;

    targetGroupKeys.forEach(dk => {
      const g = dateGroups[dk];
      if (!g) return;
      totalThreads += g.threads;
      totalCustomerMails += g.custMails;
      totalAgentReplies += g.reverts;
      totalAllRepliesTatMs += g.totalAllRepliesTatMs;
      totalAllRepliesCount += g.allRepliesCount;
      totalFirstTatMs += g.totalFirstTatMs;
      firstTatCount += g.firstTatCount;
      totalLastTatMs += g.totalLastTatMs;
      lastTatCount += g.lastTatCount;
      resolvedCount += g.resolved;
      followupTotal += g.followupTotal;
      followupGeneral += g.followupGen;
      followupReturn += g.followupRet;
      followupReplacement += g.followupRepl;
      paymentPendingCount += g.payPending;
    });

    // If viewing single date with no grouped records yet, fallback gracefully
    if (totalThreads === 0 && (range === 'today' || range === 'yesterday')) {
      const singleDate = range === 'today' ? todayStr : yesterdayStr;
      threads.forEach(t => {
        const initD = t.initialDateKey || TatUtils.formatDateKey(t.initialCustomerTime);
        if (initD === singleDate || (t.activeDates && t.activeDates.includes(singleDate))) {
          totalThreads++;
          const tagClass = t.tagClassification || TatUtils.classifyThreadTags(t.tags || [], t);
          if (tagClass.isResolved) resolvedCount++;
          if (tagClass.isFollowUpNeeded) followupTotal++;
          if (tagClass.isFollowUpGeneral) followupGeneral++;
          if (tagClass.isFollowUpReturn) followupReturn++;
          if (tagClass.isFollowUpReplacement) followupReplacement++;
          if (tagClass.isPaymentPending) paymentPendingCount++;
        }
      });
    }

    const avgAllReplyTatMs = totalAllRepliesCount > 0 ? (totalAllRepliesTatMs / totalAllRepliesCount) : 0;
    const avgFirstTatMs = firstTatCount > 0 ? (totalFirstTatMs / firstTatCount) : 0;
    const avgLastTatMs = lastTatCount > 0 ? (totalLastTatMs / lastTatCount) : 0;
    const resRate = totalThreads > 0 ? Math.round((resolvedCount / totalThreads) * 100) : 0;

    // Update KPI Card Values
    const totalThreadsEl = document.getElementById('kpi-total-threads');
    if (totalThreadsEl) totalThreadsEl.innerText = totalThreads;
    const threadsCap = document.getElementById('kpi-threads-caption');
    if (threadsCap) threadsCap.innerText = `${rangeLabel} active threads`;

    const custMailsEl = document.getElementById('kpi-customer-mails');
    if (custMailsEl) custMailsEl.innerText = totalCustomerMails;
    const custCap = document.getElementById('kpi-custmails-caption');
    if (custCap) custCap.innerText = `${rangeLabel} queries received`;

    const totalRevertsEl = document.getElementById('kpi-total-reverts');
    if (totalRevertsEl) totalRevertsEl.innerText = totalAgentReplies;
    const revertsCap = document.getElementById('kpi-reverts-caption');
    if (revertsCap) revertsCap.innerText = `${rangeLabel} replies sent`;

    const tatTitle = document.getElementById('kpi-tat-title');
    if (tatTitle) {
      tatTitle.innerText = range === 'today'
        ? "Today's Avg Reply TAT"
        : (range === 'yesterday' ? "Yesterday's Avg Reply TAT" : `Avg Reply TAT (${rangeLabel})`);
    }

    const avgAllTatEl = document.getElementById('kpi-avg-all-reply-tat');
    if (avgAllTatEl) {
      avgAllTatEl.innerText = totalAllRepliesCount > 0 ? TatUtils.formatDuration(avgAllReplyTatMs) : '0m';
    }

    const avgFirstEl = document.getElementById('kpi-avg-tat');
    if (avgFirstEl) avgFirstEl.innerText = firstTatCount > 0 ? TatUtils.formatDuration(avgFirstTatMs) : '0m';

    const avgLastEl = document.getElementById('kpi-avg-last-tat');
    if (avgLastEl) avgLastEl.innerText = lastTatCount > 0 ? TatUtils.formatDuration(avgLastTatMs) : '0m';

    const resolvedCountEl = document.getElementById('kpi-resolved-count');
    if (resolvedCountEl) resolvedCountEl.innerText = resolvedCount;

    const resRateEl = document.getElementById('kpi-resolution-rate');
    if (resRateEl) resRateEl.innerText = `${resRate}%`;

    const followupTotalEl = document.getElementById('kpi-followup-total');
    if (followupTotalEl) followupTotalEl.innerText = followupTotal;

    const followupGenEl = document.getElementById('kpi-followup-general');
    if (followupGenEl) followupGenEl.innerText = followupGeneral;

    const followupRetEl = document.getElementById('kpi-followup-return');
    if (followupRetEl) followupRetEl.innerText = followupReturn;

    const followupReplEl = document.getElementById('kpi-followup-replacement');
    if (followupReplEl) followupReplEl.innerText = followupReplacement;

    const payPendingEl = document.getElementById('kpi-payment-pending-count');
    if (payPendingEl) payPendingEl.innerText = paymentPendingCount;
  }

  // Render Interactive Daily Volume Chart (Date-Wise across active dates)
  function renderVolumeChart(threads) {
    const container = document.getElementById('volume-chart-container');
    if (!container) return;

    if (threads.length === 0) {
      container.innerHTML = '<div class="empty-state" style="margin: auto;">No query volume in selected period</div>';
      return;
    }

    // Group queries by active dates within selected filter range
    const dateMap = {};
    threads.forEach(t => {
      const primaryDate = t.dateKey || TatUtils.formatDateKey(t.initialCustomerTime || Date.now());
      const dates = (Array.isArray(t.activeDates) && t.activeDates.length > 0 ? t.activeDates : [primaryDate])
        .filter(d => isDateInSelectedRange(d));
      const targetDates = dates.length > 0 ? dates : [primaryDate];

      const tagClass = t.tagClassification || TatUtils.classifyThreadTags(t.tags || [], t);

      targetDates.forEach(d => {
        if (!dateMap[d]) dateMap[d] = { resolved: 0, followup: 0, total: 0 };
        if (tagClass.isResolved) dateMap[d].resolved++;
        else dateMap[d].followup++;
        dateMap[d].total++;
      });
    });

    const sortedDates = Object.keys(dateMap).sort();
    const maxTotal = Math.max(...sortedDates.map(d => dateMap[d].total), 1);

    container.innerHTML = sortedDates.map(d => {
      const data = dateMap[d];
      const heightPct = Math.max(12, Math.round((data.total / maxTotal) * 100));
      const resPct = data.total > 0 ? (data.resolved / data.total) * 100 : 0;
      const penPct = 100 - resPct;
      const shortDate = d.slice(5); // MM-DD

      return `
        <div class="bar-col" data-date="${d}">
          <div class="bar-tooltip">
            <strong>${d}</strong><br/>
            Active Threads: ${data.total}<br/>
            ✓ Resolved: ${data.resolved}<br/>
            🔔 Follow Up Needed: ${data.followup}
          </div>
          <div class="bar-stack" style="height: ${heightPct}%;">
            <div class="bar-segment-resolved" style="height: ${resPct}%;"></div>
            <div class="bar-segment-pending" style="height: ${penPct}%;"></div>
          </div>
          <span class="bar-label">${shortDate}</span>
        </div>
      `;
    }).join('');
  }

  // Render SLA Distribution Bar & Legend
  function renderSlaDistribution(threads) {
    const bar = document.getElementById('sla-stacked-bar');
    const legendGrid = document.getElementById('sla-legend-grid');
    if (!bar || !legendGrid) return;

    const slaHours = currentSettings.slaThresholdHours || 2;
    const dist = TatUtils.getSlaDistribution(threads, slaHours);
    const totalWithTat = dist.under15 + dist.under60 + dist.underSla + dist.overSla;

    if (totalWithTat === 0) {
      bar.innerHTML = '<div style="width: 100%; height: 100%; background: var(--border); text-align: center; font-size: 11px; line-height: 22px; color: var(--text-muted);">No replies recorded yet</div>';
      legendGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; font-size: 11px; color: var(--text-muted);">Awaiting first responses</div>';
      return;
    }

    const pFast = Math.round((dist.under15 / totalWithTat) * 100);
    const pNorm = Math.round((dist.under60 / totalWithTat) * 100);
    const pWarn = Math.round((dist.underSla / totalWithTat) * 100);
    const pOver = Math.max(0, 100 - pFast - pNorm - pWarn);

    bar.innerHTML = `
      <div class="sla-seg seg-fast" style="width: ${pFast}%;" title="Fast (<15m): ${dist.under15} (${pFast}%)"></div>
      <div class="sla-seg seg-normal" style="width: ${pNorm}%;" title="Normal (15-60m): ${dist.under60} (${pNorm}%)"></div>
      <div class="sla-seg seg-warning" style="width: ${pWarn}%;" title="Moderate (1-${slaHours}h): ${dist.underSla} (${pWarn}%)"></div>
      <div class="sla-seg seg-danger" style="width: ${pOver}%;" title="Over SLA (>${slaHours}h): ${dist.overSla} (${pOver}%)"></div>
    `;

    legendGrid.innerHTML = `
      <div class="sla-legend-box">
        <div class="sla-box-left">
          <span class="sla-color-dot" style="background: #10b981;"></span>
          <span>Fast (&lt;15m)</span>
        </div>
        <span class="sla-box-val" style="color: #10b981;">${dist.under15} (${pFast}%)</span>
      </div>
      <div class="sla-legend-box">
        <div class="sla-box-left">
          <span class="sla-color-dot" style="background: #3b82f6;"></span>
          <span>Standard (15-60m)</span>
        </div>
        <span class="sla-box-val" style="color: #3b82f6;">${dist.under60} (${pNorm}%)</span>
      </div>
      <div class="sla-legend-box">
        <div class="sla-box-left">
          <span class="sla-color-dot" style="background: #f59e0b;"></span>
          <span>Moderate (1-${slaHours}h)</span>
        </div>
        <span class="sla-box-val" style="color: #f59e0b;">${dist.underSla} (${pWarn}%)</span>
      </div>
      <div class="sla-legend-box">
        <div class="sla-box-left">
          <span class="sla-color-dot" style="background: #ef4444;"></span>
          <span>Over SLA (&gt;${slaHours}h)</span>
        </div>
        <span class="sla-box-val" style="color: #ef4444;">${dist.overSla} (${pOver}%)</span>
      </div>
    `;
  }

  // Helper to build Date-Wise groups (including complete Tag Matrix, Customer Mails count, and Avg Reply TAT over all mails)
  function buildDateSummaryGroups(threads) {
    const dateGroups = {};

    threads.forEach(t => {
      const repliesList = Array.isArray(t.repliesList) ? t.repliesList : [];
      const tagClass = t.tagClassification || TatUtils.classifyThreadTags(t.tags || [], t);

      // Collect all dates relevant to this thread
      const datesSet = new Set();
      const initDate = t.initialDateKey || TatUtils.formatDateKey(t.initialCustomerTime);
      const lastCustDate = TatUtils.formatDateKey(t.latestCustomerTime);
      const lastAgentDate = TatUtils.formatDateKey(t.latestAgentTime);

      if (initDate && isDateInSelectedRange(initDate)) datesSet.add(initDate);
      if (lastCustDate && isDateInSelectedRange(lastCustDate)) datesSet.add(lastCustDate);
      if (lastAgentDate && isDateInSelectedRange(lastAgentDate)) datesSet.add(lastAgentDate);

      if (Array.isArray(t.activeDates)) {
        t.activeDates.forEach(ad => {
          if (isDateInSelectedRange(ad)) datesSet.add(ad);
        });
      }

      repliesList.forEach(r => {
        if (r.queryDateKey && isDateInSelectedRange(r.queryDateKey)) datesSet.add(r.queryDateKey);
        if (r.dateKey && isDateInSelectedRange(r.dateKey)) datesSet.add(r.dateKey);
      });

      if (Array.isArray(t.timeline)) {
        t.timeline.forEach(e => {
          const edk = TatUtils.formatDateKey(e.timestamp);
          if (edk && isDateInSelectedRange(edk)) datesSet.add(edk);
        });
      }

      if (datesSet.size === 0) {
        const pDate = t.dateKey || TatUtils.formatDateKey(Date.now());
        if (isDateInSelectedRange(pDate)) datesSet.add(pDate);
      }

      datesSet.forEach(d => {
        if (!dateGroups[d]) {
          dateGroups[d] = {
            date: d,
            threads: 0,
            custMails: 0,
            reverts: 0,
            totalAllRepliesTatMs: 0,
            allRepliesCount: 0,
            totalFirstTatMs: 0,
            firstTatCount: 0,
            totalLastTatMs: 0,
            lastTatCount: 0,
            resolved: 0,
            followupTotal: 0,
            followupGen: 0,
            followupRet: 0,
            followupRepl: 0,
            payPending: 0
          };
        }
        const g = dateGroups[d];
        g.threads++;

        // Customer queries arrived on date d
        let custMailsOnDate = 0;
        if (Array.isArray(t.timeline) && t.timeline.length > 0) {
          custMailsOnDate = t.timeline.filter(e => (e.type === 'CUSTOMER_MSG' || e.type === 'REOPENED') && TatUtils.formatDateKey(e.timestamp) === d).length;
        }
        if (custMailsOnDate > 0) {
          g.custMails += custMailsOnDate;
        } else if (initDate === d) {
          g.custMails += Math.max(1, t.customerQueryCount || 1);
        } else if (lastCustDate === d) {
          g.custMails += 1;
        }

        // Tag matrix counts
        if (tagClass.isResolved) g.resolved++;
        if (tagClass.isFollowUpNeeded) g.followupTotal++;
        if (tagClass.isFollowUpGeneral) g.followupGen++;
        if (tagClass.isFollowUpReturn) g.followupRet++;
        if (tagClass.isFollowUpReplacement) g.followupRepl++;
        if (tagClass.isPaymentPending) g.payPending++;

        // Replies sent on date d vs replies for queries of date d
        const repliesSentOnDate = repliesList.filter(r => r.dateKey === d);
        const repliesForQueriesOnDate = repliesList.filter(r => (r.queryDateKey || r.dateKey) === d);

        if (repliesSentOnDate.length > 0) {
          g.reverts += repliesSentOnDate.length;
        } else if (repliesForQueriesOnDate.length > 0) {
          g.reverts += repliesForQueriesOnDate.length;
        } else if (initDate === d && (t.agentReplyCount || 0) > 0) {
          g.reverts += t.agentReplyCount;
        }

        // Turnaround Time for customer queries of date d:
        // "like for today's mail similar i reply tomorrow for tomorrow / date wise till mail comes i want TAT for that"
        const relevantTatReplies = repliesForQueriesOnDate.length > 0
          ? repliesForQueriesOnDate
          : repliesSentOnDate;

        if (relevantTatReplies.length > 0) {
          relevantTatReplies.forEach(r => {
            if (r.tatMs !== null && r.tatMs !== undefined) {
              g.totalAllRepliesTatMs += r.tatMs;
              g.allRepliesCount++;
            }
          });
          const fR = relevantTatReplies[0];
          if (fR && fR.tatMs !== null && fR.tatMs !== undefined) {
            g.totalFirstTatMs += fR.tatMs;
            g.firstTatCount++;
          }
          const lR = relevantTatReplies[relevantTatReplies.length - 1];
          if (lR && lR.tatMs !== null && lR.tatMs !== undefined) {
            g.totalLastTatMs += lR.tatMs;
            g.lastTatCount++;
          }
        } else if (initDate === d && t.firstResponseTimeMs !== null && t.firstResponseTimeMs !== undefined) {
          g.totalAllRepliesTatMs += (t.avgReplyTatMs ?? t.firstResponseTimeMs);
          g.allRepliesCount++;
          g.totalFirstTatMs += t.firstResponseTimeMs;
          g.firstTatCount++;
          const lastTat = t.latestResponseTimeMs ?? t.firstResponseTimeMs;
          g.totalLastTatMs += lastTat;
          g.lastTatCount++;
        }
      });
    });

    return dateGroups;
  }

  // Render Date-Wise Breakdown & Tag Matrix Table
  function renderDateSummaryTable(threads) {
    const tbody = document.getElementById('date-summary-tbody');

    if (threads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="13" class="text-center empty-cell">No emails recorded for the selected period.</td></tr>`;
      return;
    }

    const dateGroups = buildDateSummaryGroups(threads);
    let groupList = Object.values(dateGroups);

    // Sort groupList based on dateSummarySort
    groupList.sort((a, b) => {
      const factor = dateSummarySort.order === 'asc' ? 1 : -1;
      if (dateSummarySort.column === 'date') return factor * a.date.localeCompare(b.date);
      if (dateSummarySort.column === 'threads') return factor * (a.threads - b.threads);
      if (dateSummarySort.column === 'custMails') return factor * (a.custMails - b.custMails);
      if (dateSummarySort.column === 'reverts') return factor * (a.reverts - b.reverts);
      if (dateSummarySort.column === 'resolved') return factor * (a.resolved - b.resolved);
      if (dateSummarySort.column === 'followupTotal') return factor * (a.followupTotal - b.followupTotal);
      if (dateSummarySort.column === 'followupGen') return factor * (a.followupGen - b.followupGen);
      if (dateSummarySort.column === 'followupRet') return factor * (a.followupRet - b.followupRet);
      if (dateSummarySort.column === 'followupRepl') return factor * (a.followupRepl - b.followupRepl);
      if (dateSummarySort.column === 'payPending') return factor * (a.payPending - b.payPending);
      if (dateSummarySort.column === 'avgAllTat') {
        const avgA = a.allRepliesCount > 0 ? a.totalAllRepliesTatMs / a.allRepliesCount : 0;
        const avgB = b.allRepliesCount > 0 ? b.totalAllRepliesTatMs / b.allRepliesCount : 0;
        return factor * (avgA - avgB);
      }
      if (dateSummarySort.column === 'avgTat') {
        const avgA = a.firstTatCount > 0 ? a.totalFirstTatMs / a.firstTatCount : 0;
        const avgB = b.firstTatCount > 0 ? b.totalFirstTatMs / b.firstTatCount : 0;
        return factor * (avgA - avgB);
      }
      return factor * a.date.localeCompare(b.date);
    });

    const todayStr = TatUtils.formatDateKey(Date.now());

    tbody.innerHTML = groupList.map(g => {
      const avgAllTat = g.allRepliesCount > 0 ? TatUtils.formatDuration(g.totalAllRepliesTatMs / g.allRepliesCount) : 'Pending';
      const avgFirstTat = g.firstTatCount > 0 ? TatUtils.formatDuration(g.totalFirstTatMs / g.firstTatCount) : 'Pending';
      const isToday = g.date === todayStr;

      return `
        <tr>
          <td>
            <strong>${g.date}</strong>
            ${isToday ? '<span class="badge badge-sla" style="margin-left:6px; font-size:10px;">Today</span>' : ''}
          </td>
          <td><strong>${g.threads}</strong></td>
          <td><strong>${g.custMails}</strong></td>
          <td><strong>${g.reverts}</strong></td>
          <td><strong style="color: var(--primary);">${avgAllTat}</strong></td>
          <td><span style="color: var(--text-muted); font-size: 12px;">${avgFirstTat}</span></td>
          <td><span class="badge badge-resolved">${g.resolved}</span></td>
          <td>${g.followupTotal > 0 ? `<span class="badge badge-followup">${g.followupTotal}</span>` : '0'}</td>
          <td>${g.followupGen > 0 ? `<span class="badge badge-followup">${g.followupGen}</span>` : '0'}</td>
          <td>${g.followupRet > 0 ? `<span class="badge badge-followup-return">${g.followupRet}</span>` : '0'}</td>
          <td>${g.followupRepl > 0 ? `<span class="badge badge-followup-replacement">${g.followupRepl}</span>` : '0'}</td>
          <td>${g.payPending > 0 ? `<span class="badge badge-payment-pending">${g.payPending}</span>` : '0'}</td>
          <td>
            <button class="btn btn-outline btn-sm btn-filter-date" data-date="${g.date}">Filter Date</button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach click listener for "Filter Date"
    tbody.querySelectorAll('.btn-filter-date').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetDate = e.target.getAttribute('data-date');
        document.getElementById('filter-range').value = 'custom';
        document.getElementById('custom-date-container').style.display = 'flex';
        document.getElementById('filter-start-date').value = targetDate;
        document.getElementById('filter-end-date').value = targetDate;
        applyFilters();
        showToast(`Filtered for ${targetDate}`, 'info');
      });
    });
  }

  // Render Detailed Thread-by-Thread Log Table
  function renderThreadLogsTable(threads) {
    const tbody = document.getElementById('threads-tbody');
    const badge = document.getElementById('thread-count-badge');
    badge.innerText = `${threads.length} threads`;

    if (threads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center empty-cell">No thread logs found matching the filter.</td></tr>`;
      return;
    }

    // Save open state of any currently open dropdowns so live re-renders don't collapse them!
    const openDropdownThreadIds = new Set(
      Array.from(tbody.querySelectorAll('details.dash-replies-dropdown[open]'))
        .map(el => el.getAttribute('data-thread-id'))
        .filter(Boolean)
    );

    // Sort threads based on threadLogSort
    const sorted = [...threads].sort((a, b) => {
      const factor = threadLogSort.order === 'asc' ? 1 : -1;
      if (threadLogSort.column === 'threadDate') {
        const timeA = a.latestAgentTime || a.latestCustomerTime || a.initialCustomerTime || 0;
        const timeB = b.latestAgentTime || b.latestCustomerTime || b.initialCustomerTime || 0;
        return factor * (timeA - timeB);
      }
      if (threadLogSort.column === 'threadTat') {
        const tatA = a.firstResponseTimeMs || 0;
        const tatB = b.firstResponseTimeMs || 0;
        return factor * (tatA - tatB);
      }
      if (threadLogSort.column === 'threadLastTat') {
        const tatA = a.latestResponseTimeMs ?? a.firstResponseTimeMs ?? 0;
        const tatB = b.latestResponseTimeMs ?? b.firstResponseTimeMs ?? 0;
        return factor * (tatA - tatB);
      }
      if (threadLogSort.column === 'threadReverts') {
        return factor * ((a.agentReplyCount || 0) - (b.agentReplyCount || 0));
      }
      const timeA = a.latestAgentTime || a.latestCustomerTime || a.initialCustomerTime || 0;
      const timeB = b.latestAgentTime || b.latestCustomerTime || b.initialCustomerTime || 0;
      return factor * (timeA - timeB);
    });

    tbody.innerHTML = sorted.map(t => {
      const tagClass = t.tagClassification || TatUtils.classifyThreadTags(t.tags || [], t);

      let statusBadgeClass = 'badge-resolved';
      if (tagClass.primaryCategory === 'FOLLOWUP_RETURN') statusBadgeClass = 'badge-followup-return';
      else if (tagClass.primaryCategory === 'FOLLOWUP_REPLACEMENT') statusBadgeClass = 'badge-followup-replacement';
      else if (tagClass.primaryCategory === 'PAYMENT_PENDING') statusBadgeClass = 'badge-payment-pending';
      else if (tagClass.primaryCategory === 'FOLLOWUP_GENERAL') statusBadgeClass = 'badge-followup';

      const statusBadge = `<span class="badge ${statusBadgeClass}">${tagClass.primaryLabel}</span>`;

      const repliesList = Array.isArray(t.repliesList) ? t.repliesList : [];
      const isOpen = openDropdownThreadIds.has(t.threadId);

      const firstTatDisplay = t.firstResponseTimeMs !== null && t.firstResponseTimeMs !== undefined
        ? TatUtils.formatDuration(t.firstResponseTimeMs)
        : '<span style="color:var(--warning);">⏳ Pending</span>';

      const lastTatVal = (t.latestResponseTimeMs !== null && t.latestResponseTimeMs !== undefined)
        ? t.latestResponseTimeMs
        : t.firstResponseTimeMs;

      const lastTatDisplay = lastTatVal !== null && lastTatVal !== undefined
        ? TatUtils.formatDuration(lastTatVal)
        : '<span style="color:var(--warning);">⏳ Pending</span>';

      const avgReplyTatStr = t.avgReplyTatMs !== null && t.avgReplyTatMs !== undefined
        ? TatUtils.formatDuration(t.avgReplyTatMs)
        : (lastTatVal ? TatUtils.formatDuration(lastTatVal) : 'N/A');

      const firstQueryStr = TatUtils.formatShortDateTime(t.initialCustomerTime);
      const firstReplyStr = t.firstAgentTime ? TatUtils.formatShortDateTime(t.firstAgentTime) : 'Pending';

      const lastQueryTime = t.lastRepliedCustomerQueryTime || t.latestCustomerTime || t.initialCustomerTime;
      const lastReplyTime = t.lastRepliedAgentTime || t.latestAgentTime || t.firstAgentTime;
      const lastQueryStr = TatUtils.formatShortDateTime(lastQueryTime);
      const lastReplyStr = lastReplyTime ? TatUtils.formatShortDateTime(lastReplyTime) : 'Awaiting Reply';

      const initials = TatUtils.getInitials(t.customerName, t.customerEmail);
      const color = TatUtils.getAvatarColor(t.customerEmail || t.customerName);

      const multiDayNote = (t.initialDateKey && t.dateKey && t.initialDateKey !== t.dateKey)
        ? `<div class="dash-tat-sub" style="margin-top:2px;">Opened: ${t.initialDateKey}</div>`
        : '';

      const pendingUnrepliedNote = (!tagClass.isResolved && t.pendingSince)
        ? `<div class="dash-tat-sub" style="color:var(--warning); font-weight:600;">⏳ New query: ${TatUtils.formatShortDateTime(t.pendingSince)}</div>`
        : '';

      // Clean tags chips
      const cleanTags = tagClass.cleanTags || [];
      const tagsChipsHtml = cleanTags.length > 0
        ? `<div class="dash-tag-chips-wrap">${cleanTags.map(tg => `<span class="dash-tag-chip" title="Gmail tag: ${tg}">🏷️ ${tg}</span>`).join('')}</div>`
        : '';

      return `
        <tr>
          <td>
            <strong title="${t.subject}">${truncate(t.subject || '(No Subject)', 34)}</strong>
            ${tagsChipsHtml}
          </td>
          <td>
            <div class="customer-cell">
              <div class="cust-avatar" style="background-color: ${color.bg}; color: ${color.text}; border-color: ${color.border};">
                ${initials}
              </div>
              <div class="cust-meta">
                <span class="cust-name">${truncate(t.customerName, 18)}</span>
                <span class="cust-email">${truncate(t.customerEmail, 22)}</span>
              </div>
            </div>
          </td>
          <td>
            <strong>${t.dateKey || 'N/A'}</strong>
            ${multiDayNote}
          </td>
          <td>
            <strong>${t.customerQueryCount || 1}</strong>
            ${(t.customerReopenCount || 0) > 0 ? `<div style="margin-top:2px;"><span class="badge badge-reopened">${t.customerReopenCount}x reopen</span></div>` : ''}
          </td>
          <td>
            <div class="dash-tat-stack">
              <span class="dash-tat-main">${firstTatDisplay}</span>
              <span class="dash-tat-sub">📩 Query: ${firstQueryStr}</span>
              <span class="dash-tat-sub">↩️ 1st Reply: ${firstReplyStr}</span>
            </div>
          </td>
          <td>
            <div class="dash-tat-stack">
              <span class="dash-tat-main" style="color: var(--success);">${lastTatDisplay}</span>
              <span class="dash-tat-sub">📩 Last Query: ${lastQueryStr}</span>
              <span class="dash-tat-sub">↩️ Replied: ${lastReplyStr}</span>
              ${pendingUnrepliedNote}
            </div>
          </td>
          <td>
            <details class="dash-replies-dropdown" data-thread-id="${t.threadId}" ${isOpen ? 'open' : ''}>
              <summary class="dash-replies-summary" title="Click to see all ${t.agentReplyCount || 0} replies and their TATs">
                <span>${t.agentReplyCount || 0} ${(t.agentReplyCount === 1) ? 'Reply' : 'Replies'}</span>
                <span>▾</span>
              </summary>
              <div class="dash-replies-menu">
                <div class="dash-replies-menu-head">
                  <span>All Agent Replies (${repliesList.length})</span>
                  <span>Avg: ${avgReplyTatStr}</span>
                </div>
                ${repliesList.length === 0 ? `
                  <div class="dash-tat-sub" style="text-align:center; padding:8px;">No replies recorded yet.</div>
                ` : repliesList.map(r => `
                  <div class="dash-reply-item">
                    <div class="dash-reply-item-top">
                      <span class="dash-reply-item-title">${r.replyIndex === 1 ? '1st Reply (Initial)' : `Reply #${r.replyIndex} (Reopen #${r.replyIndex - 1})`}</span>
                      <span class="dash-reply-item-tat">TAT: ${TatUtils.formatDuration(r.tatMs)}</span>
                    </div>
                    <div class="dash-reply-item-times">
                      <div>📩 Customer Query: <strong>${TatUtils.formatShortDateTime(r.customerQueryTime)}</strong></div>
                      <div>↩️ You Replied: <strong>${TatUtils.formatShortDateTime(r.agentReplyTime)}</strong></div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </details>
          </td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-secondary btn-sm btn-view-audit" data-thread-id="${t.threadId}">🔍 Audit</button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach listeners to audit buttons
    tbody.querySelectorAll('.btn-view-audit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threadId = e.currentTarget.getAttribute('data-thread-id');
        openTimelineModal(threadId);
      });
    });
  }

  // Open Detailed Timeline Audit Modal
  function openTimelineModal(threadId) {
    const thread = allThreadsMap[threadId];
    if (!thread) return;

    document.getElementById('modal-thread-subject').innerText = thread.subject || '(No Subject)';
    document.getElementById('modal-thread-customer').innerText = `${thread.customerName} (${thread.customerEmail})`;

    const tagClass = thread.tagClassification || TatUtils.classifyThreadTags(thread.tags || [], thread);
    const lastTatVal = thread.latestResponseTimeMs ?? thread.firstResponseTimeMs;
    const banner = document.getElementById('modal-meta-banner');
    banner.innerHTML = `
      <div class="meta-field">
        <span class="meta-field-label">Status & Tag</span>
        <span class="meta-field-val">${tagClass.primaryLabel}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">1st Response TAT</span>
        <span class="meta-field-val" style="color:var(--primary);">${TatUtils.formatDuration(thread.firstResponseTimeMs)}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Avg Reply TAT (All)</span>
        <span class="meta-field-val" style="color:var(--primary);">${TatUtils.formatDuration(thread.avgReplyTatMs)}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Last Query → Reply TAT</span>
        <span class="meta-field-val" style="color:var(--success);">${TatUtils.formatDuration(lastTatVal)}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Total Agent Reverts</span>
        <span class="meta-field-val">${thread.agentReplyCount || 0}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Customer Reopened</span>
        <span class="meta-field-val" style="color:${thread.customerReopenCount > 0 ? 'var(--danger)' : 'inherit'};">${thread.customerReopenCount || 0} times</span>
      </div>
    `;

    // Render Timeline Events
    const eventsContainer = document.getElementById('modal-timeline-events');
    const events = thread.timeline || [];

    if (events.length === 0) {
      eventsContainer.innerHTML = '<div class="timeline-note">No message events logged for this thread.</div>';
    } else {
      eventsContainer.innerHTML = events.map((evt, idx) => {
        let nodeClass = 'node-query';
        let tagClass = 'tag-query';
        let tagLabel = 'Customer Query';

        if (evt.type === 'AGENT_REPLY') {
          nodeClass = 'node-revert';
          tagClass = 'tag-revert';
          tagLabel = evt.revertIndex === 1 ? 'Agent First Reply' : `Agent Revert #${evt.revertIndex}`;
        } else if (evt.type === 'REOPENED') {
          nodeClass = 'node-reopen';
          tagClass = 'tag-reopen';
          tagLabel = 'Query Reopened';
        }

        const tatBadge = evt.tatMs !== null && evt.tatMs !== undefined ? `<span class="timeline-tat">Turnaround Time: ${TatUtils.formatDuration(evt.tatMs)}</span>` : '';

        return `
          <div class="timeline-item">
            <div class="timeline-node ${nodeClass}"></div>
            <div class="timeline-content">
              <div class="timeline-head">
                <span class="timeline-tag ${tagClass}">${tagLabel}</span>
                <span class="timeline-time">${TatUtils.formatDateTime(evt.timestamp)}</span>
              </div>
              <div class="timeline-note">${evt.sender} - ${evt.note}</div>
              ${tatBadge}
            </div>
          </div>
        `;
      }).join('');
    }

    // Modal Copy Audit button listener
    const copyAuditBtn = document.getElementById('modal-btn-copy');
    copyAuditBtn.onclick = () => {
      const auditTranscript = [
        `Thread: ${thread.subject}`,
        `Customer: ${thread.customerName} (${thread.customerEmail})`,
        `Status: ${tagClass.primaryLabel}`,
        `First TAT: ${TatUtils.formatDuration(thread.firstResponseTimeMs)} | Last Reply TAT: ${TatUtils.formatDuration(lastTatVal)}`,
        `Reverts: ${thread.agentReplyCount} | Reopened: ${thread.customerReopenCount}x`,
        '--- Timeline ---',
        ...events.map(e => `[${TatUtils.formatDateTime(e.timestamp)}] ${e.sender}: ${e.note} ${e.tatMs ? `(TAT: ${TatUtils.formatDuration(e.tatMs)})` : ''}`)
      ].join('\n');

      navigator.clipboard.writeText(auditTranscript).then(() => {
        showToast('Audit transcript copied to clipboard!', 'success');
      });
    };

    document.getElementById('timeline-modal').style.display = 'flex';
  }

  // Export Date-wise aggregated summary to CSV
  function exportDateSummaryCSV() {
    const rawList = currentFilteredThreads;
    if (rawList.length === 0) {
      showToast('No data to export.', 'warning');
      return;
    }

    const dateGroups = buildDateSummaryGroups(rawList);

    const headers = [
      'Date',
      'Mail Threads Count',
      'Customer Mails Came',
      'Agent Replied Count',
      'Avg Reply TAT Over All Mails (Minutes)',
      'Avg Reply TAT Over All Mails (Readable)',
      'Avg 1st Response TAT (Minutes)',
      'Avg 1st Response TAT (Readable)',
      'Resolved Count',
      'Follow Up Needed (Total)',
      'Follow Up (General)',
      'Follow Up / Return',
      'Follow Up / Replacement',
      'Payment Pending'
    ];

    const sortedDates = Object.keys(dateGroups).sort((a, b) => b.localeCompare(a));
    const rows = sortedDates.map(dk => {
      const g = dateGroups[dk];
      const avgAllMins = g.allRepliesCount > 0 ? (g.totalAllRepliesTatMs / g.allRepliesCount / 60000).toFixed(1) : 'N/A';
      const avgAllReadable = g.allRepliesCount > 0 ? TatUtils.formatDuration(g.totalAllRepliesTatMs / g.allRepliesCount) : 'N/A';
      const avgFirstMins = g.firstTatCount > 0 ? (g.totalFirstTatMs / g.firstTatCount / 60000).toFixed(1) : 'N/A';
      const firstReadable = g.firstTatCount > 0 ? TatUtils.formatDuration(g.totalFirstTatMs / g.firstTatCount) : 'N/A';

      return [
        dk,
        g.threads,
        g.custMails,
        g.reverts,
        avgAllMins,
        avgAllReadable,
        avgFirstMins,
        firstReadable,
        g.resolved,
        g.followupTotal,
        g.followupGen,
        g.followupRet,
        g.followupRepl,
        g.payPending
      ];
    });

    const escapeField = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const csvContent = [
      headers.map(escapeField).join(','),
      ...rows.map(r => r.map(escapeField).join(','))
    ].join('\r\n');

    TatUtils.downloadCSVFile(csvContent, `email_daily_tat_matrix_${TatUtils.formatDateKey(Date.now())}.csv`);
    showToast(`Exported ${sortedDates.length} days of matrix summary!`, 'success');
  }

  // Open Settings Modal
  function openSettingsModal() {
    const emailsInput = document.getElementById('setting-agent-emails');
    const thresholdInput = document.getElementById('setting-sla-threshold');
    const bhEnable = document.getElementById('setting-business-hours-enable');
    const bhStart = document.getElementById('setting-business-start');
    const bhEnd = document.getElementById('setting-business-end');
    const bhConfigWrap = document.getElementById('business-hours-config-wrap');

    emailsInput.value = (currentSettings.agentEmails || []).join(', ');
    thresholdInput.value = currentSettings.slaThresholdHours || 2;

    const useBh = currentSettings.useBusinessHours !== false;
    if (bhEnable) bhEnable.checked = useBh;
    if (bhStart) bhStart.value = currentSettings.businessHoursStart || '09:30';
    if (bhEnd) bhEnd.value = currentSettings.businessHoursEnd || '18:30';
    if (bhConfigWrap) bhConfigWrap.style.display = useBh ? 'flex' : 'none';

    const activeDays = Array.isArray(currentSettings.businessDays) && currentSettings.businessDays.length > 0
      ? currentSettings.businessDays
      : [1, 2, 3, 4, 5, 6];

    document.querySelectorAll('input[name="business-day"]').forEach(cb => {
      const val = parseInt(cb.value, 10);
      cb.checked = activeDays.includes(val);
    });

    document.getElementById('settings-modal').style.display = 'flex';
  }

  async function saveSettings() {
    const rawEmails = document.getElementById('setting-agent-emails').value;
    const threshold = parseFloat(document.getElementById('setting-sla-threshold').value) || 2;
    const bhEnable = document.getElementById('setting-business-hours-enable') ? document.getElementById('setting-business-hours-enable').checked : true;
    const bhStart = document.getElementById('setting-business-start') ? (document.getElementById('setting-business-start').value || '09:30') : '09:30';
    const bhEnd = document.getElementById('setting-business-end') ? (document.getElementById('setting-business-end').value || '18:30') : '18:30';

    const selectedDays = [];
    document.querySelectorAll('input[name="business-day"]:checked').forEach(cb => {
      selectedDays.push(parseInt(cb.value, 10));
    });

    const emailList = rawEmails
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0);

    currentSettings.agentEmails = emailList;
    currentSettings.slaThresholdHours = threshold;
    currentSettings.useBusinessHours = bhEnable;
    currentSettings.businessHoursStart = bhStart;
    currentSettings.businessHoursEnd = bhEnd;
    currentSettings.businessDays = selectedDays.length > 0 ? selectedDays : [1, 2, 3, 4, 5, 6];

    await TatUtils.saveSettings(currentSettings);
    TatUtils._cachedSettings = currentSettings;

    // Immediately recalculate all existing stored threads with the updated business hours settings
    const allStored = await TatUtils.getAllThreads();
    const updatedThreads = {};
    Object.keys(allStored).forEach(k => {
      updatedThreads[k] = TatUtils.normalizeThread(allStored[k], currentSettings);
    });

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await new Promise(res => {
        chrome.storage.local.set({ threads: updatedThreads }, res);
      });
    }

    allThreadsMap = updatedThreads;
    updateSlaBadge();
    document.getElementById('settings-modal').style.display = 'none';
    renderSlaDistribution(currentFilteredThreads);
    applyFilters();
    showToast('Business working hours saved and all thread TATs recalculated!', 'success');
  }

  async function loadSampleData() {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const oneHour = 60 * 60 * 1000;
    const oneMin = 60 * 1000;

    const mockThreads = {
      'mock_th_01': {
        threadId: 'mock_th_01',
        subject: 'Invoice #8492 Billing Clarification',
        customerEmail: 'robert.chen@acme.com',
        customerName: 'Robert Chen',
        dateKey: TatUtils.formatDateKey(now),
        initialCustomerTime: now - (3 * oneHour),
        firstAgentTime: now - (3 * oneHour) + (18 * oneMin),
        latestCustomerTime: now - (3 * oneHour),
        latestAgentTime: now - (3 * oneHour) + (18 * oneMin),
        firstResponseTimeMs: 18 * oneMin,
        totalCycleDurationMs: 18 * oneMin,
        agentReplyCount: 1,
        customerReopenCount: 0,
        status: 'RESOLVED',
        timeline: [
          { type: 'CUSTOMER_MSG', timestamp: now - (3 * oneHour), sender: 'robert.chen@acme.com', note: 'Initial Customer Query' },
          { type: 'AGENT_REPLY', timestamp: now - (3 * oneHour) + (18 * oneMin), sender: 'You', revertIndex: 1, tatMs: 18 * oneMin, note: 'First Response' }
        ],
        lastUpdated: now - (2 * oneHour)
      },
      'mock_th_02': {
        threadId: 'mock_th_02',
        subject: 'API Webhook 500 error during high load',
        customerEmail: 'dev-lead@fintech.io',
        customerName: 'Sarah Jenkins',
        dateKey: TatUtils.formatDateKey(now),
        initialCustomerTime: now - (2 * oneHour),
        firstAgentTime: now - (2 * oneHour) + (35 * oneMin),
        latestCustomerTime: now - (1 * oneHour),
        latestAgentTime: now - (2 * oneHour) + (35 * oneMin),
        firstResponseTimeMs: 35 * oneMin,
        totalCycleDurationMs: 35 * oneMin,
        agentReplyCount: 1,
        customerReopenCount: 1,
        status: 'PENDING_REPLY',
        currentPendingDurationMs: oneHour,
        timeline: [
          { type: 'CUSTOMER_MSG', timestamp: now - (2 * oneHour), sender: 'dev-lead@fintech.io', note: 'Initial Customer Query' },
          { type: 'AGENT_REPLY', timestamp: now - (2 * oneHour) + (35 * oneMin), sender: 'You', revertIndex: 1, tatMs: 35 * oneMin, note: 'First Response' },
          { type: 'REOPENED', timestamp: now - (1 * oneHour), sender: 'dev-lead@fintech.io', note: 'Customer reopened query (Reopen #1)' }
        ],
        lastUpdated: now - (1 * oneHour)
      },
      'mock_th_03': {
        threadId: 'mock_th_03',
        subject: 'Request for custom enterprise contract pricing',
        customerEmail: 'procurement@globalcorp.org',
        customerName: 'Marcus Vance',
        dateKey: TatUtils.formatDateKey(now - oneDay),
        initialCustomerTime: now - oneDay - (4 * oneHour),
        firstAgentTime: now - oneDay - (4 * oneHour) + (45 * oneMin),
        latestCustomerTime: now - oneDay - (2 * oneHour),
        latestAgentTime: now - oneDay - (1 * oneHour),
        firstResponseTimeMs: 45 * oneMin,
        totalCycleDurationMs: 3 * oneHour,
        agentReplyCount: 2,
        customerReopenCount: 1,
        status: 'RESOLVED',
        timeline: [
          { type: 'CUSTOMER_MSG', timestamp: now - oneDay - (4 * oneHour), sender: 'procurement@globalcorp.org', note: 'Initial Customer Query' },
          { type: 'AGENT_REPLY', timestamp: now - oneDay - (4 * oneHour) + (45 * oneMin), sender: 'You', revertIndex: 1, tatMs: 45 * oneMin, note: 'First Response' },
          { type: 'REOPENED', timestamp: now - oneDay - (2 * oneHour), sender: 'procurement@globalcorp.org', note: 'Customer reopened query (Reopen #1)' },
          { type: 'AGENT_REPLY', timestamp: now - oneDay - (1 * oneHour), sender: 'You', revertIndex: 2, tatMs: oneHour, note: 'Agent Revert #2' }
        ],
        lastUpdated: now - oneDay
      },
      'mock_th_04': {
        threadId: 'mock_th_04',
        subject: 'SSO Login SAML certificate renewal inquiry',
        customerEmail: 'it-security@nexus.com',
        customerName: 'Ananya Sharma',
        dateKey: TatUtils.formatDateKey(now - (2 * oneDay)),
        initialCustomerTime: now - (2 * oneDay) - (5 * oneHour),
        firstAgentTime: now - (2 * oneDay) - (5 * oneHour) + (24 * oneMin),
        latestCustomerTime: now - (2 * oneDay) - (5 * oneHour),
        latestAgentTime: now - (2 * oneDay) - (5 * oneHour) + (24 * oneMin),
        firstResponseTimeMs: 24 * oneMin,
        totalCycleDurationMs: 24 * oneMin,
        agentReplyCount: 1,
        customerReopenCount: 0,
        status: 'RESOLVED',
        timeline: [
          { type: 'CUSTOMER_MSG', timestamp: now - (2 * oneDay) - (5 * oneHour), sender: 'it-security@nexus.com', note: 'Initial Customer Query' },
          { type: 'AGENT_REPLY', timestamp: now - (2 * oneDay) - (5 * oneHour) + (24 * oneMin), sender: 'You', revertIndex: 1, tatMs: 24 * oneMin, note: 'First Response' }
        ],
        lastUpdated: now - (2 * oneDay)
      },
      'mock_th_05': {
        threadId: 'mock_th_05',
        subject: 'Broken export links in weekly executive PDF',
        customerEmail: 'danielle@growthpulse.co',
        customerName: 'Danielle Miller',
        dateKey: TatUtils.formatDateKey(now - (3 * oneDay)),
        initialCustomerTime: now - (3 * oneDay) - (6 * oneHour),
        firstAgentTime: now - (3 * oneDay) - (6 * oneHour) + (52 * oneMin),
        latestCustomerTime: now - (3 * oneDay) - (1 * oneHour),
        latestAgentTime: now - (3 * oneDay) - (30 * oneMin),
        firstResponseTimeMs: 52 * oneMin,
        totalCycleDurationMs: 5.5 * oneHour,
        agentReplyCount: 3,
        customerReopenCount: 2,
        status: 'RESOLVED',
        timeline: [
          { type: 'CUSTOMER_MSG', timestamp: now - (3 * oneDay) - (6 * oneHour), sender: 'danielle@growthpulse.co', note: 'Initial Customer Query' },
          { type: 'AGENT_REPLY', timestamp: now - (3 * oneDay) - (6 * oneHour) + (52 * oneMin), sender: 'You', revertIndex: 1, tatMs: 52 * oneMin, note: 'First Response' },
          { type: 'REOPENED', timestamp: now - (3 * oneDay) - (3 * oneHour), sender: 'danielle@growthpulse.co', note: 'Customer reopened query (Reopen #1)' },
          { type: 'AGENT_REPLY', timestamp: now - (3 * oneDay) - (2 * oneHour), sender: 'You', revertIndex: 2, tatMs: oneHour, note: 'Agent Revert #2' },
          { type: 'REOPENED', timestamp: now - (3 * oneDay) - (1 * oneHour), sender: 'danielle@growthpulse.co', note: 'Customer reopened query (Reopen #2)' },
          { type: 'AGENT_REPLY', timestamp: now - (3 * oneDay) - (30 * oneMin), sender: 'You', revertIndex: 3, tatMs: 30 * oneMin, note: 'Agent Revert #3' }
        ],
        lastUpdated: now - (3 * oneDay)
      }
    };

    await new Promise(r => chrome.storage.local.set({ threads: mockThreads }, r));
    await reloadData();
    document.getElementById('settings-modal').style.display = 'none';
    showToast('Loaded 5 realistic sample queries across multiple dates!', 'success');
  }

  async function clearAllData() {
    const confirmed = confirm('Are you sure you want to delete all tracked email TAT records? This action cannot be undone.');
    if (!confirmed) return;

    await new Promise(r => chrome.storage.local.set({ threads: {} }, r));
    allThreadsMap = {};
    document.getElementById('settings-modal').style.display = 'none';
    applyFilters();
    showToast('All tracked records cleared.', 'warning');
  }

  // Toast Helper
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✓' : (type === 'warning' ? '⚠️' : 'ℹ️');
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  function truncate(str, max = 25) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '...' : str;
  }
})();
