/**
 * ==============================================================================
 * EMAIL TAT TRACKER - 24/7 CLOUD AUTOMATION & GOOGLE SHEETS DUMP SCRIPT
 * ==============================================================================
 * 
 * PURPOSE:
 * Solves the multi-laptop and offline problem:
 * - Runs 24/7 on Google Cloud servers (via automated Google Apps Script trigger).
 * - Even if you turn off both laptops or take a day off, this script runs daily,
 *   scans all customer queries & reverts in Gmail, calculates TAT (Support Hours 10am-7pm
 *   Mon-Sat vs 24x7 actual), extracts Order ID (#44553 or 5 digits), extracts customer
 *   email replies (1: ... \n\n 2: ...), and logs everything into your Google Sheet!
 * - Serves as a Webhook for your Chrome Extension on Laptop 1 & Laptop 2 so both
 *   laptops stay 100% synchronized!
 * 
 * ------------------------------------------------------------------------------
 * SETUP INSTRUCTIONS (Takes ~2 minutes):
 * ------------------------------------------------------------------------------
 * 1. Open Google Sheets (https://sheets.new) to create a new blank spreadsheet.
 *    Name it: "Email TAT Tracker Master Dump".
 * 2. In the top menu, click Extensions > Apps Script.
 * 3. Delete any default code in Code.gs, and paste this ENTIRE file into the editor.
 * 4. Update the CONFIG section below if your support email is different from care@betterhood.in.
 * 5. Run the function "setupDailyTrigger" once:
 *    - In the toolbar dropdown select "setupDailyTrigger" and click "Run".
 *    - Click "Review permissions" > choose your Google account > "Advanced" > "Go to Untitled project (unsafe)" > "Allow".
 *    - Done! Your automated 24/7 cloud scan is now active!
 * 6. (Optional) Deploy as Web App for Live Chrome Extension Multi-Laptop Sync:
 *    - Click "Deploy" > "New deployment".
 *    - Click the gear icon > select "Web app".
 *    - Description: "Email TAT Tracker Cloud Sync".
 *    - Execute as: "Me".
 *    - Who has access: "Anyone" (allows your extension on any laptop to sync without auth prompts).
 *    - Click "Deploy" and copy the Web App URL.
 *    - Open Extension Dashboard on Laptop 1 & Laptop 2 > Settings > Paste into "Cloud Sync Webhook URL".
 * ==============================================================================
 */

const CONFIG = {
  // Support agent emails (messages from these are counted as agent reverts)
  AGENT_EMAILS: ['care@betterhood.in'],
  AGENT_DOMAINS: ['betterhood.in'],

  // Working Support Hours: 10:00 AM to 7:00 PM (10:00 to 19:00)
  BUSINESS_START_HOUR: 10,
  BUSINESS_START_MIN: 0,
  BUSINESS_END_HOUR: 19,
  BUSINESS_END_MIN: 0,

  // Working Days: Monday (1) through Saturday (6). Sunday (0) is OFF.
  BUSINESS_DAYS: [1, 2, 3, 4, 5, 6],

  // Google Sheet tab names
  MASTER_SHEET_NAME: 'Email TAT Master Dump',
  DAILY_SHEET_NAME: 'Daily Performance Summary',

  // Automated notification senders to ignore (never treated as customer queries)
  SYSTEM_SENDERS: [
    'no-reply', 'noreply', 'donotreply', 'support-auto', 'mailer-daemon',
    'notification', 'notifications', 'order-update', 'orders-update',
    'shipping', 'courier', 'dispatch', 'tracking', 'delivery',
    'delhivery', 'bluedart', 'xpressbees', 'shadowfax', 'ekart', 'dtdc',
    'shiprocket', 'pickrr', 'unicommerce', 'shopify', 'woocommerce'
  ]
};

/**
 * 1-Click Setup: Automatically schedules a daily trigger to run at 7:30 PM every evening
 */
function setupDailyTrigger() {
  // Clear any existing triggers for dailyAutoScan to prevent duplicate runs
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailyAutoScan') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Create daily trigger at 7:30 PM (after support hours end at 7:00 PM)
  ScriptApp.newTrigger('dailyAutoScan')
    .timeBased()
    .everyDays(1)
    .atHour(19)
    .create();

  Logger.log('✓ Successfully created 24/7 daily trigger! Runs every evening at 7:00 PM - 8:00 PM.');
}

/**
 * Automated Daily Cloud Scanner:
 * Runs autonomously on Google Cloud servers. Scans today's & yesterday's threads,
 * calculates TAT, Order ID, Customer Replies, and writes directly into Google Sheets.
 */
function dailyAutoScan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = getOrCreateSheet(ss, CONFIG.MASTER_SHEET_NAME, getMasterHeaders());
  const dailySheet = getOrCreateSheet(ss, CONFIG.DAILY_SHEET_NAME, getDailyHeaders());

  Logger.log('Starting automated Gmail TAT scan...');

  // Search for threads from the last 3 days to catch all active/reopened conversations
  const query = 'to:care@betterhood.in OR from:care@betterhood.in newer_than:3d';
  const threads = GmailApp.search(query, 0, 100);

  Logger.log('Found ' + threads.length + ' candidate threads in Gmail.');

  let processedCount = 0;
  for (let i = 0; i < threads.length; i++) {
    try {
      const threadData = analyzeGmailThread(threads[i]);
      if (threadData) {
        upsertThreadToSheet(masterSheet, threadData);
        processedCount++;
      }
    } catch (e) {
      Logger.log('Error processing thread: ' + e.message);
    }
  }

  // Re-compute and refresh the Daily Performance Summary tab
  updateDailySummarySheet(masterSheet, dailySheet);

  Logger.log('✓ Completed dailyAutoScan! Processed ' + processedCount + ' threads.');
}

/**
 * Webhook Endpoint (POST):
 * Handles live synchronization requests from Laptop 1, Laptop 2, or automated schedulers.
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const masterSheet = getOrCreateSheet(ss, CONFIG.MASTER_SHEET_NAME, getMasterHeaders());
    const dailySheet = getOrCreateSheet(ss, CONFIG.DAILY_SHEET_NAME, getDailyHeaders());

    const action = payload.action || 'PUSH_THREAD';

    if (action === 'PUSH_THREAD' && payload.thread) {
      // Single thread pushed live from Chrome extension
      upsertThreadToSheet(masterSheet, payload.thread);
      updateDailySummarySheet(masterSheet, dailySheet);

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: 'Thread updated successfully in Google Sheet.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'SYNC_ALL') {
      // 2-Way Sync with Extension: Merge extension threads and return all stored threads
      const clientThreads = payload.threads || {};
      let mergedCount = 0;

      Object.keys(clientThreads).forEach(tId => {
        upsertThreadToSheet(masterSheet, clientThreads[tId]);
        mergedCount++;
      });

      updateDailySummarySheet(masterSheet, dailySheet);

      // Read back all records from the sheet to return to the extension
      const allCloudThreads = readAllThreadsFromSheet(masterSheet);

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        received: mergedCount,
        threads: allCloudThreads
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'TRIGGER_SCAN') {
      dailyAutoScan();
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: 'Manual Gmail scan completed successfully.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: 'Unrecognized action: ' + action
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Webhook Endpoint (GET):
 * Returns all stored threads and summary stats in JSON format.
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const masterSheet = getOrCreateSheet(ss, CONFIG.MASTER_SHEET_NAME, getMasterHeaders());
    const threads = readAllThreadsFromSheet(masterSheet);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      timestamp: Date.now(),
      totalThreads: Object.keys(threads).length,
      threads: threads
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Parses a Gmail thread directly via GmailApp and calculates TAT, Order ID, and Customer Replies
 */
function analyzeGmailThread(gmailThread) {
  const messages = gmailThread.getMessages();
  if (!messages || messages.length === 0) return null;

  const threadId = gmailThread.getId();
  const subject = gmailThread.getFirstMessageSubject() || '(No Subject)';

  const parsedMessages = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const fromStr = m.getFrom();
    const senderEmail = extractEmail(fromStr);
    const senderName = extractName(fromStr);
    const timestamp = m.getDate().getTime();
    const rawBody = m.getPlainBody() || '';
    const cleanBody = cleanEmailBody(rawBody);

    const isSystem = isSystemSender(senderEmail);
    const isAgent = isAgentSender(senderEmail, senderName) || isSystem;

    parsedMessages.push({
      senderEmail,
      senderName,
      timestamp,
      body: cleanBody,
      isAgent,
      isSystem
    });
  }

  // Sort chronological
  parsedMessages.sort((a, b) => a.timestamp - b.timestamp);

  // Identify customer info
  const firstCustMsg = parsedMessages.find(m => !m.isAgent && !m.isSystem);
  const customerEmail = firstCustMsg ? firstCustMsg.senderEmail : 'customer@domain.com';
  const customerName = firstCustMsg ? (firstCustMsg.senderName || customerEmail.split('@')[0]) : 'Customer';

  // Analyze multi-turn conversation
  let initialCustomerTime = null;
  let firstAgentTime = null;
  let latestCustomerTime = null;
  let latestAgentTime = null;
  let lastCustomerQueryTime = null;

  let customerQueryCount = 0;
  let customerMessageCount = 0;
  let agentReplyCount = 0;
  let customerReopenCount = 0;

  let awaitingAgentReply = false;
  let currentQueryStartTime = null;
  let lastSenderType = null;

  const repliesList = [];
  const customerBodies = [];

  parsedMessages.forEach(msg => {
    if (!msg.isAgent) {
      // Customer message
      customerMessageCount++;
      if (!initialCustomerTime) initialCustomerTime = msg.timestamp;
      latestCustomerTime = msg.timestamp;
      lastCustomerQueryTime = msg.timestamp;

      if (msg.body && msg.body.trim()) {
        const trimmed = msg.body.trim();
        if (!customerBodies.some(b => b.text === trimmed)) {
          customerBodies.push({
            queryIndex: customerBodies.length + 1,
            timestamp: msg.timestamp,
            text: trimmed
          });
        }
      }

      if (!awaitingAgentReply) {
        customerQueryCount++;
        awaitingAgentReply = true;
        currentQueryStartTime = msg.timestamp;

        if (lastSenderType === 'AGENT' && agentReplyCount > 0) {
          customerReopenCount++;
        }
      }
      lastSenderType = 'CUSTOMER';
    } else if (!msg.isSystem) {
      // Agent message
      latestAgentTime = msg.timestamp;

      if (awaitingAgentReply) {
        agentReplyCount++;
        if (!firstAgentTime) firstAgentTime = msg.timestamp;

        const refQueryTime = lastCustomerQueryTime || currentQueryStartTime || initialCustomerTime;
        const supportTatMs = computeBusinessDurationMs(refQueryTime, msg.timestamp);
        const actualTatMs = Math.max(0, msg.timestamp - refQueryTime);
        const isQueryInSupport = isWithinSupportHours(refQueryTime);

        repliesList.push({
          replyIndex: agentReplyCount,
          customerQueryTime: refQueryTime,
          agentReplyTime: msg.timestamp,
          supportTatMs,
          actualTatMs,
          isSupportHours: isQueryInSupport
        });

        awaitingAgentReply = false;
        currentQueryStartTime = null;
      }
      lastSenderType = 'AGENT';
    }
  });

  if (customerMessageCount === 0) return null;

  // Extract Order ID
  const orderId = extractOrderId(subject, customerBodies);

  // Format Customer Email Replies as 1: ... \n\n 2: ...
  const customerRepliesText = customerBodies.map((b, idx) => (idx + 1) + ': ' + b.text).join('\n\n');

  // TAT Metrics
  const firstResponseTimeMs = repliesList.length > 0 ? repliesList[0].supportTatMs : null;
  const actualFirstResponseTimeMs = repliesList.length > 0 ? repliesList[0].actualTatMs : null;

  const lastR = repliesList.length > 0 ? repliesList[repliesList.length - 1] : null;
  const latestResponseTimeMs = lastR ? lastR.supportTatMs : null;
  const actualLatestResponseTimeMs = lastR ? lastR.actualTatMs : null;

  const avgReplyTatMs = repliesList.length > 0
    ? Math.round(repliesList.reduce((acc, r) => acc + r.supportTatMs, 0) / repliesList.length)
    : null;
  const actualAvgReplyTatMs = repliesList.length > 0
    ? Math.round(repliesList.reduce((acc, r) => acc + r.actualTatMs, 0) / repliesList.length)
    : null;

  const isResolved = !awaitingAgentReply && agentReplyCount > 0;
  const statusLabel = isResolved ? 'Resolved' : 'Follow Up Needed';

  const threadDateKey = formatDateKey(latestCustomerTime || initialCustomerTime || Date.now());
  const initialDateKey = formatDateKey(initialCustomerTime || Date.now());

  return {
    threadId,
    orderId: orderId || 'None',
    subject,
    customerEmail,
    customerName,
    dateKey: threadDateKey,
    initialDateKey,
    customerRepliesText: customerRepliesText || 'N/A',
    initialCustomerTime,
    isQueryInSupportHours: isWithinSupportHours(initialCustomerTime),
    firstResponseTimeMs,
    actualFirstResponseTimeMs,
    latestCustomerTime,
    latestAgentTime,
    latestResponseTimeMs,
    actualLatestResponseTimeMs,
    avgReplyTatMs,
    actualAvgReplyTatMs,
    customerMessageCount: Math.max(customerMessageCount, customerBodies.length, 1),
    agentReplyCount,
    customerReopenCount,
    status: statusLabel,
    repliesListSummary: repliesList.map(r => '#' + r.replyIndex + ': ' + formatDuration(r.supportTatMs) + ' (24x7: ' + formatDuration(r.actualTatMs) + ')').join(', '),
    lastUpdated: Date.now()
  };
}

/**
 * Calculates Business Duration in Milliseconds (10am–7pm Mon–Sat, with start shift clock for off-hours)
 */
function computeBusinessDurationMs(startTs, endTs) {
  if (!startTs || !endTs || startTs >= endTs) return 0;

  const sH = CONFIG.BUSINESS_START_HOUR;
  const sM = CONFIG.BUSINESS_START_MIN;
  const eH = CONFIG.BUSINESS_END_HOUR;
  const eM = CONFIG.BUSINESS_END_MIN;
  const businessDays = CONFIG.BUSINESS_DAYS;

  let curr = new Date(startTs);
  curr.setHours(0, 0, 0, 0);

  const endDay = new Date(endTs);
  endDay.setHours(0, 0, 0, 0);

  let totalMs = 0;

  while (curr.getTime() <= endDay.getTime()) {
    const dayOfWeek = curr.getDay();
    if (businessDays.indexOf(dayOfWeek) !== -1) {
      const windowStart = new Date(curr.getTime());
      windowStart.setHours(sH, sM, 0, 0);

      const windowEnd = new Date(curr.getTime());
      windowEnd.setHours(eH, eM, 0, 0);

      const effectiveStart = Math.max(windowStart.getTime(), startTs);
      const effectiveEnd = Math.min(windowEnd.getTime(), endTs);

      if (effectiveEnd > effectiveStart) {
        totalMs += (effectiveEnd - effectiveStart);
      }
    }
    curr.setDate(curr.getDate() + 1);
  }

  return totalMs;
}

function isWithinSupportHours(timestamp) {
  if (!timestamp) return false;
  const d = new Date(timestamp);
  const day = d.getDay();
  if (CONFIG.BUSINESS_DAYS.indexOf(day) === -1) return false;
  const hrs = d.getHours();
  const mins = d.getMinutes();
  const curMins = hrs * 60 + mins;
  const startMins = CONFIG.BUSINESS_START_HOUR * 60 + CONFIG.BUSINESS_START_MIN;
  const endMins = CONFIG.BUSINESS_END_HOUR * 60 + CONFIG.BUSINESS_END_MIN;
  return curMins >= startMins && curMins < endMins;
}

/**
 * Extracts 4-5 digit Order ID (e.g. #44553 or 29410)
 */
function extractOrderId(subject, customerBodies) {
  const combined = (subject || '') + ' ' + (customerBodies || []).map(b => b.text || '').join(' ');

  // 1. Order ID starting with # followed by 4-5 digits
  const hashMatch = combined.match(/#(\d{4,5})\b/);
  if (hashMatch) return '#' + hashMatch[1];

  // 2. Standalone 5 digit number with order keywords
  const orderWordMatch = combined.match(/(?:order|id|tracking|awb|od|ord|inv|invoice)[:\s#-]*(\d{5})\b/i);
  if (orderWordMatch) return '#' + orderWordMatch[1];

  // 3. Any 5-digit number
  const fiveDigitMatch = combined.match(/\b(\d{5})\b/);
  if (fiveDigitMatch) return '#' + fiveDigitMatch[1];

  return '';
}

function cleanEmailBody(body) {
  if (!body) return '';
  return body
    .replace(/On\s.+wrote:[\s\S]*/i, '') // Remove quoted replies
    .replace(/--\s*[\s\S]*/i, '')         // Remove email signature
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isSystemSender(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  return CONFIG.SYSTEM_SENDERS.some(kw => lower.includes(kw));
}

function isAgentSender(email, name) {
  if (!email) return false;
  const lower = email.toLowerCase();
  const lowerName = (name || '').toLowerCase();
  const isAgentEmail = CONFIG.AGENT_EMAILS.some(ae => lower === ae.toLowerCase()) ||
                       CONFIG.AGENT_DOMAINS.some(dom => lower.endsWith('@' + dom) || lower.includes(dom));
  const isAgentName = lowerName.includes('betterhood') || lowerName.includes('customer care') || lowerName.includes('support team');
  return isAgentEmail || isAgentName;
}

function extractEmail(str) {
  if (!str) return '';
  const match = str.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase().trim() : str.toLowerCase().trim();
}

function extractName(str) {
  if (!str) return '';
  const match = str.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const emailMatch = str.match(/<([^>]+)>/);
  if (emailMatch) return str.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
  return str.split('@')[0].trim();
}

function formatDateKey(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return 'N/A';
  if (ms === 0) return '0m';
  const totalMins = Math.round(ms / 60000);
  if (totalMins < 60) return totalMins + 'm';
  const hrs = Math.floor(totalMins / 60);
  const remMins = totalMins % 60;
  if (hrs < 24) return hrs + 'h ' + remMins + 'm';
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return days + 'd ' + remHrs + 'h';
}

function formatDateTime(timestamp) {
  if (!timestamp) return 'N/A';
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

/**
 * Sheet Management Helpers
 */
function getMasterHeaders() {
  return [
    'Thread ID',
    'Order ID',
    'Date (Latest Activity)',
    'Initial Query Date',
    'Customer Email',
    'Customer Name',
    'Subject',
    'Customer Email Replies',
    'Initial Query Time',
    'Query Window (10am-7pm Mon-Sat)',
    'First Response TAT Support Hours (Readable)',
    'First Response TAT Support Hours (Minutes)',
    'First Response TAT 24x7 Actual (Readable)',
    'First Response TAT 24x7 Actual (Minutes)',
    'Last Customer Query Time',
    'Last Agent Reply Time',
    'Last Query to Reply TAT Support Hours',
    'Last Query to Reply TAT 24x7 Actual',
    'Avg Reply TAT Support Hours',
    'Avg Reply TAT 24x7 Actual',
    'Customer Mails Count',
    'Agent Reverts (Reply Count)',
    'Customer Reopened Count',
    'Tag / Status Category',
    'All Replies Breakdown',
    'Last Synced At'
  ];
}

function getDailyHeaders() {
  return [
    'Date',
    'Active Threads',
    'Customer Queries Received',
    'Replies Sent',
    'Support Hours Avg TAT (10am-7pm)',
    '24x7 Full Elapsed Actual TAT',
    'Support 1st Reply TAT',
    'Resolved Count',
    'Follow Up Needed Count',
    'Last Updated'
  ];
}

function getOrCreateSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1e293b')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Upserts a thread row into the Master Dump sheet (updates if Thread ID exists, appends if new)
 */
function upsertThreadToSheet(sheet, t) {
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(t.threadId)) {
      rowIndex = i + 1;
      break;
    }
  }

  const firstMins = t.firstResponseTimeMs !== null ? (t.firstResponseTimeMs / 60000).toFixed(1) : 'N/A';
  const actFirstMins = t.actualFirstResponseTimeMs !== null ? (t.actualFirstResponseTimeMs / 60000).toFixed(1) : firstMins;

  const rowData = [
    t.threadId,
    t.orderId || 'None',
    t.dateKey || formatDateKey(t.latestCustomerTime || t.initialCustomerTime),
    t.initialDateKey || formatDateKey(t.initialCustomerTime),
    t.customerEmail || 'Unknown',
    t.customerName || 'Customer',
    t.subject || '(No Subject)',
    t.customerRepliesText || t.customerQueriesText || 'N/A',
    formatDateTime(t.initialCustomerTime),
    t.isQueryInSupportHours ? 'In-Shift (10am-7pm Mon-Sat)' : 'Off-Hours (Night/Sunday)',
    formatDuration(t.firstResponseTimeMs),
    firstMins,
    formatDuration(t.actualFirstResponseTimeMs),
    actFirstMins,
    formatDateTime(t.latestCustomerTime),
    formatDateTime(t.latestAgentTime),
    formatDuration(t.latestResponseTimeMs),
    formatDuration(t.actualLatestResponseTimeMs),
    formatDuration(t.avgReplyTatMs),
    formatDuration(t.actualAvgReplyTatMs),
    t.customerMessageCount || 1,
    t.agentReplyCount || 0,
    t.customerReopenCount || 0,
    t.status || 'Follow Up Needed',
    t.repliesListSummary || (Array.isArray(t.repliesList) ? t.repliesList.map(r => '#' + r.replyIndex + ': ' + formatDuration(r.supportTatMs ?? r.tatMs)).join(', ') : 'None'),
    new Date().toLocaleString()
  ];

  if (rowIndex !== -1) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
}

/**
 * Refreshes the Daily Performance Summary tab
 */
function updateDailySummarySheet(masterSheet, dailySheet) {
  const data = masterSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const dateGroups = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const dateKey = row[2]; // Date column
    if (!dateKey) continue;

    if (!dateGroups[dateKey]) {
      dateGroups[dateKey] = {
        threads: 0,
        queries: 0,
        reverts: 0,
        supportTatTotal: 0,
        supportTatCount: 0,
        actualTatTotal: 0,
        actualTatCount: 0,
        firstSupportTatTotal: 0,
        firstSupportTatCount: 0,
        resolved: 0,
        followup: 0
      };
    }

    const g = dateGroups[dateKey];
    g.threads++;
    g.queries += Number(row[20]) || 1; // Customer Mails Count
    g.reverts += Number(row[21]) || 0; // Agent Reverts Count

    const suppMins = parseFloat(row[11]);
    if (!isNaN(suppMins)) {
      g.supportTatTotal += suppMins;
      g.supportTatCount++;
      g.firstSupportTatTotal += suppMins;
      g.firstSupportTatCount++;
    }

    const actMins = parseFloat(row[13]);
    if (!isNaN(actMins)) {
      g.actualTatTotal += actMins;
      g.actualTatCount++;
    }

    const status = String(row[23]).toLowerCase();
    if (status.includes('resolved')) g.resolved++;
    else g.followup++;
  }

  // Clear existing rows and rewrite
  const headers = getDailyHeaders();
  dailySheet.clearContents();
  dailySheet.appendRow(headers);
  dailySheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#1e293b')
    .setFontColor('#ffffff');

  const sortedDates = Object.keys(dateGroups).sort().reverse();
  const nowStr = new Date().toLocaleString();

  sortedDates.forEach(dKey => {
    const g = dateGroups[dKey];
    const avgSuppMins = g.supportTatCount > 0 ? Math.round(g.supportTatTotal / g.supportTatCount) : 0;
    const avgActMins = g.actualTatCount > 0 ? Math.round(g.actualTatTotal / g.actualTatCount) : 0;
    const avgFirstSuppMins = g.firstSupportTatCount > 0 ? Math.round(g.firstSupportTatTotal / g.firstSupportTatCount) : 0;

    dailySheet.appendRow([
      dKey,
      g.threads,
      g.queries,
      g.reverts,
      avgSuppMins + 'm (' + formatDuration(avgSuppMins * 60000) + ')',
      avgActMins + 'm (' + formatDuration(avgActMins * 60000) + ')',
      avgFirstSuppMins + 'm (' + formatDuration(avgFirstSuppMins * 60000) + ')',
      g.resolved,
      g.followup,
      nowStr
    ]);
  });
}

/**
 * Reads all rows from Master sheet and converts to key-value threads map
 */
function readAllThreadsFromSheet(sheet) {
  const data = sheet.getDataRange().getValues();
  const threads = {};
  if (data.length <= 1) return threads;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const threadId = String(row[0]);
    if (!threadId) continue;

    threads[threadId] = {
      threadId: threadId,
      orderId: row[1] !== 'None' ? row[1] : '',
      dateKey: row[2],
      initialDateKey: row[3],
      customerEmail: row[4],
      customerName: row[5],
      subject: row[6],
      customerRepliesText: row[7],
      customerQueriesText: row[7],
      customerMessageCount: Number(row[20]) || 1,
      agentReplyCount: Number(row[21]) || 0,
      customerReopenCount: Number(row[22]) || 0,
      status: row[23] === 'Resolved' ? 'RESOLVED' : 'FOLLOWUP_GENERAL',
      lastUpdated: new Date(row[25]).getTime() || Date.now()
    };
  }
  return threads;
}
