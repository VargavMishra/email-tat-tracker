/**
 * Email TAT & SLA Tracker - Content Script for Gmail (mail.google.com)
 * Robust DOM Parser, Accurate Revert Counting & Live Updates
 */

(function () {
  'use strict';

  // Prevent Chrome from logging "Extension context invalidated" errors when extension is reloaded
  window.addEventListener('unhandledrejection', (event) => {
    if (event?.reason?.message?.includes('Extension context invalidated') || String(event?.reason).includes('Extension context invalidated')) {
      event.preventDefault();
    }
  });

  window.addEventListener('error', (event) => {
    if (event?.message?.includes('Extension context invalidated')) {
      event.preventDefault();
    }
  });

  console.log('[Email TAT Tracker] Content script initialized on Gmail.');

  let currentUserEmail = null;
  let currentUserName = null;
  let cachedSettings = null;
  let activeThreadId = null;
  let lastScannedData = null;
  let scanDebounceTimer = null;
  let liveHeartbeatInterval = null;
  let navigationInterval = null;
  let domObserver = null;

  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function cleanupOrphanedScript() {
    if (liveHeartbeatInterval) { clearInterval(liveHeartbeatInterval); liveHeartbeatInterval = null; }
    if (navigationInterval) { clearInterval(navigationInterval); navigationInterval = null; }
    if (scanDebounceTimer) { clearTimeout(scanDebounceTimer); scanDebounceTimer = null; }
    if (domObserver) { domObserver.disconnect(); domObserver = null; }
  }

  // Initialize settings & detect user email
  async function init() {
    if (!isExtensionValid()) return;
    cachedSettings = await TatUtils.getSettings();
    detectCurrentUserEmail();
    
    // Listen for storage changes (local and sync for multi-laptop operation)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!isExtensionValid()) return;
      if ((area === 'local' || area === 'sync') && changes.settings) {
        cachedSettings = changes.settings.newValue;
        scanCurrentThread(true);
      }
    });

    // Listen for messages from popup or background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (!isExtensionValid()) return;
      if (request.action === 'GET_ACTIVE_THREAD_DATA') {
        sendResponse({ data: lastScannedData, threadId: activeThreadId });
      } else if (request.action === 'FORCE_SCAN_THREAD') {
        scanCurrentThread(true);
        sendResponse({ success: true, data: lastScannedData });
      }
      return true;
    });

    // Navigation and DOM listeners
    setupNavigationListener();
    setupMutationObserver();
    setupSendButtonListener();
    setupLiveHeartbeat();
    
    // Initial check
    setTimeout(() => scanCurrentThread(), 800);
  }

  // Attempt to detect logged-in user's email from Gmail UI and page title
  function detectCurrentUserEmail() {
    if (cachedSettings && cachedSettings.agentEmails && cachedSettings.agentEmails.length > 0) {
      currentUserEmail = cachedSettings.agentEmails[0];
    }
    if (cachedSettings && cachedSettings.agentNames && cachedSettings.agentNames.length > 0) {
      currentUserName = cachedSettings.agentNames[0];
    }

    // 1. Gmail title almost always contains user email, e.g. "care@betterhood.in - Gmail"
    const titleMatch = (document.title || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (titleMatch) {
      currentUserEmail = titleMatch[0].toLowerCase();
      saveDetectedEmail(currentUserEmail);
    }

    // 2. Try Google Account profile button tooltip/aria-label / account switcher
    const accountElem = document.querySelector('header a[aria-label*="@"], a[aria-label*="Google Account:"], a[aria-label*="Google account:"], a[href*="SignOutOptions"], [data-hovercard-owner-id], a[href*="accounts.google.com"]');
    if (accountElem) {
      const label = accountElem.getAttribute('aria-label') || accountElem.getAttribute('title') || accountElem.getAttribute('href') || '';
      const emailMatch = label.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        currentUserEmail = emailMatch[0].toLowerCase();
        saveDetectedEmail(currentUserEmail);
      }
    }
  }

  function saveDetectedEmail(email, name) {
    if (!isExtensionValid()) return;
    if (email) currentUserEmail = email.toLowerCase();
    if (name && name.toLowerCase() !== 'me') currentUserName = name.trim();

    if (!cachedSettings) cachedSettings = { agentEmails: [], agentNames: [], slaThresholdHours: 2, autoDetectUser: true };
    if (!cachedSettings.agentEmails) cachedSettings.agentEmails = [];
    if (!cachedSettings.agentNames) cachedSettings.agentNames = [];

    let changed = false;
    if (currentUserEmail && !cachedSettings.agentEmails.includes(currentUserEmail)) {
      cachedSettings.agentEmails.push(currentUserEmail);
      changed = true;
    }
    if (currentUserName && !cachedSettings.agentNames.includes(currentUserName)) {
      cachedSettings.agentNames.push(currentUserName);
      changed = true;
    }
    if (changed) {
      TatUtils.saveSettings(cachedSettings);
    }
  }

  // Monitor URL changes
  function setupNavigationListener() {
    if (navigationInterval) clearInterval(navigationInterval);
    let lastUrl = window.location.href;
    navigationInterval = setInterval(() => {
      if (!isExtensionValid()) {
        cleanupOrphanedScript();
        return;
      }
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        scheduleScan(300);
      }
    }, 300);

    window.addEventListener('hashchange', () => scheduleScan(300));
    window.addEventListener('popstate', () => scheduleScan(300));
  }

  // MutationObserver to detect thread opening, message insertions, or label chip changes
  function setupMutationObserver() {
    if (domObserver) domObserver.disconnect();
    domObserver = new MutationObserver((mutations) => {
      if (!isExtensionValid()) {
        cleanupOrphanedScript();
        return;
      }
      let shouldScan = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
          for (const node of [...m.addedNodes, ...m.removedNodes]) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                node.matches?.('.adn, .kv, .kQ, .gE, .hP, .hN, .av, .at, .ha, [role="listitem"]') ||
                node.querySelector?.('.adn, .kv, .kQ, .gE, .hP, .hN, .av, .at, .ha')
              ) {
                shouldScan = true;
                break;
              }
            }
          }
        }
        if (shouldScan) break;
      }

      if (shouldScan) {
        scheduleScan(350);
      }
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Periodic heartbeat while viewing an email thread or inbox list (real-time tag & TAT sync)
  function setupLiveHeartbeat() {
    if (liveHeartbeatInterval) clearInterval(liveHeartbeatInterval);
    liveHeartbeatInterval = setInterval(() => {
      if (!isExtensionValid()) {
        cleanupOrphanedScript();
        return;
      }
      const subjectElem = document.querySelector('h2.hP');
      const hash = window.location.hash;
      const threadId = extractThreadId(hash, subjectElem);
      if (threadId && subjectElem && subjectElem.offsetParent !== null) {
        const currentCount = getThreadMessageContainers().length;
        const currentTags = extractThreadHeaderTags(subjectElem);
        const lastTags = (lastScannedData && lastScannedData.tags) || [];
        const tagsChanged = JSON.stringify([...currentTags].sort()) !== JSON.stringify([...lastTags].sort());

        if (tagsChanged || (lastScannedData && currentCount > 0 && currentCount !== lastScannedData.messageCount)) {
          scanCurrentThread();
        } else if (lastScannedData && lastScannedData.status === 'PENDING_REPLY') {
          updatePendingDurationDisplay();
        }
      } else {
        removeHudBanner();
        // If in inbox list view, periodically sync any visible thread row labels
        syncInboxRowLabels();
      }
    }, 2500);
  }

  // Sync labels for threads visible in Gmail list rows (tr.zA) to storage
  async function syncInboxRowLabels() {
    const rows = document.querySelectorAll('tr.zA');
    if (!rows || rows.length === 0) return;
    const allThreads = await TatUtils.getAllThreads();
    if (!allThreads || Object.keys(allThreads).length === 0) return;

    let updatedAny = false;
    rows.forEach(row => {
      const subjectSpan = row.querySelector('.bog span, span.bog');
      if (!subjectSpan) return;
      const rowSubject = subjectSpan.innerText.trim();
      if (!rowSubject) return;

      // Find if this thread exists in our storage
      const matchedKey = Object.keys(allThreads).find(k => {
        const t = allThreads[k];
        return t && t.subject && (t.subject === rowSubject || rowSubject.includes(t.subject) || t.subject.includes(rowSubject));
      });

      if (!matchedKey) return;
      const storedThread = allThreads[matchedKey];
      const labelNodes = row.querySelectorAll('.av, .at, .ar');
      const rowTagsRaw = [];
      labelNodes.forEach(ln => {
        const txt = (ln.innerText || ln.getAttribute('title') || '').trim();
        if (txt) rowTagsRaw.push(txt);
      });
      const cleanRowTags = TatUtils.cleanTagList(rowTagsRaw);
      const prevTags = storedThread.tags || [];

      if (JSON.stringify([...cleanRowTags].sort()) !== JSON.stringify([...prevTags].sort())) {
        storedThread.tags = cleanRowTags;
        allThreads[matchedKey] = TatUtils.normalizeThread(storedThread);
        updatedAny = true;
      }
    });

    if (updatedAny && isExtensionValid()) {
      chrome.storage.local.set({ threads: allThreads }, () => {});
    }
  }

  // Listen for user sending a reply
  function setupSendButtonListener() {
    const handleSendAction = () => {
      setTimeout(() => scanCurrentThread(true), 800);
      setTimeout(() => scanCurrentThread(true), 2000);
      setTimeout(() => scanCurrentThread(true), 4000);
    };

    document.addEventListener('click', (e) => {
      const sendTarget = e.target.closest('[role="button"][data-tooltip*="Send"], [role="button"][aria-label*="Send"], div[data-tooltip*="Send"], .T-I.J-J5-Ji.aoO.v7.T-I-atl.L3');
      if (sendTarget) {
        handleSendAction();
        return;
      }
      // Also rescan when user clicks to expand collapsed messages in an email thread
      const expandTarget = e.target.closest('.kQ, .adP, .kv, [aria-label*="Expand all"]');
      if (expandTarget) {
        setTimeout(() => scanCurrentThread(true), 350);
        setTimeout(() => scanCurrentThread(true), 900);
      }

      // Rescan when user clicks Gmail label menus or label chips
      const labelTarget = e.target.closest('[role="menuitemcheckbox"], [role="menuitem"], .b9, .J-N, [aria-label*="Label"], [data-tooltip*="Label"], [aria-label*="Labels"]');
      if (labelTarget) {
        setTimeout(() => scanCurrentThread(true), 350);
        setTimeout(() => scanCurrentThread(true), 1200);
      }
    }, true);

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#tat-replies-dropdown-wrap')) {
        const menu = document.getElementById('tat-replies-dropdown-menu');
        const btn = document.getElementById('tat-btn-replies-dropdown');
        const caret = document.getElementById('tat-dropdown-caret');
        if (menu) menu.classList.remove('open');
        if (btn) btn.classList.remove('active');
        if (caret) caret.innerText = '▾';
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        handleSendAction();
      } else if (e.key === 'Escape') {
        const menu = document.getElementById('tat-replies-dropdown-menu');
        const btn = document.getElementById('tat-btn-replies-dropdown');
        const caret = document.getElementById('tat-dropdown-caret');
        if (menu) menu.classList.remove('open');
        if (btn) btn.classList.remove('active');
        if (caret) caret.innerText = '▾';
      }
    }, true);
  }

  // Auto-expand collapsed messages in Gmail so DOM contains all customer reverts & full bodies
  function expandCollapsedMessagePills(threadId) {
    if (!threadId) return;

    // 1. Gmail conversation toolbar "Expand all" icon button (top right of conversation view)
    const expandAllBtn = document.querySelector(
      '[aria-label="Expand all"], [data-tooltip="Expand all"], [aria-label*="Expand all" i], [data-tooltip*="Expand all" i], button[aria-label*="Expand all" i]'
    );
    if (expandAllBtn && expandAllBtn.dataset.tatAutoExpanded !== threadId) {
      expandAllBtn.dataset.tatAutoExpanded = threadId;
      try {
        expandAllBtn.click();
        setTimeout(() => scanCurrentThread(true), 350);
        setTimeout(() => scanCurrentThread(true), 800);
        return;
      } catch (e) {
        console.debug('[Email TAT Tracker] Auto-expand all error:', e);
      }
    }

    // 2. Intermediate collapsed message groups (.kQ "N older messages")
    const collapsedPills = document.querySelectorAll('.kQ, [aria-label*="older messages" i], [data-tooltip*="older messages" i]');
    let triggered = false;
    collapsedPills.forEach(pill => {
      if (pill.dataset.tatAutoExpanded !== threadId) {
        pill.dataset.tatAutoExpanded = threadId;
        triggered = true;
        try { pill.click(); } catch (e) {}
      }
    });

    // 3. Individual collapsed messages ([aria-expanded="false"], .kv[role="button"])
    const collapsedItems = document.querySelectorAll('div[role="listitem"] [aria-expanded="false"], div[role="listitem"] .kv[role="button"], .h7.kv');
    collapsedItems.forEach(item => {
      if (item.dataset.tatAutoExpanded !== threadId) {
        item.dataset.tatAutoExpanded = threadId;
        triggered = true;
        try { item.click(); } catch (e) {}
      }
    });

    if (triggered) {
      setTimeout(() => scanCurrentThread(true), 350);
      setTimeout(() => scanCurrentThread(true), 800);
    }
  }

  function scheduleScan(delay = 400) {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => {
      scanCurrentThread();
    }, delay);
  }

  // Main scanner for the currently open email thread
  async function scanCurrentThread(force = false) {
    if (!isExtensionValid()) return;
    detectCurrentUserEmail();

    // Strictly verify an email thread is currently open and visible (NEVER render on Inbox list!)
    const subjectElem = document.querySelector('h2.hP');
    const hash = window.location.hash;
    const threadId = extractThreadId(hash, subjectElem);

    if (!threadId || !subjectElem || subjectElem.offsetParent === null) {
      removeHudBanner();
      activeThreadId = null;
      lastScannedData = null;
      return;
    }

    activeThreadId = threadId;
    const subject = subjectElem.innerText.trim() || '(No Subject)';

    // Automatically expand collapsed intermediate message groups and messages
    expandCollapsedMessagePills(threadId);

    // Extract thread-level labels (strictly from the open thread header, never sidebar!)
    const tags = extractThreadHeaderTags(subjectElem);

    // Parse messages inside the open thread (both expanded and collapsed)
    const messages = parseThreadMessages();
    if (!messages || messages.length === 0) {
      return;
    }

    // Determine customer info (ignoring automated system notifications like no-reply@, shipping@, etc.)
    const firstCustMsg = messages.find(m => !m.isAgent && !TatUtils.isSystemSender(m.senderEmail));
    let customerEmail = firstCustMsg ? firstCustMsg.senderEmail : '';
    let customerName = firstCustMsg ? firstCustMsg.senderName : '';

    // If no direct customer message was found yet, check if any message had a customer recipient (e.g. outbound shipment / review email sent to Pankaj)
    if (!customerEmail || customerEmail === 'customer@domain.com') {
      const msgWithCustRecipient = messages.find(m => m.recipientEmail && !m.recipientEmail.includes('betterhood') && m.recipientEmail.includes('@') && !TatUtils.isSystemSender(m.recipientEmail));
      if (msgWithCustRecipient) {
        customerEmail = msgWithCustRecipient.recipientEmail;
        customerName = customerEmail.split('@')[0];
      }
    }

    // Also check if subject contains customer name e.g. "Re: ⭐ Peter, what did you think..."
    if ((!customerName || customerName === 'customer' || customerName === 'Customer') && subject) {
      const subjMatch = subject.match(/(?:Re:\s*)?[^a-zA-Z0-9]*([A-Z][a-z]+),/);
      if (subjMatch) {
        customerName = subjMatch[1];
      }
    }

    if (!customerEmail) customerEmail = 'customer@domain.com';
    if (!customerName) customerName = customerEmail.split('@')[0];

    const agentEmails = [...((cachedSettings && cachedSettings.agentEmails) || [])];
    if (currentUserEmail && !agentEmails.includes(currentUserEmail)) {
      agentEmails.push(currentUserEmail);
    }

    // Analyze thread with accurate revert, tag & business hours logic
    const analysis = TatUtils.analyzeThread(
      threadId,
      subject,
      customerEmail,
      customerName,
      messages,
      agentEmails,
      tags,
      cachedSettings
    );

    // Save to storage (merges any earlier Day 1 replies if collapsed)
    const saved = await TatUtils.saveThread(analysis);
    lastScannedData = saved || analysis;

    // Inject/Update the HUD banner in Gmail
    renderHudBanner(lastScannedData);
  }

  // Extract thread ID strictly when a conversation thread is open
  function extractThreadId(hash, subjectElem = document.querySelector('h2.hP')) {
    // If there is no visible thread subject header, no thread is open
    if (!subjectElem || subjectElem.offsetParent === null) {
      return null;
    }

    const permId = subjectElem.getAttribute('data-thread-perm-id') || subjectElem.getAttribute('data-legacy-thread-id');
    if (permId) return permId;

    if (hash) {
      const cleanHash = hash.replace(/^#/, '').split('?')[0];
      const parts = cleanHash.split('/');
      if (parts.length >= 2) {
        const candidate = parts[parts.length - 1];
        if (candidate && candidate.length > 5 && !['inbox', 'starred', 'sent', 'drafts', 'all', 'trash', 'spam', 'imp'].includes(candidate.toLowerCase())) {
          return candidate;
        }
      }
    }

    return 'th_' + Math.abs(hashCode(subjectElem.innerText.trim()));
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  // Extract labels strictly from the open thread's subject header container (.ha)
  function extractThreadHeaderTags(subjectElem) {
    if (!subjectElem) return [];
    const headerWrapper = subjectElem.closest('.ha') || subjectElem.parentElement;
    if (!headerWrapper) return [];

    const labelNodes = headerWrapper.querySelectorAll('.hN, .av, .at, .ar, [data-tooltip*="Label"]');
    const raw = [];
    labelNodes.forEach(node => {
      let text = (node.innerText || node.getAttribute('title') || '').replace(/[\u200e\u200f]/g, '').trim();
      if (text) raw.push(text);
    });
    return TatUtils.cleanTagList(raw);
  }

  // Get all message containers strictly inside the open conversation thread (excluding Inbox list rows tr.zA)
  function getThreadMessageContainers() {
    const threadRoot = document.querySelector('div[role="main"] div[role="list"], .nH .hx') || document.querySelector('div[role="main"]');
    if (!threadRoot) return [];

    // Prefer role="listitem" inside role="list" (Gmail marks every message in a thread, expanded or collapsed, as role="listitem")
    let listItems = Array.from(threadRoot.querySelectorAll('div[role="listitem"]'))
      .filter(el => !el.closest('tr.zA, table.F'));
    if (listItems.length > 0) {
      // Deduplicate nested containers (keep outermost message container)
      return listItems.filter(el => !listItems.some(other => other !== el && other.contains(el)));
    }

    // Fallback: expanded (.adn) + collapsed 1-line rows (.kv) + collapsed group (.kQ)
    const nodes = Array.from(threadRoot.querySelectorAll('.adn, .kv, .kQ'))
      .filter(el => !el.closest('tr.zA, table.F'));

    // Deduplicate nested containers (e.g. if .adn and .kv are on same message)
    return nodes.filter(el => !nodes.some(other => other !== el && other.contains(el)));
  }

  // Extract clean message body text from Gmail message container (handles both expanded .a3s and collapsed .yd / .kv rows)
  function extractMessageBodyText(container) {
    if (!container) return '';
    try {
      // 1. Expanded message body container (.a3s is Gmail's universal message body class)
      const bodyElem = container.matches?.('.a3s')
        ? container
        : container.querySelector('.a3s.aiL, div.a3s, .ii.gt div.a3s, .adn .a3s, .a3s');

      if (bodyElem) {
        // Clone node so we don't modify the real Gmail DOM
        const clone = bodyElem.cloneNode(true);
        // Strip previous reply quotes (.gmail_quote, .gmail_extra, blockquote, .adO) and signatures
        const unwanted = clone.querySelectorAll('.gmail_quote, .gmail_extra, blockquote, .adO, .gmail_signature');
        unwanted.forEach(el => el.remove());

        // Attach clone temporarily to a hidden sandbox so Chromium computes full innerText layout with line breaks
        let cleanText = '';
        try {
          const sandbox = document.createElement('div');
          sandbox.style.cssText = 'position:fixed; left:-9999px; top:-9999px; width:800px; height:auto; opacity:0; pointer-events:none; z-index:-1;';
          sandbox.appendChild(clone);
          document.body.appendChild(sandbox);
          cleanText = sandbox.innerText || '';
          document.body.removeChild(sandbox);
        } catch (e) {
          cleanText = clone.innerText || clone.textContent || '';
        }

        cleanText = cleanText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (cleanText.length > 0) {
          return cleanText;
        }

        // Fallback: if stripping quotes removed everything (e.g. customer replied inline inside a quote), use original text
        let rawText = (bodyElem.innerText || bodyElem.textContent || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (rawText.length > 0) {
          return rawText;
        }
      }

      // 2. Collapsed message snippet extraction (when message body is not yet expanded in Gmail DOM)
      const snippetElem = container.querySelector('span.yd, div.yd, span.adx, div.adx, span.y6, [data-snippet], .yj span, .y2');
      if (snippetElem) {
        let snippetText = (snippetElem.innerText || snippetElem.textContent || '').trim();
        snippetText = snippetText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
        if (snippetText.length > 0) {
          return snippetText;
        }
      }

      // 3. Fallback for collapsed 1-line row (.kv)
      const kvElem = container.matches?.('.kv') ? container : container.querySelector('.kv');
      if (kvElem) {
        const cloneKv = kvElem.cloneNode(true);
        const exclude = cloneKv.querySelectorAll('.zF, .yP, .gD, .g3, .xW, time, .av, .at, .ar, [role="button"], [role="checkbox"]');
        exclude.forEach(el => el.remove());
        let rawSnippet = (cloneKv.innerText || cloneKv.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim();
        if (rawSnippet.length > 3) {
          return rawSnippet;
        }
      }
    } catch (e) {
      console.debug('[Email TAT Tracker] Body extraction error:', e);
    }
    return '';
  }

  // Parse all messages in the open thread (Expanded & Collapsed)
  function parseThreadMessages() {
    const parsedList = [];
    const agentEmails = [...((cachedSettings && cachedSettings.agentEmails) || [])];
    const agentNames = [...((cachedSettings && cachedSettings.agentNames) || [])];

    if (currentUserEmail && !agentEmails.includes(currentUserEmail)) {
      agentEmails.push(currentUserEmail);
    }
    if (currentUserName && !agentNames.includes(currentUserName)) {
      agentNames.push(currentUserName);
    }

    const allMessageContainers = getThreadMessageContainers();

    // First pass: extract raw sender info and auto-learn agent email & display name from expanded messages
    const rawMessages = allMessageContainers.map((container, index) => {
      let senderEmail = '';
      let senderName = '';
      let recipientEmail = '';
      let recipientName = '';

      // 1. Precise Sender Extraction:
      // Expanded message sender: span.gD or [data-hovercard-id].gD (Gmail's explicit From: element)
      const fromElem = container.querySelector('span.gD, [data-hovercard-id].gD, .gD');
      // Collapsed message sender: span.yP (unread/inbox) or span.zF (read)
      const collapsedFromElem = container.querySelector('span.yP, span.zF, .yP, .zF');

      const senderElem = fromElem || collapsedFromElem;
      if (senderElem) {
        senderEmail = (senderElem.getAttribute('email') || senderElem.getAttribute('data-hovercard-id') || '').toLowerCase().trim();
        senderName = (senderElem.getAttribute('name') || senderElem.innerText || '').trim();
      }

      // If senderElem didn't have email, look for any [email] that is NOT inside recipient container (.bA4, .g2, .hb, .ajv)
      if (!senderEmail) {
        const fallbackSender = container.querySelector('[email]:not(.bA4 [email]):not(.g2 [email]):not(.hb [email]):not(.ajv [email])');
        if (fallbackSender) {
          senderEmail = (fallbackSender.getAttribute('email') || '').toLowerCase().trim();
          if (!senderName) senderName = (fallbackSender.getAttribute('name') || fallbackSender.innerText || '').trim();
        }
      }

      // 2. Precise Recipient Extraction (To / Cc):
      // Recipient is inside .bA4 (To: container), .g2, .hb, or .ajv
      const toElem = container.querySelector('.bA4 span[email], .bA4 [data-hovercard-id], .g2 span[email], .hb span[email], .ajv [email]');
      if (toElem) {
        recipientEmail = (toElem.getAttribute('email') || toElem.getAttribute('data-hovercard-id') || '').toLowerCase().trim();
        recipientName = (toElem.getAttribute('name') || toElem.innerText || '').trim();
      }

      const isMeText = senderName.toLowerCase() === 'me' || (senderElem && senderElem.innerText.trim().toLowerCase() === 'me');
      const matchesKnownEmail = Boolean(senderEmail && agentEmails.some(ae => ae.toLowerCase() === senderEmail));

      // If this message is from the agent (via email match or "me"), learn both email and display name for collapsed rows!
      if ((isMeText || matchesKnownEmail) && (senderEmail || senderName)) {
        saveDetectedEmail(senderEmail, senderName);
        if (senderEmail && !agentEmails.includes(senderEmail)) agentEmails.push(senderEmail);
        if (senderName && senderName.toLowerCase() !== 'me' && !agentNames.includes(senderName)) agentNames.push(senderName);
      }

      // Find timestamp: prioritize .g3 (Gmail's message timestamp element) first!
      let timestamp = null;
      const primaryTimeCandidates = container.querySelectorAll('.g3, .xW span, time, [data-timestamp]');
      const fallbackTimeCandidates = container.querySelectorAll('span[title]');
      const allTimeCandidates = [...Array.from(primaryTimeCandidates), ...Array.from(fallbackTimeCandidates)];

      for (const elem of allTimeCandidates) {
        const titleAttr = elem.getAttribute('title');
        if (titleAttr) {
          timestamp = TatUtils.parseTimestamp(titleAttr);
          if (timestamp) break;
        }
        const ariaAttr = elem.getAttribute('aria-label');
        if (ariaAttr) {
          timestamp = TatUtils.parseTimestamp(ariaAttr);
          if (timestamp) break;
        }
        const textVal = elem.innerText ? elem.innerText.trim() : '';
        if (textVal) {
          timestamp = TatUtils.parseTimestamp(textVal);
          if (timestamp) break;
        }
      }

      // Extract clean message body text
      const body = extractMessageBodyText(container);

      return {
        senderEmail,
        senderName,
        recipientEmail,
        recipientName,
        isMeText,
        timestamp,
        body,
        index
      };
    });

    // Second pass: classify each message using complete agentEmails & agentNames
    rawMessages.forEach((msg, idx) => {
      const senderEmailLower = (msg.senderEmail || '').toLowerCase().trim();
      const senderNameLower = (msg.senderName || '').toLowerCase().trim();
      const recipientEmailLower = (msg.recipientEmail || '').toLowerCase().trim();

      const isAgentEmail = Boolean(
        senderEmailLower && (
          (currentUserEmail && senderEmailLower === currentUserEmail.toLowerCase().trim()) ||
          agentEmails.some(ae => ae && ae.toLowerCase().trim() === senderEmailLower) ||
          senderEmailLower.endsWith('@betterhood.in') ||
          senderEmailLower.includes('betterhood')
        )
      );

      const isAgentName = Boolean(
        senderNameLower && (
          (currentUserName && senderNameLower === currentUserName.toLowerCase().trim()) ||
          agentNames.some(an => an && an.toLowerCase().trim() === senderNameLower) ||
          senderNameLower.includes('betterhood') ||
          senderNameLower.includes('customer care') ||
          senderNameLower.includes('support team')
        )
      );

      const isReceivedByAgent = Boolean(
        recipientEmailLower && (
          (currentUserEmail && recipientEmailLower === currentUserEmail.toLowerCase().trim()) ||
          agentEmails.some(ae => ae && ae.toLowerCase().trim() === recipientEmailLower) ||
          recipientEmailLower.endsWith('@betterhood.in') ||
          recipientEmailLower.includes('betterhood')
        )
      );

      const isSystemSender = TatUtils.isSystemSender(senderEmailLower);

      let isAgent = false;
      if (msg.isMeText || isAgentEmail || isAgentName || isSystemSender) {
        isAgent = true;
      } else if (isReceivedByAgent) {
        isAgent = false;
      } else if (TatUtils.isLikelyAgentSender(senderEmailLower, '', agentEmails, currentUserEmail)) {
        isAgent = true;
      } else {
        isAgent = false;
      }

      // Ensure chronological ordering in Gmail's top-to-bottom DOM sequence
      let timestamp = msg.timestamp;
      if (!timestamp) {
        timestamp = Date.now() - ((rawMessages.length - idx) * 60000);
      } else if (idx > 0 && parsedList[idx - 1] && timestamp < parsedList[idx - 1].timestamp) {
        timestamp = parsedList[idx - 1].timestamp + 1000;
      }

      parsedList.push({
        senderEmail: msg.senderEmail || (isAgent ? (currentUserEmail || 'care@betterhood.in') : 'customer@domain.com'),
        senderName: msg.senderName || (isAgent ? 'You' : 'Customer'),
        recipientEmail: msg.recipientEmail || '',
        recipientName: msg.recipientName || '',
        isAgent,
        isMeText: msg.isMeText,
        timestamp,
        body: msg.body || '',
        domIndex: idx
      });
    });

    return parsedList;
  }

  // Inject or update the floating HUD Banner at the top of the Gmail thread (Earlier Clean Layout + Collapsible Replies Dropdown)
  function renderHudBanner(data) {
    let banner = document.getElementById('tat-hud-banner');
    const existingMenu = document.getElementById('tat-replies-dropdown-menu');
    const wasDropdownOpen = existingMenu ? existingMenu.classList.contains('open') : false;

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'tat-hud-banner';
      banner.className = 'tat-hud-container';

      const targetContainer = document.querySelector('.nH .hx, div[role="main"] .nH, h2.hP');
      if (targetContainer) {
        if (targetContainer.tagName === 'H2') {
          targetContainer.parentNode.insertBefore(banner, targetContainer);
        } else {
          targetContainer.prepend(banner);
        }
      } else {
        document.body.appendChild(banner);
      }
    }

    const tagClass = data.tagClassification || TatUtils.classifyThreadTags(data.tags || [], data);
    const isResolved = data.status === 'RESOLVED' || tagClass.isResolved;
    let statusLabel = 'Follow Up Needed';
    let statusBadgeClass = 'tat-status-pending';

    if (isResolved) {
      statusLabel = 'Resolved';
      statusBadgeClass = 'tat-status-resolved';
    } else if (tagClass.isFollowUpReturn) {
      statusLabel = 'Follow up / Return';
      statusBadgeClass = 'tat-status-return';
    } else if (tagClass.isFollowUpReplacement) {
      statusLabel = 'Follow up / Replacement';
      statusBadgeClass = 'tat-status-replacement';
    } else if (tagClass.isPaymentPending) {
      statusLabel = 'Payment Pending';
      statusBadgeClass = 'tat-status-payment';
    } else {
      statusLabel = 'Follow Up Needed';
      statusBadgeClass = 'tat-status-pending';
    }

    const repliesList = Array.isArray(data.repliesList) ? data.repliesList : [];

    const firstTatDisplay = (data.firstResponseTimeMs !== null && data.firstResponseTimeMs !== undefined)
      ? TatUtils.formatSupportDuration(data.firstResponseTimeMs)
      : (data.customerQueryCount === 0 && !data.pendingSince ? 'Outbound' : 'Awaiting Reply');

    const isWaitingOnLatestQuery = !isResolved && (
      (data.customerQueryCount || 0) > (data.agentReplyCount || 0) ||
      (data.latestCustomerTime && data.latestAgentTime && data.latestCustomerTime > data.latestAgentTime)
    );

    const lastTatDisplay = (data.latestResponseTimeMs !== null && data.latestResponseTimeMs !== undefined && !isWaitingOnLatestQuery)
      ? TatUtils.formatSupportDuration(data.latestResponseTimeMs)
      : (data.agentReplyCount > 0 ? 'Awaiting Reply' : firstTatDisplay);

    const avgReplyTatDisplay = data.avgReplyTatMs !== null && data.avgReplyTatMs !== undefined
      ? TatUtils.formatSupportDuration(data.avgReplyTatMs)
      : firstTatDisplay;

    const lastQueryTimeStr = data.lastRepliedCustomerQueryTime
      ? TatUtils.formatShortDateTime(data.lastRepliedCustomerQueryTime)
      : (data.latestCustomerTime ? TatUtils.formatShortDateTime(data.latestCustomerTime) : 'N/A');

    const lastReplyTimeStr = data.lastRepliedAgentTime
      ? TatUtils.formatShortDateTime(data.lastRepliedAgentTime)
      : (data.latestAgentTime ? TatUtils.formatShortDateTime(data.latestAgentTime) : 'Pending');

    const pendingDisplay = data.currentPendingDurationMs 
      ? TatUtils.formatSupportDuration(data.currentPendingDurationMs) 
      : '0s';

    banner.innerHTML = `
      <div class="tat-hud-card">
        <div class="tat-hud-left">
          <div class="tat-hud-title-row">
            <div class="tat-brand-logo">
              <span class="tat-icon-clock">⏱️</span>
              <span class="tat-brand-text">TAT Tracker</span>
            </div>
            <span class="tat-status-pill ${statusBadgeClass}">
              ${isResolved ? '✓ ' : '⏳ '}${statusLabel}
            </span>
            ${data.orderId ? `<span class="tat-order-badge" style="background:#e0e7ff; color:#3730a3; padding:2px 8px; border-radius:12px; font-weight:700; font-size:11px; margin-left:6px; font-family:monospace;" title="Order ID detected: ${data.orderId}">🛒 ${data.orderId}</span>` : ''}
            ${data.customerReopenCount > 0 ? `<span class="tat-reopen-badge">🔁 Reopened ${data.customerReopenCount}x</span>` : ''}
            <span class="tat-agent-id-tag" title="Tracking as agent: ${currentUserEmail || 'Auto-detecting...'}">
              👤 ${currentUserEmail ? currentUserEmail.split('@')[0] : 'Agent'}
            </span>
          </div>
          <div class="tat-metrics-row">
            <div class="tat-metric-item" title="1st Customer Query: ${TatUtils.formatShortDateTime(data.initialCustomerTime)} → 1st Reply: ${TatUtils.formatShortDateTime(data.firstAgentTime)}">
              <span class="tat-label">First Response TAT</span>
              <span class="tat-val ${data.firstResponseTimeMs !== null ? 'tat-highlight' : ''}">${firstTatDisplay}</span>
            </div>
            <div class="tat-metric-divider"></div>
            <div class="tat-metric-item" title="Last Customer Query: ${lastQueryTimeStr} → Your Reply: ${lastReplyTimeStr}">
              <span class="tat-label">Last Query → Reply</span>
              <span class="tat-val ${data.latestResponseTimeMs !== null && !isWaitingOnLatestQuery ? 'tat-highlight' : ''}">${lastTatDisplay}</span>
            </div>
            <div class="tat-metric-divider"></div>
            <div class="tat-metric-item tat-replies-dropdown-wrap" id="tat-replies-dropdown-wrap">
              <span class="tat-label">All Replies TAT</span>
              <button type="button" id="tat-btn-replies-dropdown" class="tat-replies-dropdown-btn ${wasDropdownOpen ? 'active' : ''}" title="Click to open or close all replies TAT breakdown">
                <span>${data.agentReplyCount || 0} ${(data.agentReplyCount === 1) ? 'Reply' : 'Replies'}</span>
                <span id="tat-dropdown-caret" class="tat-dropdown-caret">${wasDropdownOpen ? '▴' : '▾'}</span>
              </button>
              <div id="tat-replies-dropdown-menu" class="tat-replies-dropdown-menu ${wasDropdownOpen ? 'open' : ''}">
                <div class="tat-dropdown-menu-header">
                  <span>All Agent Replies (${repliesList.length})</span>
                  <div class="tat-dropdown-header-right">
                    <span class="tat-dropdown-avg-badge">Avg: ${avgReplyTatDisplay}</span>
                    <button type="button" id="tat-dropdown-close-btn" class="tat-dropdown-close-btn" title="Close dropdown">&times;</button>
                  </div>
                </div>
                <div class="tat-dropdown-list">
                  ${repliesList.length === 0 ? `
                    <div class="tat-dropdown-empty">No agent replies recorded in this thread yet.</div>
                  ` : repliesList.map(r => `
                    <div class="tat-dropdown-reply-item">
                      <div class="tat-dropdown-reply-top">
                        <span class="tat-dropdown-reply-title">${r.replyIndex === 1 ? '1st Reply (Initial)' : `Reply #${r.replyIndex} (Reopen #${r.replyIndex - 1})`}</span>
                        <span class="tat-dropdown-reply-tat" title="Support Hours TAT (10am–7pm Mon–Sat)">🏢 ${TatUtils.formatSupportDuration(r.supportTatMs ?? r.tatMs)}</span>
                      </div>
                      ${r.actualTatMs !== undefined ? `
                        <div style="font-size:11px; color:#0284c7; font-weight:600; margin: 2px 0 4px 0;">
                          🕒 24x7 Actual: ${TatUtils.formatActualDuration(r.actualTatMs)}
                        </div>
                      ` : ''}
                      <div class="tat-dropdown-reply-times">
                        <div><span>📩 Customer Query:</span> <strong>${TatUtils.formatShortDateTime(r.customerQueryTime)}</strong></div>
                        ${(!r.isSupportHours && r.effectiveSupportStartTime) ? `<div style="color:#6366f1;"><span>🏢 Shift Clock Started:</span> <strong>${TatUtils.formatShortDateTime(r.effectiveSupportStartTime)}</strong> (Next 10:00 AM)</div>` : ''}
                        <div><span>↩️ You Replied:</span> <strong>${TatUtils.formatShortDateTime(r.agentReplyTime)}</strong></div>
                      </div>
                    </div>
                  `).join('')}
                  ${!isResolved && data.pendingSince ? `
                    <div class="tat-dropdown-reply-item" style="border-color: rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.08);">
                      <div class="tat-dropdown-reply-top">
                        <span class="tat-dropdown-reply-title" style="color: #d97706;">⏳ Latest Customer Query (Awaiting Reply)</span>
                        <span class="tat-dropdown-reply-tat" style="color: #d97706; background: rgba(245, 158, 11, 0.18);">${pendingDisplay}</span>
                      </div>
                      <div class="tat-dropdown-reply-times">
                        <div><span>📩 Customer Queried:</span> <strong>${TatUtils.formatShortDateTime(data.pendingSince)}</strong></div>
                      </div>
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
            <div class="tat-metric-divider"></div>
            <div class="tat-metric-item">
              <span class="tat-label">Customer Queries</span>
              <span class="tat-val">${data.customerQueryCount || 0}</span>
            </div>
            ${!isResolved && data.pendingSince ? `
              <div class="tat-metric-divider"></div>
              <div class="tat-metric-item">
                <span class="tat-label">Waiting On You</span>
                <span id="tat-live-pending-val" class="tat-val tat-pending-time">${pendingDisplay}</span>
              </div>
            ` : ''}
          </div>
        </div>
        <div class="tat-hud-right">
          <button id="tat-btn-copy" class="tat-action-btn" title="Copy TAT Summary to Clipboard">📋 Copy TAT</button>
          <button id="tat-btn-history-toggle" class="tat-action-btn" title="View thread revert & reopen history">📜 History</button>
          <button id="tat-btn-rescan" class="tat-action-btn" title="Rescan & Live Update">🔄 Sync</button>
          <button id="tat-btn-dashboard" class="tat-action-btn tat-btn-primary" title="Open Full Analytics Dashboard">📊 Dashboard</button>
        </div>
      </div>
      <div id="tat-hud-drawer" class="tat-hud-drawer" style="display: none;">
        <div class="tat-drawer-header">
          <span class="tat-drawer-title">Thread Message Audit History</span>
          <span class="tat-drawer-close">&times;</span>
        </div>
        <div class="tat-drawer-events">
          ${(data.timeline || []).length === 0 ? '<div style="color:#64748b; font-size:11px;">No messages detected in this thread.</div>' : ''}
          ${(data.timeline || []).map(evt => {
            const isAgent = evt.type === 'AGENT_REPLY' || evt.type === 'AGENT_FOLLOWUP';
            const isReopen = evt.type === 'REOPENED';
            const badgeType = isAgent ? 'tat-tag-agent' : (isReopen ? 'tat-tag-reopen' : 'tat-tag-cust');
            const label = evt.type === 'AGENT_REPLY' 
              ? `Agent Revert #${evt.revertIndex}` 
              : (evt.type === 'AGENT_FOLLOWUP' ? 'Agent Follow-up' : (isReopen ? 'Customer Reopened' : 'Customer Query'));
            let tatText = '';
            if (evt.tatMs !== null && evt.tatMs !== undefined) {
              const suppTat = evt.supportTatMs ?? evt.tatMs;
              const actTat = evt.actualTatMs ?? evt.tatMs;
              tatText = ` • Support: ${TatUtils.formatSupportDuration(suppTat)} (24x7: ${TatUtils.formatActualDuration(actTat)})`;
            }
            return `
              <div class="tat-drawer-item">
                <span class="tat-drawer-tag ${badgeType}">${label}</span>
                <span class="tat-drawer-time">${TatUtils.formatDateTime(evt.timestamp)}${tatText}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Dropdown open/close toggle listeners
    const dropdownBtn = banner.querySelector('#tat-btn-replies-dropdown');
    const dropdownMenu = banner.querySelector('#tat-replies-dropdown-menu');
    const dropdownCaret = banner.querySelector('#tat-dropdown-caret');
    const dropdownCloseBtn = banner.querySelector('#tat-dropdown-close-btn');

    const setDropdownState = (open) => {
      if (!dropdownMenu || !dropdownBtn) return;
      dropdownMenu.classList.toggle('open', open);
      dropdownBtn.classList.toggle('active', open);
      if (dropdownCaret) dropdownCaret.innerText = open ? '▴' : '▾';
    };

    if (dropdownBtn && dropdownMenu) {
      dropdownBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isNowOpen = !dropdownMenu.classList.contains('open');
        setDropdownState(isNowOpen);
      });
      dropdownMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    if (dropdownCloseBtn) {
      dropdownCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropdownState(false);
      });
    }

    // Attach listeners
    const rescanBtn = banner.querySelector('#tat-btn-rescan');
    rescanBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      rescanBtn.innerText = '⏳';
      await scanCurrentThread(true);
      rescanBtn.innerText = '✓ Synced';
      setTimeout(() => { rescanBtn.innerText = '🔄 Sync'; }, 1500);
    });

    banner.querySelector('#tat-btn-dashboard').addEventListener('click', (e) => {
      e.preventDefault();
      if (isExtensionValid()) {
        chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' }, () => {
          if (chrome.runtime?.lastError) {}
        });
      }
    });

    const copyBtn = banner.querySelector('#tat-btn-copy');
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const repliesSummary = repliesList.map(r => `#${r.replyIndex}: Support ${TatUtils.formatSupportDuration(r.supportTatMs ?? r.tatMs)} (24x7: ${TatUtils.formatActualDuration(r.actualTatMs ?? r.tatMs)})`).join(', ');
      const orderIdPart = data.orderId ? ` | Order ID: ${data.orderId}` : '';
      const summaryText = `[Email TAT] Subject: "${data.subject}"${orderIdPart} | 1st TAT: ${firstTatDisplay} | Last Reply TAT: ${lastTatDisplay} | Replies (${data.agentReplyCount}): [${repliesSummary || 'None'}] | Reopens: ${data.customerReopenCount}x | Status: ${statusLabel}`;
      navigator.clipboard.writeText(summaryText).then(() => {
        copyBtn.innerText = 'Copied! ✓';
        copyBtn.classList.add('tat-btn-success-flash');
        setTimeout(() => {
          copyBtn.innerText = '📋 Copy TAT';
          copyBtn.classList.remove('tat-btn-success-flash');
        }, 2000);
      });
    });

    const drawer = banner.querySelector('#tat-hud-drawer');
    const historyBtn = banner.querySelector('#tat-btn-history-toggle');
    historyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isHidden = drawer.style.display === 'none';
      drawer.style.display = isHidden ? 'block' : 'none';
      historyBtn.classList.toggle('tat-btn-active', isHidden);
    });

    banner.querySelector('.tat-drawer-close').addEventListener('click', () => {
      drawer.style.display = 'none';
      historyBtn.classList.remove('tat-btn-active');
    });
  }

  function updatePendingDurationDisplay() {
    const pendingValElem = document.getElementById('tat-live-pending-val');
    if (pendingValElem && lastScannedData && lastScannedData.pendingSince) {
      const now = Date.now();
      const durMs = TatUtils.computeBusinessDurationMs(lastScannedData.pendingSince, now, cachedSettings);
      pendingValElem.innerText = TatUtils.formatSupportDuration(durMs);
    }
  }

  function removeHudBanner() {
    const banner = document.getElementById('tat-hud-banner');
    if (banner) banner.remove();
  }

  // Run initial setup
  init();
})();
