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
        const start = currentSettings.businessHoursStart || '10:00';
        const end = currentSettings.businessHoursEnd || '19:00';
        bhBadge.style.display = 'inline-flex';
        bhBadge.innerHTML = `<span>🏢 Support: ${start}–${end} (Mon–Sat)</span>`;
        bhBadge.title = `Support Working Hours active (${start} to ${end} Mon–Sat, excluding nights & Sundays)`;
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

    const copySheetBtn = document.getElementById('btn-copy-sheet');
    if (copySheetBtn) {
      copySheetBtn.addEventListener('click', () => {
        if (currentFilteredThreads.length === 0) {
          showToast('No email data available to copy.', 'warning');
          return;
        }
        const csv = TatUtils.exportToCSV(currentFilteredThreads);
        navigator.clipboard.writeText(csv).then(() => {
          showToast(`Copied ${currentFilteredThreads.length} rows! Open Google Sheets or Excel and press Ctrl+V to paste.`, 'success');
        }).catch(() => {
          showToast('Failed to copy to clipboard.', 'warning');
        });
      });
    }

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

      // 3. Search Query (Matches subject, customer name, email, order ID, customer body, or Gmail tag)
      if (query) {
        const subj = (t.subject || '').toLowerCase();
        const email = (t.customerEmail || '').toLowerCase();
        const name = (t.customerName || '').toLowerCase();
        const orderId = (t.orderId || '').toLowerCase();
        const bodyText = (t.customerRepliesText || t.customerQueriesText || '').toLowerCase();
        const matchTag = (t.tags || []).some(tg => String(tg).toLowerCase().includes(query));
        if (!subj.includes(query) && !email.includes(query) && !name.includes(query) && !matchTag && !orderId.includes(query) && !bodyText.includes(query)) {
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

  // Render top KPI stats (Real-time Matrix: Threads, Customer Mails, Agent Replied, Support Hours TAT, Non-Support 24x7 Actual TAT, Resolved, Follow Up Needed, Payment Pending)
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
    let totalCustSupport = 0;
    let totalCustOffHours = 0;
    let totalAgentReplies = 0;
    let totalSupportTatMs = 0;
    let supportTatCount = 0;
    let totalFirstSupportTatMs = 0;
    let firstSupportTatCount = 0;
    let totalLastSupportTatMs = 0;
    let lastSupportTatCount = 0;
    let totalActualTatMs = 0;
    let actualTatCount = 0;
    let totalFirstActualTatMs = 0;
    let firstActualTatCount = 0;
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
      totalCustSupport += (g.custMailsSupport || 0);
      totalCustOffHours += (g.custMailsOffHours || 0);
      totalAgentReplies += g.reverts;
      totalSupportTatMs += (g.totalSupportTatMs || 0);
      supportTatCount += (g.supportTatCount || 0);
      totalFirstSupportTatMs += (g.totalFirstSupportTatMs || 0);
      firstSupportTatCount += (g.firstSupportTatCount || 0);
      totalLastSupportTatMs += (g.totalLastSupportTatMs || 0);
      lastSupportTatCount += (g.lastSupportTatCount || 0);
      totalActualTatMs += (g.totalActualTatMs || 0);
      actualTatCount += (g.actualTatCount || 0);
      totalFirstActualTatMs += (g.totalFirstActualTatMs || 0);
      firstActualTatCount += (g.firstActualTatCount || 0);
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

    const avgSupportTatMs = supportTatCount > 0 ? (totalSupportTatMs / supportTatCount) : 0;
    const avgFirstSupportTatMs = firstSupportTatCount > 0 ? (totalFirstSupportTatMs / firstSupportTatCount) : 0;
    const avgLastSupportTatMs = lastSupportTatCount > 0 ? (totalLastSupportTatMs / lastSupportTatCount) : 0;

    const avgActualTatMs = actualTatCount > 0 ? (totalActualTatMs / actualTatCount) : 0;
    const avgFirstActualTatMs = firstActualTatCount > 0 ? (totalFirstActualTatMs / firstActualTatCount) : 0;

    const resRate = totalThreads > 0 ? Math.round((resolvedCount / totalThreads) * 100) : 0;

    // Update KPI Card Values
    const totalThreadsEl = document.getElementById('kpi-total-threads');
    if (totalThreadsEl) totalThreadsEl.innerText = totalThreads;
    const threadsCap = document.getElementById('kpi-threads-caption');
    if (threadsCap) threadsCap.innerText = `${rangeLabel} active threads`;

    const custMailsEl = document.getElementById('kpi-customer-mails');
    if (custMailsEl) custMailsEl.innerText = totalCustomerMails;
    const custCap = document.getElementById('kpi-custmails-caption');
    if (custCap) {
      custCap.innerHTML = totalCustomerMails > 0
        ? `<span style="color:#059669; font-weight:600;">${totalCustSupport} Support Hrs</span> | <span style="color:#7c3aed; font-weight:600;">${totalCustOffHours} Off-Hours</span>`
        : `${rangeLabel} queries received`;
    }

    const totalRevertsEl = document.getElementById('kpi-total-reverts');
    if (totalRevertsEl) totalRevertsEl.innerText = totalAgentReplies;
    const revertsCap = document.getElementById('kpi-reverts-caption');
    if (revertsCap) revertsCap.innerText = `${rangeLabel} replies sent`;

    // 1. Support Hours Avg TAT KPI (10am–7pm Mon–Sat)
    const tatTitle = document.getElementById('kpi-tat-title');
    if (tatTitle) {
      tatTitle.innerText = range === 'today'
        ? "Today's Support Hours TAT (10am–7pm)"
        : (range === 'yesterday' ? "Yesterday's Support Hours TAT" : `Support Hours Avg TAT (${rangeLabel})`);
    }

    const avgAllTatEl = document.getElementById('kpi-avg-all-reply-tat');
    if (avgAllTatEl) {
      avgAllTatEl.innerText = supportTatCount > 0 ? TatUtils.formatSupportDuration(avgSupportTatMs) : '0m';
    }

    const avgFirstEl = document.getElementById('kpi-avg-tat');
    if (avgFirstEl) avgFirstEl.innerText = firstSupportTatCount > 0 ? TatUtils.formatSupportDuration(avgFirstSupportTatMs) : '0m';

    const avgLastEl = document.getElementById('kpi-avg-last-tat');
    if (avgLastEl) avgLastEl.innerText = lastSupportTatCount > 0 ? TatUtils.formatSupportDuration(avgLastSupportTatMs) : '0m';

    // 2. Non-Support / 24x7 Actual TAT KPI
    const avgActualTatEl = document.getElementById('kpi-avg-actual-tat');
    if (avgActualTatEl) {
      avgActualTatEl.innerText = actualTatCount > 0 ? TatUtils.formatActualDuration(avgActualTatMs) : '0m';
    }

    const avgActualFirstEl = document.getElementById('kpi-avg-actual-first-tat');
    if (avgActualFirstEl) {
      avgActualFirstEl.innerText = firstActualTatCount > 0 ? TatUtils.formatActualDuration(avgFirstActualTatMs) : '0m';
    }

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
            custMailsSupport: 0,
            custMailsOffHours: 0,
            reverts: 0,
            totalAllRepliesTatMs: 0,
            allRepliesCount: 0,
            totalFirstTatMs: 0,
            firstTatCount: 0,
            totalLastTatMs: 0,
            lastTatCount: 0,
            totalSupportTatMs: 0,
            supportTatCount: 0,
            totalFirstSupportTatMs: 0,
            firstSupportTatCount: 0,
            totalLastSupportTatMs: 0,
            lastSupportTatCount: 0,
            totalActualTatMs: 0,
            actualTatCount: 0,
            totalFirstActualTatMs: 0,
            firstActualTatCount: 0,
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

        // Customer queries arrived on date d (bifurcated into Support Hours vs Off-Hours)
        let custMailsOnDate = 0;
        let custSupportOnDate = 0;
        let custOffHoursOnDate = 0;

        if (Array.isArray(t.timeline) && t.timeline.length > 0) {
          const custEvents = t.timeline.filter(e => (e.type === 'CUSTOMER_MSG' || e.type === 'REOPENED') && TatUtils.formatDateKey(e.timestamp) === d);
          custMailsOnDate = custEvents.length;
          custEvents.forEach(e => {
            const inSupp = TatUtils.isWithinSupportHours(e.timestamp, currentSettings);
            if (inSupp) custSupportOnDate++;
            else custOffHoursOnDate++;
          });
        }

        if (custMailsOnDate > 0) {
          g.custMails += custMailsOnDate;
          g.custMailsSupport += custSupportOnDate;
          g.custMailsOffHours += custOffHoursOnDate;
        } else if (initDate === d) {
          const count = Math.max(1, t.customerQueryCount || 1);
          g.custMails += count;
          const inSupp = (t.initialQueryInSupportHours !== undefined)
            ? t.initialQueryInSupportHours
            : TatUtils.isWithinSupportHours(t.initialCustomerTime, currentSettings);
          if (inSupp) g.custMailsSupport += count;
          else g.custMailsOffHours += count;
        } else if (lastCustDate === d) {
          g.custMails += 1;
          const inSupp = TatUtils.isWithinSupportHours(t.latestCustomerTime, currentSettings);
          if (inSupp) g.custMailsSupport += 1;
          else g.custMailsOffHours += 1;
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

        // Turnaround Time for customer queries and replies of date d:
        // Include all replies sent on date d AND replies for queries of date d
        const relevantTatReplies = [];
        const seenReplyKeys = new Set();
        [...repliesSentOnDate, ...repliesForQueriesOnDate].forEach(r => {
          const key = `${r.replyIndex}_${r.agentReplyTime}`;
          if (!seenReplyKeys.has(key)) {
            seenReplyKeys.add(key);
            relevantTatReplies.push(r);
          }
        });

        if (relevantTatReplies.length > 0) {
          relevantTatReplies.forEach(r => {
            const sTat = r.supportTatMs ?? r.tatMs;
            const aTat = r.actualTatMs ?? (r.customerQueryTime && r.agentReplyTime ? Math.max(0, r.agentReplyTime - r.customerQueryTime) : sTat);

            if (sTat !== null && sTat !== undefined) {
              g.totalAllRepliesTatMs += sTat;
              g.allRepliesCount++;
              g.totalSupportTatMs += sTat;
              g.supportTatCount++;
            }
            if (aTat !== null && aTat !== undefined) {
              g.totalActualTatMs += aTat;
              g.actualTatCount++;
            }
          });

          const fR = relevantTatReplies[0];
          if (fR) {
            const fSupp = fR.supportTatMs ?? fR.tatMs;
            const fAct = fR.actualTatMs ?? fSupp;
            if (fSupp !== null && fSupp !== undefined) {
              g.totalFirstTatMs += fSupp;
              g.firstTatCount++;
              g.totalFirstSupportTatMs += fSupp;
              g.firstSupportTatCount++;
            }
            if (fAct !== null && fAct !== undefined) {
              g.totalFirstActualTatMs += fAct;
              g.firstActualTatCount++;
            }
          }

          const lR = relevantTatReplies[relevantTatReplies.length - 1];
          if (lR) {
            const lSupp = lR.supportTatMs ?? lR.tatMs;
            if (lSupp !== null && lSupp !== undefined) {
              g.totalLastTatMs += lSupp;
              g.lastTatCount++;
              g.totalLastSupportTatMs += lSupp;
              g.lastSupportTatCount++;
            }
          }
        } else if (initDate === d && t.firstResponseTimeMs !== null && t.firstResponseTimeMs !== undefined) {
          const sAvg = t.avgReplyTatMs ?? t.firstResponseTimeMs;
          const aAvg = t.actualAvgReplyTatMs ?? t.actualFirstResponseTimeMs ?? sAvg;
          const sFirst = t.firstResponseTimeMs;
          const aFirst = t.actualFirstResponseTimeMs ?? sFirst;
          const sLast = t.latestResponseTimeMs ?? t.firstResponseTimeMs;

          g.totalAllRepliesTatMs += sAvg;
          g.allRepliesCount++;
          g.totalSupportTatMs += sAvg;
          g.supportTatCount++;

          g.totalActualTatMs += aAvg;
          g.actualTatCount++;

          g.totalFirstTatMs += sFirst;
          g.firstTatCount++;
          g.totalFirstSupportTatMs += sFirst;
          g.firstSupportTatCount++;

          g.totalFirstActualTatMs += aFirst;
          g.firstActualTatCount++;

          g.totalLastTatMs += sLast;
          g.lastTatCount++;
          g.totalLastSupportTatMs += sLast;
          g.lastSupportTatCount++;
        }
      });
    });

    return dateGroups;
  }

  // Render Date-Wise Breakdown & Tag Matrix Table
  function renderDateSummaryTable(threads) {
    const tbody = document.getElementById('date-summary-tbody');

    if (threads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="14" class="text-center empty-cell">No emails recorded for the selected period.</td></tr>`;
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
      if (dateSummarySort.column === 'avgSupportTat' || dateSummarySort.column === 'avgAllTat') {
        const avgA = a.supportTatCount > 0 ? a.totalSupportTatMs / a.supportTatCount : (a.allRepliesCount > 0 ? a.totalAllRepliesTatMs / a.allRepliesCount : 0);
        const avgB = b.supportTatCount > 0 ? b.totalSupportTatMs / b.supportTatCount : (b.allRepliesCount > 0 ? b.totalAllRepliesTatMs / b.allRepliesCount : 0);
        return factor * (avgA - avgB);
      }
      if (dateSummarySort.column === 'avgActualTat') {
        const avgA = a.actualTatCount > 0 ? a.totalActualTatMs / a.actualTatCount : 0;
        const avgB = b.actualTatCount > 0 ? b.totalActualTatMs / b.actualTatCount : 0;
        return factor * (avgA - avgB);
      }
      if (dateSummarySort.column === 'avgFirstSupportTat' || dateSummarySort.column === 'avgTat') {
        const avgA = a.firstSupportTatCount > 0 ? a.totalFirstSupportTatMs / a.firstSupportTatCount : (a.firstTatCount > 0 ? a.totalFirstTatMs / a.firstTatCount : 0);
        const avgB = b.firstSupportTatCount > 0 ? b.totalFirstSupportTatMs / b.firstSupportTatCount : (b.firstTatCount > 0 ? b.totalFirstTatMs / b.firstTatCount : 0);
        return factor * (avgA - avgB);
      }
      return factor * a.date.localeCompare(b.date);
    });

    const todayStr = TatUtils.formatDateKey(Date.now());

    tbody.innerHTML = groupList.map(g => {
      const avgSupportTat = g.supportTatCount > 0 ? TatUtils.formatSupportDuration(g.totalSupportTatMs / g.supportTatCount) : (g.allRepliesCount > 0 ? TatUtils.formatSupportDuration(g.totalAllRepliesTatMs / g.allRepliesCount) : 'Pending');
      const avgActualTat = g.actualTatCount > 0 ? TatUtils.formatActualDuration(g.totalActualTatMs / g.actualTatCount) : 'Pending';
      const avgFirstSupportTat = g.firstSupportTatCount > 0 ? TatUtils.formatSupportDuration(g.totalFirstSupportTatMs / g.firstSupportTatCount) : (g.firstTatCount > 0 ? TatUtils.formatSupportDuration(g.totalFirstTatMs / g.firstTatCount) : 'Pending');
      const isToday = g.date === todayStr;

      return `
        <tr>
          <td>
            <strong>${g.date}</strong>
            ${isToday ? '<span class="badge badge-sla" style="margin-left:6px; font-size:10px;">Today</span>' : ''}
          </td>
          <td><strong>${g.threads}</strong></td>
          <td>
            <strong>${g.custMails}</strong>
            <div style="font-size: 11px; margin-top: 2px;">
              <span style="color:#059669; font-weight:600;" title="Queries received during 10am-7pm Mon-Sat support hours">${g.custMailsSupport || 0} Supp</span>
              <span style="color:var(--text-muted);">/</span>
              <span style="color:#7c3aed; font-weight:600;" title="Queries received off-hours or Sunday">${g.custMailsOffHours || 0} Off</span>
            </div>
          </td>
          <td><strong>${g.reverts}</strong></td>
          <td><strong style="color: var(--primary);" title="Support Working Hours TAT (10am–7pm Mon–Sat)">${avgSupportTat}</strong></td>
          <td><strong style="color: #0284c7;" title="Non-Support / 24x7 actual total elapsed turnaround time">${avgActualTat}</strong></td>
          <td><span style="color: var(--text-muted); font-size: 12px;" title="Support hours 1st reply TAT">${avgFirstSupportTat}</span></td>
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
      tbody.innerHTML = `<tr><td colspan="11" class="text-center empty-cell">No thread logs found matching the filter.</td></tr>`;
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

      const firstSupportTatDisplay = t.firstResponseTimeMs !== null && t.firstResponseTimeMs !== undefined
        ? TatUtils.formatSupportDuration(t.firstResponseTimeMs)
        : '<span style="color:var(--warning);">⏳ Pending</span>';

      const firstActualTatDisplay = t.actualFirstResponseTimeMs !== null && t.actualFirstResponseTimeMs !== undefined
        ? TatUtils.formatActualDuration(t.actualFirstResponseTimeMs)
        : (t.firstResponseTimeMs !== null && t.firstResponseTimeMs !== undefined ? TatUtils.formatActualDuration(t.firstResponseTimeMs) : firstSupportTatDisplay);

      const lastTatVal = (t.latestResponseTimeMs !== null && t.latestResponseTimeMs !== undefined)
        ? t.latestResponseTimeMs
        : t.firstResponseTimeMs;

      const actualLastTatVal = (t.actualLatestResponseTimeMs !== null && t.actualLatestResponseTimeMs !== undefined)
        ? t.actualLatestResponseTimeMs
        : (t.actualFirstResponseTimeMs ?? lastTatVal);

      const lastSupportTatDisplay = lastTatVal !== null && lastTatVal !== undefined
        ? TatUtils.formatSupportDuration(lastTatVal)
        : '<span style="color:var(--warning);">⏳ Pending</span>';

      const lastActualTatDisplay = actualLastTatVal !== null && actualLastTatVal !== undefined
        ? TatUtils.formatActualDuration(actualLastTatVal)
        : lastSupportTatDisplay;

      const avgReplyTatStr = t.avgReplyTatMs !== null && t.avgReplyTatMs !== undefined
        ? TatUtils.formatSupportDuration(t.avgReplyTatMs)
        : (lastTatVal ? TatUtils.formatSupportDuration(lastTatVal) : 'N/A');

      const actualAvgReplyTatStr = t.actualAvgReplyTatMs !== null && t.actualAvgReplyTatMs !== undefined
        ? TatUtils.formatActualDuration(t.actualAvgReplyTatMs)
        : (actualLastTatVal ? TatUtils.formatActualDuration(actualLastTatVal) : avgReplyTatStr);

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

      const isQueryInSupport = t.initialQueryInSupportHours !== undefined
        ? t.initialQueryInSupportHours
        : TatUtils.isWithinSupportHours(t.initialCustomerTime, currentSettings);

      const windowBadgeHtml = isQueryInSupport
        ? '<div style="margin-top:2px;"><span class="badge-support-hours" title="Initial query received during Support Hours (10:00am–7:00pm Mon–Sat)">🏢 Support Hrs</span></div>'
        : '<div style="margin-top:2px;"><span class="badge-off-hours" title="Initial query received outside support hours (night or Sunday)">🌙 Off-Hours</span></div>';

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
            ${t.orderId ? `<span class="badge" style="background:#e0e7ff; color:#3730a3; font-weight:700; font-family:monospace; padding:3px 7px; border-radius:4px; font-size:11px; white-space:nowrap;" title="Order ID: ${escapeHtml(t.orderId)}">🛒 ${escapeHtml(t.orderId)}</span>` : '<span style="color:var(--text-muted); font-size:12px;">—</span>'}
          </td>
          <td>
            ${(t.customerRepliesText || t.customerQueriesText) ? `
              <div class="dash-cust-replies-cell" title="${escapeHtml(t.customerRepliesText || t.customerQueriesText)}">
                <span class="badge" style="background:#f8fafc; color:#1e293b; font-size:11px; padding:3px 7px; border-radius:4px; max-width:180px; display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border:1px solid #cbd5e1; cursor:pointer;" onclick="this.closest('tr').querySelector('.btn-view-audit').click()">
                  💬 ${escapeHtml(truncate((t.customerRepliesText || t.customerQueriesText).replace(/\n+/g, ' '), 28))}
                </span>
              </div>
            ` : '<span style="color:var(--text-muted); font-size:12px;">—</span>'}
          </td>
          <td>
            <strong>${t.dateKey || 'N/A'}</strong>
            ${windowBadgeHtml}
            ${multiDayNote}
          </td>
          <td>
            <strong>${t.customerMessageCount || t.customerQueryCount || 1}</strong>
            ${(t.customerReopenCount || 0) > 0 ? `<div style="margin-top:2px;"><span class="badge badge-reopened">${t.customerReopenCount}x reopen</span></div>` : ''}
          </td>
          <td>
            <div class="dash-tat-stack">
              <span class="dash-tat-main" style="color:var(--primary);" title="Support Working Hours TAT (10am–7pm Mon–Sat)">🏢 ${firstSupportTatDisplay}</span>
              <span class="dash-tat-sub" style="color:#0284c7; font-weight:600;" title="Non-Support / 24x7 actual elapsed time">🕒 24x7: ${firstActualTatDisplay}</span>
              <span class="dash-tat-sub">📩 Query: ${firstQueryStr}</span>
              <span class="dash-tat-sub">↩️ 1st Reply: ${firstReplyStr}</span>
            </div>
          </td>
          <td>
            <div class="dash-tat-stack">
              <span class="dash-tat-main" style="color: var(--success);" title="Support Working Hours TAT">🏢 ${lastSupportTatDisplay}</span>
              <span class="dash-tat-sub" style="color:#0284c7; font-weight:600;" title="Non-Support / 24x7 actual elapsed time">🕒 24x7: ${lastActualTatDisplay}</span>
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
                  <span style="font-size:10px;">Supp: ${avgReplyTatStr} | 24x7: ${actualAvgReplyTatStr}</span>
                </div>
                ${repliesList.length === 0 ? `
                  <div class="dash-tat-sub" style="text-align:center; padding:8px;">No replies recorded yet.</div>
                ` : repliesList.map(r => `
                  <div class="dash-reply-item">
                    <div class="dash-reply-item-top">
                      <span class="dash-reply-item-title">${r.replyIndex === 1 ? '1st Reply (Initial)' : `Reply #${r.replyIndex} (Reopen #${r.replyIndex - 1})`}</span>
                      <span class="dash-reply-item-tat" style="color:var(--primary);">🏢 Support: ${TatUtils.formatSupportDuration(r.supportTatMs ?? r.tatMs)}</span>
                    </div>
                    <div style="font-size:11px; color:#0284c7; font-weight:600; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
                      <span>🕒 24x7: ${TatUtils.formatActualDuration(r.actualTatMs ?? r.tatMs)}</span>
                      <span>${r.isSupportHours ? '<span class="badge-support-hours" style="font-size:9px; padding:1px 5px;">In-Shift Query</span>' : '<span class="badge-off-hours" style="font-size:9px; padding:1px 5px;">Off-Hours Query</span>'}</span>
                    </div>
                    <div class="dash-reply-item-times">
                      <div>📩 Customer Query: <strong>${TatUtils.formatShortDateTime(r.customerQueryTime)}</strong></div>
                      ${(!r.isSupportHours && r.effectiveSupportStartTime) ? `<div style="color:#6366f1;">🏢 Shift Clock Started: <strong>${TatUtils.formatShortDateTime(r.effectiveSupportStartTime)}</strong> (Next 10:00 AM)</div>` : ''}
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
    const actualLastTatVal = thread.actualLatestResponseTimeMs ?? thread.actualFirstResponseTimeMs ?? lastTatVal;
    const banner = document.getElementById('modal-meta-banner');
    banner.innerHTML = `
      <div class="meta-field">
        <span class="meta-field-label">Status & Tag</span>
        <span class="meta-field-val">${tagClass.primaryLabel}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Order ID</span>
        <span class="meta-field-val">${thread.orderId ? `<span class="badge" style="background:#e0e7ff; color:#3730a3; font-weight:700; font-family:monospace; padding:2px 6px; border-radius:4px; font-size:12px;">🛒 ${escapeHtml(thread.orderId)}</span>` : '<span style="color:var(--text-muted);">None</span>'}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Support 1st TAT (10am–7pm)</span>
        <span class="meta-field-val" style="color:var(--primary);">${TatUtils.formatSupportDuration(thread.firstResponseTimeMs)}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">24x7 Actual 1st TAT</span>
        <span class="meta-field-val" style="color:#0284c7;">${TatUtils.formatActualDuration(thread.actualFirstResponseTimeMs ?? thread.firstResponseTimeMs)}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Support Avg TAT</span>
        <span class="meta-field-val" style="color:var(--primary);">${TatUtils.formatSupportDuration(thread.avgReplyTatMs)}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">24x7 Actual Avg TAT</span>
        <span class="meta-field-val" style="color:#0284c7;">${TatUtils.formatActualDuration(thread.actualAvgReplyTatMs ?? thread.avgReplyTatMs)}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Last Query Support TAT</span>
        <span class="meta-field-val" style="color:var(--success);">${TatUtils.formatSupportDuration(lastTatVal)}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Last Query 24x7 TAT</span>
        <span class="meta-field-val" style="color:#0284c7;">${TatUtils.formatActualDuration(actualLastTatVal)}</span>
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

        const tatBadge = (evt.tatMs !== null && evt.tatMs !== undefined)
          ? `<div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:6px;">
               <span class="timeline-tat" style="background:#dbeafe; color:#1e40af;">🏢 Support: ${TatUtils.formatSupportDuration(evt.supportTatMs ?? evt.tatMs)}</span>
               <span class="timeline-tat" style="background:#e0f2fe; color:#0369a1;">🕒 24x7 Actual: ${TatUtils.formatActualDuration(evt.actualTatMs ?? evt.tatMs)}</span>
             </div>`
          : '';

        const customerBodyHtml = evt.body ? `
          <div style="margin-top:6px; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:12px; color:#334155; line-height:1.45; white-space:pre-wrap; max-height:180px; overflow-y:auto;">
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:#64748b; margin-bottom:4px;">Customer Query Message:</div>
            ${escapeHtml(evt.body)}
          </div>
        ` : '';

        return `
          <div class="timeline-item">
            <div class="timeline-node ${nodeClass}"></div>
            <div class="timeline-content">
              <div class="timeline-head">
                <span class="timeline-tag ${tagClass}">${tagLabel}</span>
                <span class="timeline-time">${TatUtils.formatDateTime(evt.timestamp)}</span>
              </div>
              <div class="timeline-note">${evt.sender} - ${evt.note}</div>
              ${customerBodyHtml}
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
        `Order ID: ${thread.orderId || 'None'}`,
        `Status: ${tagClass.primaryLabel}`,
        `Support 1st TAT (10am–7pm): ${TatUtils.formatSupportDuration(thread.firstResponseTimeMs)} | 24x7 Actual 1st TAT: ${TatUtils.formatActualDuration(thread.actualFirstResponseTimeMs ?? thread.firstResponseTimeMs)}`,
        `Support Last TAT: ${TatUtils.formatSupportDuration(lastTatVal)} | 24x7 Actual Last TAT: ${TatUtils.formatActualDuration(actualLastTatVal)}`,
        `Reverts: ${thread.agentReplyCount} | Reopened: ${thread.customerReopenCount}x`,
        ...(thread.customerRepliesText || thread.customerQueriesText ? [`--- Customer Email Replies ---`, thread.customerRepliesText || thread.customerQueriesText] : []),
        '--- Timeline ---',
        ...events.map(e => `[${TatUtils.formatDateTime(e.timestamp)}] ${e.sender}: ${e.note} ${e.tatMs ? `(Support: ${TatUtils.formatSupportDuration(e.supportTatMs ?? e.tatMs)} | 24x7: ${TatUtils.formatActualDuration(e.actualTatMs ?? e.tatMs)})` : ''}`)
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
      'Customer Mails (Total)',
      'Customer Mails (Support Hours 10am-7pm)',
      'Customer Mails (Off-Hours)',
      'Agent Replied Count',
      'Support Hours Avg TAT Over All Mails (Minutes)',
      'Support Hours Avg TAT Over All Mails (Readable)',
      'Non-Support / 24x7 Avg TAT Over All Mails (Minutes)',
      'Non-Support / 24x7 Avg TAT Over All Mails (Readable)',
      'Support Hours Avg 1st Response TAT (Minutes)',
      'Support Hours Avg 1st Response TAT (Readable)',
      'Non-Support / 24x7 Avg 1st Response TAT (Minutes)',
      'Non-Support / 24x7 Avg 1st Response TAT (Readable)',
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
      const avgSuppAllMins = g.supportTatCount > 0 ? (g.totalSupportTatMs / g.supportTatCount / 60000).toFixed(1) : (g.allRepliesCount > 0 ? (g.totalAllRepliesTatMs / g.allRepliesCount / 60000).toFixed(1) : 'N/A');
      const avgSuppAllReadable = g.supportTatCount > 0 ? TatUtils.formatSupportDuration(g.totalSupportTatMs / g.supportTatCount) : (g.allRepliesCount > 0 ? TatUtils.formatSupportDuration(g.totalAllRepliesTatMs / g.allRepliesCount) : 'N/A');

      const avgActAllMins = g.actualTatCount > 0 ? (g.totalActualTatMs / g.actualTatCount / 60000).toFixed(1) : 'N/A';
      const avgActAllReadable = g.actualTatCount > 0 ? TatUtils.formatActualDuration(g.totalActualTatMs / g.actualTatCount) : 'N/A';

      const avgSuppFirstMins = g.firstSupportTatCount > 0 ? (g.totalFirstSupportTatMs / g.firstSupportTatCount / 60000).toFixed(1) : (g.firstTatCount > 0 ? (g.totalFirstTatMs / g.firstTatCount / 60000).toFixed(1) : 'N/A');
      const avgSuppFirstReadable = g.firstSupportTatCount > 0 ? TatUtils.formatSupportDuration(g.totalFirstSupportTatMs / g.firstSupportTatCount) : (g.firstTatCount > 0 ? TatUtils.formatSupportDuration(g.totalFirstTatMs / g.firstTatCount) : 'N/A');

      const avgActFirstMins = g.firstActualTatCount > 0 ? (g.totalFirstActualTatMs / g.firstActualTatCount / 60000).toFixed(1) : 'N/A';
      const avgActFirstReadable = g.firstActualTatCount > 0 ? TatUtils.formatActualDuration(g.totalFirstActualTatMs / g.firstActualTatCount) : 'N/A';

      return [
        dk,
        g.threads,
        g.custMails,
        g.custMailsSupport || 0,
        g.custMailsOffHours || 0,
        g.reverts,
        avgSuppAllMins,
        avgSuppAllReadable,
        avgActAllMins,
        avgActAllReadable,
        avgSuppFirstMins,
        avgSuppFirstReadable,
        avgActFirstMins,
        avgActFirstReadable,
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
    if (bhStart) bhStart.value = currentSettings.businessHoursStart || '10:00';
    if (bhEnd) bhEnd.value = currentSettings.businessHoursEnd || '19:00';
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
    const bhStart = document.getElementById('setting-business-start') ? (document.getElementById('setting-business-start').value || '10:00') : '10:00';
    const bhEnd = document.getElementById('setting-business-end') ? (document.getElementById('setting-business-end').value || '19:00') : '19:00';

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
        customerBodies: [
          'Can you please clarify the taxes and charges on invoice #8492?'
        ],
        timeline: [
          { type: 'CUSTOMER_MSG', timestamp: now - (3 * oneHour), sender: 'robert.chen@acme.com', note: 'Initial Customer Query', body: 'Can you please clarify the taxes and charges on invoice #8492?' },
          { type: 'AGENT_REPLY', timestamp: now - (3 * oneHour) + (18 * oneMin), sender: 'You', revertIndex: 1, tatMs: 18 * oneMin, note: 'First Response' }
        ],
        lastUpdated: now - (2 * oneHour)
      },
      'mock_th_02': {
        threadId: 'mock_th_02',
        subject: 'API Webhook 500 error during high load #44553',
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
        customerBodies: [
          'Our production webhooks for order #44553 are failing with 500 internal server error.',
          'We are still seeing intermittent timeouts on this webhook after retrying.'
        ],
        timeline: [
          { type: 'CUSTOMER_MSG', timestamp: now - (2 * oneHour), sender: 'dev-lead@fintech.io', note: 'Initial Customer Query', body: 'Our production webhooks for order #44553 are failing with 500 internal server error.' },
          { type: 'AGENT_REPLY', timestamp: now - (2 * oneHour) + (35 * oneMin), sender: 'You', revertIndex: 1, tatMs: 35 * oneMin, note: 'First Response' },
          { type: 'REOPENED', timestamp: now - (1 * oneHour), sender: 'dev-lead@fintech.io', note: 'Customer reopened query (Reopen #1)', body: 'We are still seeing intermittent timeouts on this webhook after retrying.' }
        ],
        lastUpdated: now - (1 * oneHour)
      },
      'mock_th_03': {
        threadId: 'mock_th_03',
        subject: 'Request for custom enterprise contract pricing (ref 29410)',
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
        customerBodies: [
          'Hi team, we would like to negotiate pricing for order 29410.',
          'Could you also include SLA add-ons in the revised proposal?'
        ],
        timeline: [
          { type: 'CUSTOMER_MSG', timestamp: now - oneDay - (4 * oneHour), sender: 'procurement@globalcorp.org', note: 'Initial Customer Query', body: 'Hi team, we would like to negotiate pricing for order 29410.' },
          { type: 'AGENT_REPLY', timestamp: now - oneDay - (4 * oneHour) + (45 * oneMin), sender: 'You', revertIndex: 1, tatMs: 45 * oneMin, note: 'First Response' },
          { type: 'REOPENED', timestamp: now - oneDay - (2 * oneHour), sender: 'procurement@globalcorp.org', note: 'Customer reopened query (Reopen #1)', body: 'Could you also include SLA add-ons in the revised proposal?' },
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
        customerBodies: [
          'Please confirm when our SAML metadata signing certificate needs to be rotated.'
        ],
        timeline: [
          { type: 'CUSTOMER_MSG', timestamp: now - (2 * oneDay) - (5 * oneHour), sender: 'it-security@nexus.com', note: 'Initial Customer Query', body: 'Please confirm when our SAML metadata signing certificate needs to be rotated.' },
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
        customerBodies: [
          'The download links generated in the weekly PDF report lead to a 404 page.',
          'Still seeing this issue on the secondary workspace.',
          'Confirmed working now, thank you!'
        ],
        timeline: [
          { type: 'CUSTOMER_MSG', timestamp: now - (3 * oneDay) - (6 * oneHour), sender: 'danielle@growthpulse.co', note: 'Initial Customer Query', body: 'The download links generated in the weekly PDF report lead to a 404 page.' },
          { type: 'AGENT_REPLY', timestamp: now - (3 * oneDay) - (6 * oneHour) + (52 * oneMin), sender: 'You', revertIndex: 1, tatMs: 52 * oneMin, note: 'First Response' },
          { type: 'REOPENED', timestamp: now - (3 * oneDay) - (3 * oneHour), sender: 'danielle@growthpulse.co', note: 'Customer reopened query (Reopen #1)', body: 'Still seeing this issue on the secondary workspace.' },
          { type: 'AGENT_REPLY', timestamp: now - (3 * oneDay) - (2 * oneHour), sender: 'You', revertIndex: 2, tatMs: oneHour, note: 'Agent Revert #2' },
          { type: 'REOPENED', timestamp: now - (3 * oneDay) - (1 * oneHour), sender: 'danielle@growthpulse.co', note: 'Customer reopened query (Reopen #2)', body: 'Confirmed working now, thank you!' },
          { type: 'AGENT_REPLY', timestamp: now - (3 * oneDay) - (30 * oneMin), sender: 'You', revertIndex: 3, tatMs: 30 * oneMin, note: 'Agent Revert #3' }
        ],
        lastUpdated: now - (3 * oneDay)
      }
    };

    const normalizedMockThreads = {};
    Object.keys(mockThreads).forEach(k => {
      normalizedMockThreads[k] = TatUtils.normalizeThread(mockThreads[k], currentSettings);
    });

    await new Promise(r => chrome.storage.local.set({ threads: normalizedMockThreads }, r));
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
