/**
 * Email TAT & SLA Tracker - Utility Functions & Business Logic
 */

const TatUtils = {
  _cachedSettings: null,

  // Compute business duration between startTs and endTs excluding non-working hours and off-days
  computeBusinessDurationMs(startTs, endTs, config = null) {
    if (!startTs || !endTs || startTs >= endTs) return 0;
    const settings = config || this._cachedSettings || {};
    const useBusinessHours = settings.useBusinessHours !== false;
    if (!useBusinessHours) return Math.max(0, endTs - startTs);

    const startStr = settings.businessHoursStart || '10:00';
    const endStr = settings.businessHoursEnd || '19:00';
    const [sH, sM] = startStr.split(':').map(v => parseInt(v, 10) || 0);
    const [eH, eM] = endStr.split(':').map(v => parseInt(v, 10) || 0);
    const businessDays = Array.isArray(settings.businessDays) && settings.businessDays.length > 0
      ? settings.businessDays
      : [1, 2, 3, 4, 5, 6]; // Monday=1 through Saturday=6 (Sunday=0 off)

    let curr = new Date(startTs);
    curr.setHours(0, 0, 0, 0);

    const endDay = new Date(endTs);
    endDay.setHours(0, 0, 0, 0);

    let totalMs = 0;
    let iters = 0;

    while (curr.getTime() <= endDay.getTime() && iters < 365) {
      iters++;
      const dow = curr.getDay();
      if (businessDays.includes(dow)) {
        const wStart = new Date(curr);
        wStart.setHours(sH, sM, 0, 0);

        const wEnd = new Date(curr);
        wEnd.setHours(eH, eM, 0, 0);

        const overlapStart = Math.max(startTs, wStart.getTime());
        const overlapEnd = Math.min(endTs, wEnd.getTime());

        if (overlapEnd > overlapStart) {
          totalMs += (overlapEnd - overlapStart);
        }
      }
      curr.setDate(curr.getDate() + 1);
    }

    // Edge case: if both query and reply happened in the same off-hours window before next business window:
    if (totalMs === 0 && endTs > startTs) {
      const rawDiff = endTs - startTs;
      if (rawDiff <= 2 * 3600000) {
        totalMs = rawDiff; // give credit for prompt off-hours response (e.g. 15m)
      } else {
        totalMs = 60000; // 1 min (responded before next business window opened!)
      }
    }

    return totalMs;
  },

  // Helper to check if a given timestamp falls within defined Support Working Hours (10:00am - 7:00pm Mon-Sat)
  isWithinSupportHours(timestamp, config = null) {
    if (!timestamp) return false;
    const settings = config || this._cachedSettings || {};
    const startStr = settings.businessHoursStart || '10:00';
    const endStr = settings.businessHoursEnd || '19:00';
    const [sH, sM] = startStr.split(':').map(v => parseInt(v, 10) || 0);
    const [eH, eM] = endStr.split(':').map(v => parseInt(v, 10) || 0);
    const businessDays = Array.isArray(settings.businessDays) && settings.businessDays.length > 0
      ? settings.businessDays
      : [1, 2, 3, 4, 5, 6]; // Mon to Sat

    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return false;
    const dow = d.getDay();
    if (!businessDays.includes(dow)) return false;

    const currentMinutes = d.getHours() * 60 + d.getMinutes();
    const startMinutes = sH * 60 + sM;
    const endMinutes = eH * 60 + eM;

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  },

  // Calculate the exact effective time when the Support Hours TAT clock begins.
  // Rule:
  // 1. If email arrives during support hours (10:00am–7:00pm Mon–Sat), clock starts immediately at email arrival.
  // 2. If email arrives before shift on a working day (e.g. 8:30am Tuesday), clock starts at 10:00am today.
  // 3. If email arrives after shift (e.g. 9:00pm Monday) or on Sunday, clock starts at 10:00am on the NEXT working day.
  getEffectiveSupportStartTime(timestamp, config = null) {
    if (!timestamp) return null;
    const settings = config || this._cachedSettings || {};
    const startStr = settings.businessHoursStart || '10:00';
    const endStr = settings.businessHoursEnd || '19:00';
    const [sH, sM] = startStr.split(':').map(v => parseInt(v, 10) || 0);
    const [eH, eM] = endStr.split(':').map(v => parseInt(v, 10) || 0);
    const businessDays = Array.isArray(settings.businessDays) && settings.businessDays.length > 0
      ? settings.businessDays
      : [1, 2, 3, 4, 5, 6]; // Mon to Sat

    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return timestamp;

    const dow = d.getDay();
    const curMins = d.getHours() * 60 + d.getMinutes();
    const startMins = sH * 60 + sM;
    const endMins = eH * 60 + eM;

    // 1. In support shift: clock starts right when email arrived
    if (businessDays.includes(dow) && curMins >= startMins && curMins < endMins) {
      return timestamp;
    }

    // 2. Before shift on a working day: clock starts at 10:00 AM today
    if (businessDays.includes(dow) && curMins < startMins) {
      const eff = new Date(d);
      eff.setHours(sH, sM, 0, 0);
      return eff.getTime();
    }

    // 3. After shift (e.g. Mon 9:00 PM) or on Sunday: clock starts at 10:00 AM next working day
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    next.setHours(sH, sM, 0, 0);

    let safety = 0;
    while (!businessDays.includes(next.getDay()) && safety < 14) {
      next.setDate(next.getDate() + 1);
      safety++;
    }

    return next.getTime();
  },

  // Format Support Working Hours duration.
  // Crucial: 1 Support Working Day = 9 hours (10:00am to 7:00pm)!
  // Never divide by 24 hours (which erroneously turns 116 support hours into "4d 20h" instead of 13 work days).
  formatSupportDuration(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return 'N/A';
    if (ms < 0) ms = 0;

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours === 0 && minutes === 0) {
      return `${seconds}s`;
    }
    if (hours === 0) {
      return `${minutes}m`;
    }

    const remMins = minutes % 60;
    // 1 support working day = 9 support hours
    const workDays = Math.floor(hours / 9);

    if (workDays >= 1) {
      return `${hours}h ${remMins}m (${workDays} support day${workDays > 1 ? 's' : ''})`;
    }

    return `${hours}h ${remMins}m`;
  },

  // Format Non-Support / 24x7 actual elapsed calendar duration (1 calendar day = 24 hours)
  formatActualDuration(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return 'N/A';
    if (ms < 0) ms = 0;

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      const remHours = hours % 24;
      return `${days}d ${remHours}h`;
    }
    if (hours > 0) {
      const remMins = minutes % 60;
      return `${hours}h ${remMins}m`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return `${seconds}s`;
  },

  // Universal formatDuration (routes to formatSupportDuration if isSupport is true, else formatActualDuration)
  formatDuration(ms, isSupport = false) {
    return isSupport ? this.formatSupportDuration(ms) : this.formatActualDuration(ms);
  },

  // Extract Order ID based on user rules:
  // 1. Any number starts with # and has 4-5 digits (e.g. #44553 or #29410)
  // 2. Any number which length is 5 digits (e.g. 29410 or 44553 or 22334)
  extractOrderId(subject = '', bodies = [], timeline = []) {
    const allTexts = [];
    if (subject) allTexts.push(subject);
    if (typeof bodies === 'string') {
      allTexts.push(bodies);
    } else if (Array.isArray(bodies)) {
      bodies.forEach(b => {
        if (typeof b === 'string') allTexts.push(b);
        else if (b && b.text) allTexts.push(b.text);
      });
    }
    if (Array.isArray(timeline)) {
      timeline.forEach(evt => {
        if (evt && evt.body) allTexts.push(evt.body);
      });
    }

    const combined = allTexts.join(' \n ');
    if (!combined.trim()) return '';

    const foundIds = new Map(); // digits -> formatted string (e.g. '44553' -> '#44553')

    // Rule 1: starts with # and has 4-5 digits, e.g. #44553 or #29410
    const rule1Matches = combined.match(/#\d{4,5}\b/g);
    if (rule1Matches) {
      rule1Matches.forEach(m => {
        const digits = m.replace('#', '').trim();
        foundIds.set(digits, '#' + digits);
      });
    }

    // Priority 1.5: Explicit keywords like 'Order ID: 44553' or 'Order 29410' or 'Order #29410'
    const orderWordMatches = combined.matchAll(/(?:order(?:\s*(?:id|no|#|number))?[\s:#-]*)([0-9]{4,5})\b/gi);
    for (const m of orderWordMatches) {
      if (m && m[1]) {
        const digits = m[1].trim();
        foundIds.set(digits, '#' + digits);
      }
    }

    // Rule 2: any number whose length is 5 digits, e.g. 29410 or 44553 or 22334
    const rule2Matches = combined.match(/\b\d{5}\b/g);
    if (rule2Matches) {
      rule2Matches.forEach(num => {
        const digits = num.trim();
        if (!foundIds.has(digits)) {
          foundIds.set(digits, '#' + digits);
        }
      });
    }

    if (foundIds.size === 0) return '';
    return Array.from(foundIds.values()).join(', ');
  },

  // Format customer email replies into a numbered list:
  // "1: [reply 1]\n\n2: [reply 2]"
  formatCustomerRepliesText(replies) {
    if (!replies || replies.length === 0) return '';
    const list = Array.isArray(replies) ? replies : [replies];
    const valid = list.map(b => (typeof b === 'string' ? b : (b?.text || '')).trim()).filter(Boolean);
    if (valid.length === 0) return '';
    return valid.map((txt, idx) => `${idx + 1}: ${txt}`).join('\n\n');
  },

  formatCustomerQueriesText(customerBodies) {
    return this.formatCustomerRepliesText(customerBodies);
  },

  // Format date to local readable format
  formatDateTime(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  },

  // Compact date-time for dropdowns (e.g. "Oct 13, 10:45 AM")
  formatShortDateTime(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  },

  // Format date to YYYY-MM-DD
  formatDateKey(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  // Ensure timestamps parsed without an explicit year never stay on V8's default year 2001
  fixMissingYear(timestamp, rawStr = '') {
    if (!timestamp || isNaN(timestamp)) return null;
    const hasExplicitYear = /\b(19|20)\d{2}\b/.test(String(rawStr));
    const d = new Date(timestamp);
    if (!hasExplicitYear && d.getFullYear() === 2001) {
      const currentYear = new Date().getFullYear();
      d.setFullYear(currentYear);
      // If setting to current year puts it >24h in the future (e.g. viewing Dec mail in Jan), use previous year
      if (d.getTime() > Date.now() + 86400000) {
        d.setFullYear(currentYear - 1);
      }
      return d.getTime();
    }
    return timestamp;
  },

  // Parse natural or Gmail header timestamp with complete format cleaning
  parseTimestamp(timeVal) {
    if (!timeVal) return null;
    if (typeof timeVal === 'number') return this.fixMissingYear(timeVal, '');
    
    let raw = String(timeVal).replace(/[\u200e\u200f\u202f]/g, ' ').trim();
    if (!raw) return null;

    // Remove parenthetical text e.g. "(2 hours ago)" or "(0 minutes ago)" or "(10 days ago)"
    let s = raw.replace(/\s*\([^)]*\)\s*/g, ' ').trim();

    // 1. Handle bare time FIRST like "11:23" or "10:45 PM" (means Today in Gmail)
    const bareTimeMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (bareTimeMatch) {
      const d = new Date();
      let h = parseInt(bareTimeMatch[1], 10);
      const m = parseInt(bareTimeMatch[2], 10);
      const meridiem = (bareTimeMatch[4] || '').toLowerCase();
      if (meridiem === 'pm' && h < 12) h += 12;
      if (meridiem === 'am' && h === 12) h = 0;
      d.setHours(h, m, 0, 0);
      return d.getTime();
    }

    // 2. Handle "Yesterday, 4:15 PM"
    if (/^yesterday/i.test(s)) {
      const timeMatch = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      const d = new Date();
      d.setDate(d.getDate() - 1);
      if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        const meridiem = (timeMatch[3] || '').toLowerCase();
        if (meridiem === 'pm' && h < 12) h += 12;
        if (meridiem === 'am' && h === 12) h = 0;
        d.setHours(h, m, 0, 0);
      }
      return d.getTime();
    }

    // 3. Try direct Date.parse (and fix V8's default 2001 year if year was omitted by Gmail, e.g. "Sat 3 Oct, 16:04")
    let parsed = Date.parse(s);
    if (!isNaN(parsed)) {
      return this.fixMissingYear(parsed, s);
    }

    // 4. Replace " at " with ", " (e.g. "12 Oct 2026 at 10:45 pm" -> "12 Oct 2026, 10:45 pm")
    const cleanedAt = s.replace(/\s+at\s+/i, ', ').replace(/(\d+)\s*(am|pm)/i, '$1 $2');
    parsed = Date.parse(cleanedAt);
    if (!isNaN(parsed)) {
      return this.fixMissingYear(parsed, cleanedAt);
    }

    return null;
  },

  // Clean raw Gmail label strings and remove generic system labels
  cleanTagList(tags = []) {
    if (!Array.isArray(tags)) return [];
    const ignoreSet = new Set([
      'inbox', 'external', 'starred', 'important', 'sent', 'drafts', 'unread',
      'all mail', 'trash', 'spam', 'chats', 'scheduled', 'snoozed',
      'category_personal', 'category_promotions', 'category_updates', 'category_forums', 'category_social'
    ]);
    const seen = new Set();
    const result = [];
    tags.forEach(raw => {
      if (!raw) return;
      let clean = String(raw)
        .replace(/^Search for all messages with label\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!clean || clean.length > 45) return;
      const lower = clean.toLowerCase();
      if (ignoreSet.has(lower)) return;
      if (!seen.has(lower)) {
        seen.add(lower);
        result.push(clean);
      }
    });
    return result;
  },

  // Classify a thread's Gmail tags and reply state into exact operational matrix buckets:
  // - Resolved
  // - Follow Up Needed (Total) -> bifurcated into:
  //   1) Follow Up (General)
  //   2) Follow Up / Return
  //   3) Follow Up / Replacement
  // - Payment Pending
  classifyThreadTags(tags = [], thread = null) {
    const cleanTags = this.cleanTagList(tags);
    const lowerTags = cleanTags.map(t => t.toLowerCase());

    const hasResolvedTag = lowerTags.some(t =>
      t === 'resolved' || t.includes('resolved') || t === 'solved' || t === 'closed' || t === 'done' || t === 'discussed'
    );

    const isPaymentPending = lowerTags.some(t =>
      t.includes('payment pending') || t.includes('payment_pending') || t.includes('payment-pending') ||
      t.includes('refund pending') || t === 'payment'
    );

    const isFollowUpReturn = lowerTags.some(t =>
      (t.includes('follow') && t.includes('return')) ||
      t === 'return' || t === 'returns' || t.includes('return pickup') || t.includes('reverse pickup')
    );

    const isFollowUpReplacement = lowerTags.some(t =>
      (t.includes('follow') && (t.includes('replace') || t.includes('exchange'))) ||
      t === 'replacement' || t === 'replace' || t === 'exchange'
    );

    const hasExplicitFollowUpGeneral = lowerTags.some(t =>
      (t.includes('follow up') || t.includes('followup') || t.includes('follow-up') ||
       t === 'follow' || t === 'pending' || t === 'waiting' || t === 'in progress' || t === 'escalated') &&
      !t.includes('return') && !t.includes('replace') && !t.includes('exchange')
    );

    const hasAgentReplied = Boolean(
      thread && (
        (thread.agentReplyCount || 0) > 0 ||
        (Array.isArray(thread.repliesList) && thread.repliesList.length > 0) ||
        thread.latestAgentTime
      )
    );

    const awaitingReply = Boolean(
      thread && !hasResolvedTag && (
        !hasAgentReplied ||
        (thread.latestCustomerTime && thread.latestAgentTime && thread.latestCustomerTime > thread.latestAgentTime)
      )
    );

    // If a thread is awaiting a reply and isn't already categorized under Return/Replacement/Payment/Resolved,
    // it also requires general follow-up
    const isFollowUpGeneral = hasExplicitFollowUpGeneral || (awaitingReply && !isFollowUpReturn && !isFollowUpReplacement && !isPaymentPending);
    const isFollowUpNeeded = isFollowUpGeneral || isFollowUpReturn || isFollowUpReplacement;

    // A thread is Resolved if explicitly tagged Resolved OR if the agent has replied and no follow-up/payment tag is active
    const isResolved = hasResolvedTag || (hasAgentReplied && !awaitingReply && !isFollowUpNeeded && !isPaymentPending);

    let primaryCategory = 'RESOLVED';
    let primaryLabel = 'Resolved';
    if (isFollowUpReturn) {
      primaryCategory = 'FOLLOWUP_RETURN';
      primaryLabel = 'Follow up/Return';
    } else if (isFollowUpReplacement) {
      primaryCategory = 'FOLLOWUP_REPLACEMENT';
      primaryLabel = 'Follow up/Replacement';
    } else if (isPaymentPending) {
      primaryCategory = 'PAYMENT_PENDING';
      primaryLabel = 'Payment Pending';
    } else if (hasExplicitFollowUpGeneral) {
      primaryCategory = 'FOLLOWUP_GENERAL';
      primaryLabel = 'Follow Up';
    } else if (hasResolvedTag) {
      primaryCategory = 'RESOLVED';
      primaryLabel = 'Resolved';
    } else if (awaitingReply) {
      primaryCategory = 'FOLLOWUP_GENERAL';
      primaryLabel = 'Follow Up Needed';
    } else if (hasAgentReplied) {
      primaryCategory = 'RESOLVED';
      primaryLabel = 'Resolved';
    }

    return {
      cleanTags,
      hasResolvedTag,
      isResolved,
      isFollowUpNeeded,
      isFollowUpGeneral,
      hasExplicitFollowUpGeneral,
      isFollowUpReturn,
      isFollowUpReplacement,
      isPaymentPending,
      hasAgentReplied,
      awaitingReply,
      primaryCategory,
      primaryLabel
    };
  },

  // Interpret thread status:
  // - If the agent has ALREADY replied to the latest customer query (isResolvedByReply === true), it is ALWAYS RESOLVED (never Awaiting Reply!).
  // - If the thread has an explicit "Resolved" / "Solved" / "Closed" tag, it is also RESOLVED.
  // - Otherwise (customer sent the latest message and agent hasn't replied yet), it is PENDING_REPLY.
  interpretTags(tags = [], isResolvedByReply = false) {
    if (isResolvedByReply) {
      return 'RESOLVED';
    }

    const lowerTags = this.cleanTagList(tags).map(t => String(t).toLowerCase().trim());
    const hasResolvedTag = lowerTags.some(t =>
      t === 'resolved' || t.includes('resolved') || t === 'solved' || t === 'closed' || t === 'done' || t === 'discussed'
    );

    if (hasResolvedTag) {
      return 'RESOLVED';
    }
    return 'PENDING_REPLY';
  },

  // Helper to detect automated system, courier, tracking, and transactional notification senders
  isSystemSender(senderStr) {
    if (!senderStr) return false;
    const s = String(senderStr).toLowerCase().trim();
    if (!s || s === 'customer') return false;
    const systemPatterns = [
      'no-reply', 'noreply', 'donotreply', 'notifications@', 'notification@',
      'shipping@', 'shipment@', 'orders@', 'order-update', 'delivery@', 'tracking@',
      'mailer@', 'system@', 'alerts@', 'alert@', 'updates@', 'update@',
      'shopifyemail', 'shopify.com', 'shiprocket', 'delhivery', 'bluedart',
      'dtdc', 'shadowfax', 'ekart'
    ];
    return systemPatterns.some(p => s.includes(p));
  },

  // Helper to check if a sender email/name belongs to our support/company agent or automated merchant system
  isLikelyAgentSender(senderStr, customerEmail, agentEmails = [], currentUserEmail = '') {
    if (!senderStr) return false;
    const s = String(senderStr).toLowerCase().trim();
    if (!s || s === 'customer' || s === 'unknown') return false;
    if (s === 'you' || s === 'me') return true;
    if (currentUserEmail && s === currentUserEmail.toLowerCase().trim()) return true;
    if (agentEmails.some(ae => ae && ae.toLowerCase().trim() === s)) return true;
    if (
      s.includes('betterhood') ||
      s.startsWith('care@') ||
      s.startsWith('support@') ||
      s.startsWith('help@') ||
      s.startsWith('customercare@') ||
      s.startsWith('info@') ||
      this.isSystemSender(s)
    ) {
      return true;
    }
    return false;
  },

  // State Machine: Analyze thread messages and compute TAT for every customer query -> agent reply (with Business Hours support)
  analyzeThread(threadId, subject, customerEmail, customerName, messages, agentEmails = [], tags = [], config = null) {
    // Preserve Gmail's top-to-bottom DOM sequence if domIndex is provided; otherwise sort by timestamp
    const sorted = [...messages].map((m, idx) => ({
      ...m,
      timestamp: this.fixMissingYear(m.timestamp, '') || m.timestamp,
      _order: m.domIndex !== undefined ? m.domIndex : idx
    })).sort((a, b) => {
      if (a.domIndex !== undefined && b.domIndex !== undefined) {
        return a.domIndex - b.domIndex;
      }
      return (a.timestamp - b.timestamp) || (a._order - b._order);
    });

    // Guarantee timestamps are monotonically non-decreasing in chronological message sequence
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].timestamp && sorted[i - 1].timestamp && sorted[i].timestamp < sorted[i - 1].timestamp) {
        sorted[i].timestamp = sorted[i - 1].timestamp + 1000;
      }
    }

    let initialCustomerTime = null;
    let firstAgentTime = null;
    let latestCustomerTime = null;
    let latestAgentTime = null;
    
    let customerQueryCount = 0;
    let customerMessageCount = 0; // Total count of incoming customer emails/reverts
    let agentReplyCount = 0;      // Reverts: counts every customer query turn that the agent replied to
    let customerReopenCount = 0;
    
    let awaitingAgentReply = false;
    let currentQueryStartTime = null; // When the current unreplied customer query turn started
    let lastCustomerQueryTime = null; // Most recent customer message timestamp before agent reply
    let lastSenderType = null;

    const timeline = [];
    const repliesList = [];       // Every individual Agent Reply with its TAT & query/reply timestamps
    const customerBodies = [];    // Raw customer query message bodies (customer side only)
    const activeDatesSet = new Set();

    sorted.forEach((msg) => {
      const isAgent = Boolean(
        msg.isAgent ||
        this.isLikelyAgentSender(msg.senderEmail, customerEmail, agentEmails) ||
        this.isLikelyAgentSender(msg.senderName, customerEmail, agentEmails)
      );
      const msgDateKey = TatUtils.formatDateKey(msg.timestamp);
      if (msgDateKey) activeDatesSet.add(msgDateKey);

      if (!isAgent) {
        // --- Customer Message ---
        customerMessageCount++;
        if (!initialCustomerTime) {
          initialCustomerTime = msg.timestamp;
        }
        latestCustomerTime = msg.timestamp;
        lastCustomerQueryTime = msg.timestamp;

        if (msg.body && typeof msg.body === 'string' && msg.body.trim()) {
          const trimmedBody = msg.body.trim();
          if (!customerBodies.some(b => b.text === trimmedBody)) {
            customerBodies.push({
              queryIndex: customerBodies.length + 1,
              timestamp: msg.timestamp,
              text: trimmedBody
            });
          }
        }

        if (!awaitingAgentReply) {
          customerQueryCount++;
          awaitingAgentReply = true;
          currentQueryStartTime = msg.timestamp;

          // If previous message was from Agent AND agent had already replied to a prior query, this marks a REOPEN
          if (lastSenderType === 'AGENT' && agentReplyCount > 0) {
            customerReopenCount++;
            timeline.push({
              type: 'REOPENED',
              timestamp: msg.timestamp,
              sender: msg.senderEmail || 'Customer',
              body: msg.body || '',
              note: `Customer reopened query (Reopen #${customerReopenCount})`
            });
          } else {
            timeline.push({
              type: 'CUSTOMER_MSG',
              timestamp: msg.timestamp,
              sender: msg.senderEmail || 'Customer',
              body: msg.body || '',
              note: customerQueryCount === 1 ? 'Initial Customer Query' : `Customer Query #${customerQueryCount}`
            });
          }
        } else {
          // Customer sent another message / re-query before agent replied
          timeline.push({
            type: 'CUSTOMER_MSG',
            timestamp: msg.timestamp,
            sender: msg.senderEmail || 'Customer',
            body: msg.body || '',
            note: 'Customer Follow-up / Re-query'
          });
        }

        lastSenderType = 'CUSTOMER';
      } else {
        // --- Agent Message ---
        latestAgentTime = msg.timestamp;

        if (awaitingAgentReply) {
          // Agent successfully replied / reverted to the customer query!
          agentReplyCount++;
          if (!firstAgentTime) {
            firstAgentTime = msg.timestamp;
          }

          // For any reply, measure TAT from the customer query that immediately preceded this reply!
          // If a customer asked on Sep 27 and then sent a new query on Oct 12, the Oct 12 reply answers the Oct 12 query.
          const refQueryTime = lastCustomerQueryTime || currentQueryStartTime || initialCustomerTime;
          const initialQueryTime = currentQueryStartTime || initialCustomerTime || lastCustomerQueryTime;

          const effectiveSupportStart = this.getEffectiveSupportStartTime(refQueryTime, config);

          const supportTatMs = refQueryTime ? this.computeBusinessDurationMs(refQueryTime, msg.timestamp, config) : 0;
          const actualTatMs = refQueryTime ? Math.max(0, msg.timestamp - refQueryTime) : 0;
          const isQueryInSupportHours = refQueryTime ? this.isWithinSupportHours(refQueryTime, config) : true;
          const isReplyInSupportHours = this.isWithinSupportHours(msg.timestamp, config);

          const replyLabel = agentReplyCount === 1
            ? '1st Reply (Initial)'
            : `Reply #${agentReplyCount} (Reopen #${agentReplyCount - 1})`;

          repliesList.push({
            replyIndex: agentReplyCount,
            label: replyLabel,
            customerQueryTime: refQueryTime,
            initialCustomerQueryTime: initialQueryTime,
            effectiveSupportStartTime: effectiveSupportStart,
            agentReplyTime: msg.timestamp,
            tatMs: supportTatMs,                     // Support Hours TAT (10am-7pm Mon-Sat)
            supportTatMs: supportTatMs,
            actualTatMs: actualTatMs,                // Non-Support / 24x7 actual elapsed TAT
            isSupportHours: isQueryInSupportHours,  // Was query received within 10am-7pm Mon-Sat?
            isReplyInSupportHours: isReplyInSupportHours,
            dateKey: TatUtils.formatDateKey(msg.timestamp),
            queryDateKey: TatUtils.formatDateKey(refQueryTime)
          });

          timeline.push({
            type: 'AGENT_REPLY',
            timestamp: msg.timestamp,
            customerQueryTime: refQueryTime,
            sender: msg.senderEmail || 'You',
            revertIndex: agentReplyCount,
            tatMs: supportTatMs,
            supportTatMs: supportTatMs,
            actualTatMs: actualTatMs,
            isSupportHours: isReplyInSupportHours,
            note: agentReplyCount === 1 ? 'First Response' : `Agent Revert #${agentReplyCount}`
          });

          // Query is resolved by this revert
          awaitingAgentReply = false;
          currentQueryStartTime = null;
        } else {
          // Consecutive follow-up by agent or thread initiated by agent
          timeline.push({
            type: 'AGENT_FOLLOWUP',
            timestamp: msg.timestamp,
            sender: msg.senderEmail || 'You',
            note: 'Agent Follow-up'
          });
        }

        lastSenderType = 'AGENT';
      }
    });

    const cleanTags = this.cleanTagList(tags);
    const lowerTags = cleanTags.map(t => t.toLowerCase());

    // Self-healing: if customerQueryCount === 0, but thread has incoming labels (e.g. Follow UP, Inbox, External)
    // or subject starts with Re:, then an incoming customer message exists that requires agent revert!
    const hasIncomingLabels = lowerTags.some(t => t.includes('follow') || t === 'inbox' || t === 'external' || t.includes('pending') || t.includes('return') || t.includes('replace'));
    const isReSubject = /^re:\s*/i.test(subject || '');

    if (customerQueryCount === 0 && (hasIncomingLabels || isReSubject) && sorted.length > 0) {
      const candidateMsg = [...sorted].reverse().find(m => !m.isMeText && m.senderEmail !== (agentEmails[0] || '')) || sorted[sorted.length - 1];
      candidateMsg.isAgent = false;
      customerQueryCount = 1;
      awaitingAgentReply = true;
      initialCustomerTime = candidateMsg.timestamp;
      latestCustomerTime = candidateMsg.timestamp;
      lastCustomerQueryTime = candidateMsg.timestamp;
      currentQueryStartTime = candidateMsg.timestamp;
      lastSenderType = 'CUSTOMER';
      if (candidateMsg.body && typeof candidateMsg.body === 'string' && candidateMsg.body.trim()) {
        const trimmedBody = candidateMsg.body.trim();
        if (!customerBodies.some(b => b.text === trimmedBody)) {
          customerBodies.push({
            queryIndex: 1,
            timestamp: candidateMsg.timestamp,
            text: trimmedBody
          });
        }
      }

      timeline.push({
        type: 'CUSTOMER_MSG',
        timestamp: candidateMsg.timestamp,
        sender: candidateMsg.senderEmail || customerEmail || 'Customer',
        body: candidateMsg.body || '',
        isSupportHours: this.isWithinSupportHours(candidateMsg.timestamp, config),
        note: 'Customer Query'
      });
    }

    // If the last message in the thread is from the Agent (or awaitingAgentReply is false), it is RESOLVED!
    const isResolvedByReply = !awaitingAgentReply && (lastSenderType === 'AGENT' || agentReplyCount > 0);
    const finalStatus = this.interpretTags(cleanTags, isResolvedByReply);

    // 1. First Response TAT (Support Hours & 24x7 Actual)
    let firstResponseTimeMs = null;
    let actualFirstResponseTimeMs = null;
    if (repliesList.length > 0) {
      firstResponseTimeMs = repliesList[0].supportTatMs ?? repliesList[0].tatMs;
      actualFirstResponseTimeMs = repliesList[0].actualTatMs ?? firstResponseTimeMs;
    } else if (initialCustomerTime && firstAgentTime) {
      firstResponseTimeMs = this.computeBusinessDurationMs(initialCustomerTime, firstAgentTime, config);
      actualFirstResponseTimeMs = Math.max(0, firstAgentTime - initialCustomerTime);
    }

    // 2. Latest Reply TAT (Support Hours & 24x7 Actual)
    const lastReplyObj = repliesList.length > 0 ? repliesList[repliesList.length - 1] : null;
    const latestResponseTimeMs = lastReplyObj ? (lastReplyObj.supportTatMs ?? lastReplyObj.tatMs) : firstResponseTimeMs;
    const actualLatestResponseTimeMs = lastReplyObj ? (lastReplyObj.actualTatMs ?? latestResponseTimeMs) : actualFirstResponseTimeMs;
    const lastRepliedCustomerQueryTime = lastReplyObj ? lastReplyObj.customerQueryTime : initialCustomerTime;
    const lastRepliedAgentTime = lastReplyObj ? lastReplyObj.agentReplyTime : latestAgentTime;

    // 3. Average Reply TAT across all replies in this thread (Support Hours & 24x7 Actual)
    const avgReplyTatMs = repliesList.length > 0
      ? Math.round(repliesList.reduce((acc, r) => acc + (r.supportTatMs ?? r.tatMs ?? 0), 0) / repliesList.length)
      : firstResponseTimeMs;
    const actualAvgReplyTatMs = repliesList.length > 0
      ? Math.round(repliesList.reduce((acc, r) => acc + (r.actualTatMs ?? 0), 0) / repliesList.length)
      : actualFirstResponseTimeMs;

    const totalCycleDurationMs = (initialCustomerTime && latestAgentTime)
      ? this.computeBusinessDurationMs(initialCustomerTime, latestAgentTime, config)
      : null;
    const actualTotalCycleDurationMs = (initialCustomerTime && latestAgentTime)
      ? Math.max(0, latestAgentTime - initialCustomerTime)
      : null;

    // ONLY set pendingSince if awaitingAgentReply is true AND finalStatus is PENDING_REPLY!
    const pendingSince = (finalStatus === 'PENDING_REPLY' && awaitingAgentReply && latestCustomerTime) ? latestCustomerTime : null;
    const currentPendingDurationMs = pendingSince ? this.computeBusinessDurationMs(pendingSince, Date.now(), config) : null;
    const actualPendingDurationMs = pendingSince ? Math.max(0, Date.now() - pendingSince) : null;

    const initialDateKey = TatUtils.formatDateKey(initialCustomerTime || latestCustomerTime || Date.now());
    const latestDateKey = TatUtils.formatDateKey(latestAgentTime || latestCustomerTime || initialCustomerTime || Date.now());
    if (initialDateKey) activeDatesSet.add(initialDateKey);
    if (latestDateKey) activeDatesSet.add(latestDateKey);

    const customerQueriesText = this.formatCustomerQueriesText(customerBodies);
    const orderId = this.extractOrderId(subject, customerBodies, timeline);

    const threadObj = {
      threadId,
      orderId,
      customerReplies: customerBodies,
      customerRepliesText: customerQueriesText,
      customerBodies,
      customerQueriesText,
      subject: subject || '(No Subject)',
      customerEmail: customerEmail || 'Unknown',
      customerName: customerName || customerEmail || 'Customer',
      dateKey: latestDateKey || initialDateKey,
      initialDateKey,
      latestDateKey,
      activeDates: Array.from(activeDatesSet).sort(),
      initialCustomerTime,
      firstAgentTime,
      latestCustomerTime,
      latestAgentTime,
      firstResponseTimeMs,
      actualFirstResponseTimeMs,
      latestResponseTimeMs,
      actualLatestResponseTimeMs,
      lastRepliedCustomerQueryTime,
      lastRepliedAgentTime,
      avgReplyTatMs,
      actualAvgReplyTatMs,
      totalCycleDurationMs,
      actualTotalCycleDurationMs,
      customerQueryCount,
      customerMessageCount: Math.max(customerMessageCount, customerBodies.length, customerQueryCount || 1),
      agentReplyCount,       // True revert count
      customerReopenCount,
      repliesList,           // Full list of all replies and their Support & Actual TATs
      status: finalStatus,
      tags: cleanTags,
      pendingSince,
      currentPendingDurationMs,
      initialQueryInSupportHours: this.isWithinSupportHours(initialCustomerTime, config),
      messageCount: sorted.length,
      timeline,
      lastUpdated: Date.now()
    };

    const tagClass = this.classifyThreadTags(cleanTags, threadObj);
    return {
      ...threadObj,
      tagClassification: tagClass,
      isResolved: tagClass.isResolved,
      isFollowUpNeeded: tagClass.isFollowUpNeeded,
      isFollowUpGeneral: tagClass.isFollowUpGeneral,
      isFollowUpReturn: tagClass.isFollowUpReturn,
      isFollowUpReplacement: tagClass.isFollowUpReplacement,
      isPaymentPending: tagClass.isPaymentPending,
      primaryCategory: tagClass.primaryCategory,
      primaryLabel: tagClass.primaryLabel
    };
  },

  // Upgrade/Normalize any older stored thread object (and repair any 2001 year timestamps or misclassified agent replies)
  normalizeThread(t, config = null) {
    if (!t || typeof t !== 'object') return t;
    const activeConfig = config || this._cachedSettings || null;

    // Fix any timestamps that were previously parsed as year 2001
    t.initialCustomerTime = this.fixMissingYear(t.initialCustomerTime);
    t.firstAgentTime = this.fixMissingYear(t.firstAgentTime);
    t.latestCustomerTime = this.fixMissingYear(t.latestCustomerTime);
    t.latestAgentTime = this.fixMissingYear(t.latestAgentTime);
    t.lastRepliedCustomerQueryTime = this.fixMissingYear(t.lastRepliedCustomerQueryTime);
    t.lastRepliedAgentTime = this.fixMissingYear(t.lastRepliedAgentTime);
    t.pendingSince = this.fixMissingYear(t.pendingSince);
    t.tags = this.cleanTagList(t.tags || []);

    if (Array.isArray(t.timeline) && t.timeline.length > 0) {
      t.timeline = t.timeline.map((evt, idx) => {
        const fixedTs = this.fixMissingYear(evt.timestamp);
        let type = evt.type;
        // Self-heal: if an event in timeline was recorded as CUSTOMER_MSG before agent email was learned,
        // check if evt.sender is actually the support agent (e.g. care@betterhood.in or different from customerEmail)
        if ((type === 'CUSTOMER_MSG' || type === 'REOPENED') && this.isLikelyAgentSender(evt.sender, t.customerEmail)) {
          type = 'AGENT_REPLY';
        }
        return {
          ...evt,
          type,
          timestamp: fixedTs,
          customerQueryTime: this.fixMissingYear(evt.customerQueryTime),
          _idx: idx
        };
      }).sort((a, b) => ((a.timestamp || 0) - (b.timestamp || 0)) || (a._idx - b._idx));
    }

    const activeDatesSet = new Set();
    const initDate = this.formatDateKey(t.initialCustomerTime);
    const lastCustDate = this.formatDateKey(t.latestCustomerTime);
    const lastAgentDate = this.formatDateKey(t.latestAgentTime);
    if (initDate) activeDatesSet.add(initDate);
    if (lastCustDate) activeDatesSet.add(lastCustDate);
    if (lastAgentDate) activeDatesSet.add(lastAgentDate);

    // Reconstruct accurate repliesList from sorted timeline whenever timeline is available
    if (Array.isArray(t.timeline) && t.timeline.length > 0) {
      const builtReplies = [];
      let firstCustTs = t.initialCustomerTime || null;
      let lastCustTs = t.initialCustomerTime || null;
      let maxCustTs = 0;
      let maxAgentTs = 0;
      let queryTurnCount = 0;
      let reopenCount = 0;
      let waitingReply = false;
      let prevSender = null;

      t.timeline.forEach(evt => {
        const dKey = this.formatDateKey(evt.timestamp);
        if (dKey) activeDatesSet.add(dKey);
        const isCust = evt.type === 'CUSTOMER_MSG' || evt.type === 'REOPENED';
        if (isCust) {
          if (!firstCustTs) firstCustTs = evt.timestamp;
          lastCustTs = evt.timestamp;
          maxCustTs = Math.max(maxCustTs, evt.timestamp || 0);
          if (!waitingReply) {
            queryTurnCount++;
            waitingReply = true;
            if (prevSender === 'AGENT') reopenCount++;
          }
          prevSender = 'CUSTOMER';
        } else if (evt.type === 'AGENT_REPLY' || evt.type === 'AGENT_FOLLOWUP') {
          maxAgentTs = Math.max(maxAgentTs, evt.timestamp || 0);
          if (!t.firstAgentTime) t.firstAgentTime = evt.timestamp;
          if (waitingReply || evt.type === 'AGENT_REPLY') {
            const idx = builtReplies.length + 1;
            const qTime = lastCustTs || firstCustTs || evt.customerQueryTime;
            const effectiveSupportStart = this.getEffectiveSupportStartTime(qTime, activeConfig);
            const supportTat = (qTime && evt.timestamp >= qTime)
              ? this.computeBusinessDurationMs(qTime, evt.timestamp, activeConfig)
              : (evt.supportTatMs ?? evt.tatMs ?? t.firstResponseTimeMs ?? 0);
            const actualTat = (qTime && evt.timestamp >= qTime)
              ? Math.max(0, evt.timestamp - qTime)
              : (evt.actualTatMs ?? supportTat);
            const isSupport = qTime ? this.isWithinSupportHours(qTime, activeConfig) : true;

            builtReplies.push({
              replyIndex: idx,
              label: idx === 1 ? '1st Reply (Initial)' : `Reply #${idx} (Reopen #${idx - 1})`,
              customerQueryTime: qTime,
              effectiveSupportStartTime: effectiveSupportStart,
              agentReplyTime: evt.timestamp,
              tatMs: supportTat,
              supportTatMs: supportTat,
              actualTatMs: actualTat,
              isSupportHours: isSupport,
              dateKey: this.formatDateKey(evt.timestamp),
              queryDateKey: this.formatDateKey(qTime)
            });
            evt.revertIndex = idx;
            evt.customerQueryTime = qTime;
            evt.tatMs = supportTat;
            evt.supportTatMs = supportTat;
            evt.actualTatMs = actualTat;
            waitingReply = false;
          }
          prevSender = 'AGENT';
        }
      });

      if (maxCustTs > 0) t.latestCustomerTime = maxCustTs;
      if (maxAgentTs > 0) t.latestAgentTime = maxAgentTs;

      if (builtReplies.length > 0) {
        t.repliesList = builtReplies;
        t.agentReplyCount = builtReplies.length;
        t.customerQueryCount = Math.max(1, queryTurnCount);
        t.customerReopenCount = Math.max(reopenCount, builtReplies.length - 1);
      } else {
        t.repliesList = [];
      }
    } else if (Array.isArray(t.repliesList)) {
      t.repliesList = t.repliesList.map((r, idx) => {
        const qTime = this.fixMissingYear(r.customerQueryTime);
        const aTime = this.fixMissingYear(r.agentReplyTime);
        const supportTat = (qTime && aTime && aTime >= qTime)
          ? this.computeBusinessDurationMs(qTime, aTime, activeConfig)
          : (r.supportTatMs ?? r.tatMs ?? 0);
        const actualTat = (qTime && aTime && aTime >= qTime)
          ? Math.max(0, aTime - qTime)
          : (r.actualTatMs ?? supportTat);
        const isSupport = qTime ? this.isWithinSupportHours(qTime, activeConfig) : true;
        const dKey = this.formatDateKey(aTime);
        const qKey = this.formatDateKey(qTime);
        if (dKey) activeDatesSet.add(dKey);
        if (qKey) activeDatesSet.add(qKey);
        return {
          ...r,
          replyIndex: idx + 1,
          label: idx === 0 ? '1st Reply (Initial)' : `Reply #${idx + 1} (Reopen #${idx})`,
          customerQueryTime: qTime,
          effectiveSupportStartTime: this.getEffectiveSupportStartTime(qTime, activeConfig),
          agentReplyTime: aTime,
          tatMs: supportTat,
          supportTatMs: supportTat,
          actualTatMs: actualTat,
          isSupportHours: isSupport,
          dateKey: dKey,
          queryDateKey: qKey
        };
      });
    } else {
      t.repliesList = [];
    }

    (t.repliesList || []).forEach(r => {
      if (r.dateKey) activeDatesSet.add(r.dateKey);
      if (r.queryDateKey) activeDatesSet.add(r.queryDateKey);
    });

    // If the agent has already replied to the latest customer query, ensure status is RESOLVED and pendingSince is null!
    const lastEvt = (Array.isArray(t.timeline) && t.timeline.length > 0) ? t.timeline[t.timeline.length - 1] : null;
    const lastEvtIsAgent = lastEvt && (lastEvt.type === 'AGENT_REPLY' || lastEvt.type === 'AGENT_FOLLOWUP');
    const agentRepliedAfterLastCust = t.latestAgentTime && t.latestCustomerTime && t.latestAgentTime >= t.latestCustomerTime;
    const hasResolvedTag = this.interpretTags(t.tags, false) === 'RESOLVED';

    if (lastEvtIsAgent || agentRepliedAfterLastCust || hasResolvedTag || (t.repliesList && t.repliesList.length > 0 && !t.pendingSince)) {
      t.status = 'RESOLVED';
      t.pendingSince = null;
      t.currentPendingDurationMs = null;
    }

    const lastReply = (t.repliesList && t.repliesList.length > 0) ? t.repliesList[t.repliesList.length - 1] : null;
    if (lastReply) {
      t.firstResponseTimeMs = t.repliesList[0].supportTatMs ?? t.repliesList[0].tatMs;
      t.actualFirstResponseTimeMs = t.repliesList[0].actualTatMs ?? t.firstResponseTimeMs;
      t.latestResponseTimeMs = lastReply.supportTatMs ?? lastReply.tatMs;
      t.actualLatestResponseTimeMs = lastReply.actualTatMs ?? t.latestResponseTimeMs;
      t.lastRepliedCustomerQueryTime = lastReply.customerQueryTime;
      t.lastRepliedAgentTime = lastReply.agentReplyTime;
      t.avgReplyTatMs = Math.round(t.repliesList.reduce((acc, r) => acc + (r.supportTatMs ?? r.tatMs ?? 0), 0) / t.repliesList.length);
      t.actualAvgReplyTatMs = Math.round(t.repliesList.reduce((acc, r) => acc + (r.actualTatMs ?? 0), 0) / t.repliesList.length);
    } else {
      if (t.initialCustomerTime && t.firstAgentTime) {
        t.firstResponseTimeMs = this.computeBusinessDurationMs(t.initialCustomerTime, t.firstAgentTime, activeConfig);
        t.actualFirstResponseTimeMs = Math.max(0, t.firstAgentTime - t.initialCustomerTime);
      }
      t.latestResponseTimeMs = t.latestResponseTimeMs ?? t.firstResponseTimeMs ?? null;
      t.actualLatestResponseTimeMs = t.actualLatestResponseTimeMs ?? t.actualFirstResponseTimeMs ?? null;
      t.avgReplyTatMs = t.avgReplyTatMs ?? t.firstResponseTimeMs ?? null;
      t.actualAvgReplyTatMs = t.actualAvgReplyTatMs ?? t.actualFirstResponseTimeMs ?? null;
    }

    t.initialQueryInSupportHours = t.initialCustomerTime ? this.isWithinSupportHours(t.initialCustomerTime, activeConfig) : true;

    if (t.pendingSince) {
      t.currentPendingDurationMs = this.computeBusinessDurationMs(t.pendingSince, Date.now(), activeConfig);
      t.actualPendingDurationMs = Math.max(0, Date.now() - t.pendingSince);
    }

    const updatedLastAgentDate = this.formatDateKey(t.latestAgentTime);
    const updatedLastCustDate = this.formatDateKey(t.latestCustomerTime);
    if (updatedLastAgentDate) activeDatesSet.add(updatedLastAgentDate);
    if (updatedLastCustDate) activeDatesSet.add(updatedLastCustDate);

    t.initialDateKey = initDate || t.initialDateKey || t.dateKey;
    t.latestDateKey = updatedLastAgentDate || updatedLastCustDate || t.latestDateKey || t.dateKey;
    if (t.latestDateKey) {
      t.dateKey = t.latestDateKey;
    }
    t.activeDates = Array.from(activeDatesSet).filter(d => d && !d.startsWith('2001-')).sort();
    if (t.activeDates.length === 0 && t.dateKey) {
      t.activeDates = [t.dateKey];
    }

    // Ensure customerReplies, customerRepliesText, customerBodies, customerQueriesText, customerMessageCount, and orderId are populated
    t.customerBodies = Array.isArray(t.customerBodies) ? t.customerBodies : [];
    t.customerReplies = Array.isArray(t.customerReplies) && t.customerReplies.length > 0 ? t.customerReplies : t.customerBodies;

    if (t.customerReplies.length === 0 && Array.isArray(t.timeline)) {
      t.timeline.forEach((evt) => {
        if ((evt.type === 'CUSTOMER_MSG' || evt.type === 'REOPENED') && evt.body && typeof evt.body === 'string' && evt.body.trim()) {
          const txt = evt.body.trim();
          if (!t.customerReplies.some(b => b.text === txt)) {
            t.customerReplies.push({
              replyIndex: t.customerReplies.length + 1,
              timestamp: evt.timestamp,
              text: txt
            });
          }
        }
      });
    }
    t.customerBodies = t.customerReplies;
    if (!t.customerRepliesText || t.customerRepliesText === 'N/A') {
      t.customerRepliesText = this.formatCustomerRepliesText(t.customerReplies);
    }
    t.customerQueriesText = t.customerRepliesText;
    t.orderId = t.orderId || this.extractOrderId(t.subject, t.customerRepliesText || t.customerReplies, t.timeline);
    t.customerMessageCount = Math.max(t.customerMessageCount || 0, t.customerReplies.length, t.customerQueryCount || 1);

    const tagClass = this.classifyThreadTags(t.tags, t);
    t.tagClassification = tagClass;
    t.isResolved = tagClass.isResolved;
    t.isFollowUpNeeded = tagClass.isFollowUpNeeded;
    t.isFollowUpGeneral = tagClass.isFollowUpGeneral;
    t.isFollowUpReturn = tagClass.isFollowUpReturn;
    t.isFollowUpReplacement = tagClass.isFollowUpReplacement;
    t.isPaymentPending = tagClass.isPaymentPending;
    t.primaryCategory = tagClass.primaryCategory;
    t.primaryLabel = tagClass.primaryLabel;

    return t;
  },

  // Helper to check if extension context is valid
  isContextValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local);
    } catch (e) {
      return false;
    }
  },

  // Storage wrappers
  async getAllThreads() {
    return new Promise((resolve) => {
      try {
        if (!this.isContextValid()) {
          resolve({});
          return;
        }
        chrome.storage.local.get(['threads'], (result) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve({});
            return;
          }
          const raw = (result && result.threads) || {};
          let cleaned = false;
          Object.keys(raw).forEach(k => {
            const item = raw[k];
            if (item && ((item.subject === 'Email Conversation' && item.messageCount > 30) || (item.customerQueryCount > 50 && item.customerReopenCount > 25))) {
              delete raw[k];
              cleaned = true;
            } else if (item) {
              raw[k] = this.normalizeThread(item, this._cachedSettings);
            }
          });
          if (cleaned && this.isContextValid()) {
            chrome.storage.local.set({ threads: raw }, () => {});
          }
          resolve(raw);
        });
      } catch (e) {
        resolve({});
      }
    });
  },

  async saveThread(threadData) {
    if (!threadData || !threadData.threadId) return null;
    try {
      if (!this.isContextValid()) return null;
      const all = await this.getAllThreads();
      const existing = all[threadData.threadId];

      // Only merge earlier replies from storage if Gmail collapsed older messages (so current DOM has fewer messages than previously seen)
      if (
        existing &&
        (existing.messageCount || 0) > (threadData.messageCount || 0) &&
        Array.isArray(existing.repliesList) &&
        existing.repliesList.length > 0 &&
        Array.isArray(threadData.repliesList)
      ) {
        const earliestCurrentQueryTime = threadData.repliesList.length > 0
          ? threadData.repliesList[0].customerQueryTime
          : (threadData.initialCustomerTime || Infinity);

        const olderHiddenReplies = existing.repliesList.filter(r => (r.agentReplyTime || 0) < earliestCurrentQueryTime);
        if (olderHiddenReplies.length > 0) {
          const mergedList = [...olderHiddenReplies, ...threadData.repliesList].map((r, idx) => ({
            ...r,
            replyIndex: idx + 1,
            label: idx === 0 ? '1st Reply (First Response)' : `Reply #${idx + 1} (Reopen #${idx})`
          }));
          threadData.repliesList = mergedList;
          threadData.agentReplyCount = mergedList.length;
          threadData.customerReopenCount = Math.max(threadData.customerReopenCount || 0, mergedList.length - 1);
          threadData.customerQueryCount = Math.max(threadData.customerQueryCount || 0, mergedList.length + (threadData.status === 'PENDING_REPLY' ? 1 : 0));
          threadData.firstResponseTimeMs = mergedList[0].tatMs;
          threadData.initialCustomerTime = mergedList[0].customerQueryTime || existing.initialCustomerTime || threadData.initialCustomerTime;
          threadData.firstAgentTime = mergedList[0].agentReplyTime || existing.firstAgentTime || threadData.firstAgentTime;
          const lastR = mergedList[mergedList.length - 1];
          threadData.latestResponseTimeMs = lastR.tatMs;
          threadData.lastRepliedCustomerQueryTime = lastR.customerQueryTime;
          threadData.lastRepliedAgentTime = lastR.agentReplyTime;
          threadData.avgReplyTatMs = Math.round(mergedList.reduce((acc, r) => acc + (r.tatMs || 0), 0) / mergedList.length);
        }
      }

      // Merge / append customerReplies across scans:
      // When opening a new mail: preserves all customer replies fetched from the thread.
      // When opening an already opened (old) mail: fetches the latest customer reply from the thread and appends it.
      const currentReplies = Array.isArray(threadData.customerReplies) && threadData.customerReplies.length > 0
        ? threadData.customerReplies
        : (Array.isArray(threadData.customerBodies) ? threadData.customerBodies : []);
      const existingReplies = existing
        ? ((Array.isArray(existing.customerReplies) && existing.customerReplies.length > 0)
            ? existing.customerReplies
            : (Array.isArray(existing.customerBodies) ? existing.customerBodies : []))
        : [];
      const combinedReplies = [...existingReplies];

      currentReplies.forEach(cr => {
        if (!cr || !cr.text || !cr.text.trim()) return;
        const matchIdx = combinedReplies.findIndex(er => (er.timestamp && cr.timestamp && Math.abs(er.timestamp - cr.timestamp) < 5000) || er.text === cr.text);
        if (matchIdx !== -1) {
          // If the reply is already known, upgrade snippet to fuller message body if current scan has longer text
          if (cr.text.length > (combinedReplies[matchIdx].text || '').length) {
            combinedReplies[matchIdx] = { ...combinedReplies[matchIdx], text: cr.text };
          }
        } else {
          // New customer reply from the thread (e.g. latest reply in an old thread) - append it!
          combinedReplies.push({
            replyIndex: combinedReplies.length + 1,
            timestamp: cr.timestamp || Date.now(),
            text: cr.text.trim()
          });
        }
      });

      combinedReplies.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      combinedReplies.forEach((r, idx) => {
        r.replyIndex = idx + 1;
      });

      if (combinedReplies.length > 0) {
        threadData.customerReplies = combinedReplies;
        threadData.customerBodies = combinedReplies;
        threadData.customerRepliesText = this.formatCustomerRepliesText(combinedReplies);
        threadData.customerQueriesText = threadData.customerRepliesText;
        threadData.customerMessageCount = Math.max(threadData.customerMessageCount || 0, combinedReplies.length, threadData.customerQueryCount || 1);
      }
      if (!threadData.orderId && existing && existing.orderId) {
        threadData.orderId = existing.orderId;
      }

      all[threadData.threadId] = this.normalizeThread({
        ...(existing || {}),
        ...threadData,
        lastUpdated: Date.now()
      }, this._cachedSettings);

      return new Promise((resolve) => {
        if (!this.isContextValid()) {
          resolve(null);
          return;
        }
        chrome.storage.local.set({ threads: all }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(all[threadData.threadId]);
        });
      });
    } catch (e) {
      return null;
    }
  },

  async getSettings() {
    const defaults = {
      agentEmails: ['care@betterhood.in'],
      agentNames: ['betterhood Customer Care'],
      slaThresholdHours: 2, // warning threshold for TAT
      autoDetectUser: true,
      useBusinessHours: true,
      businessHoursStart: '10:00',
      businessHoursEnd: '19:00',
      businessDays: [1, 2, 3, 4, 5, 6] // Mon to Sat (Sunday off: 10:00am to 7:00pm)
    };
    return new Promise((resolve) => {
      try {
        if (!this.isContextValid()) {
          this._cachedSettings = defaults;
          resolve(defaults);
          return;
        }

        // Try chrome.storage.sync first for automatic multi-laptop syncing
        const syncStorage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) ? chrome.storage.sync : chrome.storage.local;
        syncStorage.get(['settings'], (syncRes) => {
          if (!chrome.runtime.lastError && syncRes && syncRes.settings) {
            const loaded = Object.assign({}, defaults, syncRes.settings);
            this._cachedSettings = loaded;
            resolve(loaded);
            return;
          }

          chrome.storage.local.get(['settings'], (localRes) => {
            const loaded = Object.assign({}, defaults, (localRes && localRes.settings) || {});
            this._cachedSettings = loaded;
            resolve(loaded);
          });
        });
      } catch (e) {
        this._cachedSettings = defaults;
        resolve(defaults);
      }
    });
  },

  async saveSettings(settings) {
    this._cachedSettings = settings;
    return new Promise((resolve) => {
      try {
        if (!this.isContextValid()) {
          resolve(settings);
          return;
        }
        // Save to both sync (cross-laptop) and local storage
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
          try { chrome.storage.sync.set({ settings }, () => {}); } catch (e) {}
        }
        chrome.storage.local.set({ settings }, () => {
          resolve(settings);
        });
      } catch (e) {
        resolve(settings);
      }
    });
  },

  // CSV Exporter with distinct Support Hours (10am-7pm Mon-Sat) & 24x7 Actual TAT breakdown
  exportToCSV(threadsArray) {
    const headers = [
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
      'Last Query to Reply TAT Support Hours (Readable)',
      'Last Query to Reply TAT 24x7 Actual (Readable)',
      'Avg Reply TAT Support Hours (Readable)',
      'Avg Reply TAT Support Hours (Minutes)',
      'Avg Reply TAT 24x7 Actual (Readable)',
      'Avg Reply TAT 24x7 Actual (Minutes)',
      'All Replies TAT Breakdown',
      'Customer Mails Count',
      'Agent Reverts (Reply Count)',
      'Customer Reopened Count',
      'Tag / Status Category',
      'Gmail Tags',
      'Total Cycle Time Support Hours (Readable)',
      'Total Cycle Time 24x7 Actual (Readable)'
    ];

    const rows = threadsArray.map(t => {
      const firstTatMins = t.firstResponseTimeMs !== null && t.firstResponseTimeMs !== undefined ? (t.firstResponseTimeMs / 60000).toFixed(1) : 'N/A';
      const actualFirstTatMins = t.actualFirstResponseTimeMs !== null && t.actualFirstResponseTimeMs !== undefined ? (t.actualFirstResponseTimeMs / 60000).toFixed(1) : firstTatMins;
      const lastTatMs = t.latestResponseTimeMs !== undefined ? t.latestResponseTimeMs : t.firstResponseTimeMs;
      const actualLastTatMs = t.actualLatestResponseTimeMs !== undefined ? t.actualLatestResponseTimeMs : t.actualFirstResponseTimeMs;
      const avgTatMins = typeof t.avgReplyTatMs === 'number' ? (t.avgReplyTatMs / 60000).toFixed(1) : 'N/A';
      const actualAvgTatMins = typeof t.actualAvgReplyTatMs === 'number' ? (t.actualAvgReplyTatMs / 60000).toFixed(1) : avgTatMins;

      const windowLabel = t.initialQueryInSupportHours ? 'Support Hours (10am-7pm)' : 'Non-Support / Off-Hours';

      const allRepliesSummary = (t.repliesList && t.repliesList.length > 0)
        ? t.repliesList.map(r => `#${r.replyIndex}: Support TAT: ${TatUtils.formatDuration(r.supportTatMs ?? r.tatMs)} | Actual: ${TatUtils.formatDuration(r.actualTatMs ?? r.tatMs)} [${r.isSupportHours ? 'Support Hrs' : 'Off-Hours'}] (Cust: ${TatUtils.formatShortDateTime(r.customerQueryTime)} -> Reply: ${TatUtils.formatShortDateTime(r.agentReplyTime)})`).join(' | ')
        : 'No replies yet';

      const tagClass = t.tagClassification || TatUtils.classifyThreadTags(t.tags || [], t);

      let customerRepliesText = t.customerRepliesText || t.customerQueriesText;
      if (!customerRepliesText || customerRepliesText === 'N/A') {
        const bodies = (Array.isArray(t.customerReplies) && t.customerReplies.length > 0)
          ? t.customerReplies
          : (Array.isArray(t.customerBodies) && t.customerBodies.length > 0 ? t.customerBodies : []);
        if (bodies.length > 0) {
          customerRepliesText = this.formatCustomerRepliesText(bodies);
        } else if (Array.isArray(t.timeline)) {
          const fromTimeline = t.timeline.filter(e => (e.type === 'CUSTOMER_MSG' || e.type === 'REOPENED') && e.body && typeof e.body === 'string' && e.body.trim()).map(e => e.body);
          if (fromTimeline.length > 0) {
            customerRepliesText = this.formatCustomerRepliesText(fromTimeline);
          }
        }
      }
      if (!customerRepliesText) customerRepliesText = 'N/A';

      return [
        t.threadId,
        t.orderId || 'N/A',
        t.dateKey || TatUtils.formatDateKey(t.latestCustomerTime || t.initialCustomerTime),
        t.initialDateKey || TatUtils.formatDateKey(t.initialCustomerTime),
        t.customerEmail,
        t.customerName,
        t.subject,
        customerRepliesText,
        TatUtils.formatDateTime(t.initialCustomerTime),
        windowLabel,
        TatUtils.formatSupportDuration(t.firstResponseTimeMs),
        firstTatMins,
        TatUtils.formatActualDuration(t.actualFirstResponseTimeMs),
        actualFirstTatMins,
        TatUtils.formatDateTime(t.latestCustomerTime),
        TatUtils.formatDateTime(t.latestAgentTime),
        TatUtils.formatSupportDuration(lastTatMs),
        TatUtils.formatActualDuration(actualLastTatMs),
        TatUtils.formatSupportDuration(t.avgReplyTatMs),
        avgTatMins,
        TatUtils.formatActualDuration(t.actualAvgReplyTatMs),
        actualAvgTatMins,
        allRepliesSummary,
        t.customerMessageCount || (Array.isArray(t.customerBodies) && t.customerBodies.length) || t.customerQueryCount || 1,
        t.agentReplyCount || 0,
        t.customerReopenCount || 0,
        tagClass.primaryLabel || (t.status === 'RESOLVED' ? 'Resolved' : 'Follow Up Needed'),
        (tagClass.cleanTags || []).join(', '),
        TatUtils.formatSupportDuration(t.totalCycleDurationMs),
        TatUtils.formatActualDuration(t.actualTotalCycleDurationMs)
      ];
    });

    const escapeField = (val) => {
      const str = String(val === null || val === undefined ? '' : val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvLines = [
      headers.map(escapeField).join(','),
      ...rows.map(row => row.map(escapeField).join(','))
    ];

    return csvLines.join('\r\n');
  },

  // Trigger CSV file download in browser
  downloadCSVFile(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename || `email_tat_report_${this.formatDateKey(Date.now())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  // Generate 2-letter avatar initials from name or email
  getInitials(name, email) {
    const src = (name && name !== 'Customer' && name !== 'Unknown') ? name : (email || 'CU');
    const clean = src.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase() || 'CU';
  },

  // Deterministic soft color palette for customer avatars
  getAvatarColor(identifier) {
    const colors = [
      { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' }, // Blue
      { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' }, // Green
      { bg: '#fef3c7', text: '#b45309', border: '#fde68a' }, // Amber
      { bg: '#fae8ff', text: '#86198f', border: '#f5d0fe' }, // Purple
      { bg: '#ffe4e6', text: '#be123c', border: '#fecdd3' }, // Rose
      { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' }, // Indigo
      { bg: '#fce7f3', text: '#9d174d', border: '#f472b6' }, // Pink
      { bg: '#e0f2fe', text: '#075985', border: '#7dd3fc' }, // Sky
      { bg: '#ccfbf1', text: '#115e59', border: '#5eead4' }  // Teal
    ];
    let hash = 0;
    const str = String(identifier || 'user');
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % colors.length;
    return colors[idx];
  },

  // Classify TAT urgency level
  getTatUrgency(tatMs, slaHours = 2) {
    if (!tatMs) return { label: 'Pending', class: 'tat-urgency-pending' };
    const mins = tatMs / 60000;
    if (mins <= 15) return { label: 'Fast (<15m)', class: 'tat-urgency-fast' };
    if (mins <= 60) return { label: 'Normal (<1h)', class: 'tat-urgency-normal' };
    if (mins <= slaHours * 60) return { label: 'Moderate', class: 'tat-urgency-warning' };
    return { label: 'Over SLA', class: 'tat-urgency-danger' };
  },

  // SLA distribution for charts
  getSlaDistribution(threads, slaHours = 2) {
    const dist = { under15: 0, under60: 0, underSla: 0, overSla: 0, pending: 0, total: threads.length };
    threads.forEach(t => {
      if (t.firstResponseTimeMs === null || t.firstResponseTimeMs === undefined) {
        dist.pending++;
        return;
      }
      const mins = t.firstResponseTimeMs / 60000;
      if (mins <= 15) dist.under15++;
      else if (mins <= 60) dist.under60++;
      else if (mins <= slaHours * 60) dist.underSla++;
      else dist.overSla++;
    });
    return dist;
  }
};

// Export for module or browser window
if (typeof window !== 'undefined') {
  window.TatUtils = TatUtils;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TatUtils;
}
