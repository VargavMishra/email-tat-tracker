# ⏱️ Email TAT & SLA Tracker (Chrome Extension for Gmail)

A high-performance, privacy-focused Manifest V3 Chrome Extension designed for customer support representatives, operations teams, and email managers. It automatically measures **Turnaround Time (TAT)**, tracks **customer reopen counts**, records **agent reverts (replies)**, provides a **date-wise query & tag matrix**, supports **business working hours (shift hours)**, and exports complete data to **CSV**.

![Email TAT Tracker](icons/icon128.png)

---

## 🚀 Key Features

### 1. ⏱️ Precise Turnaround Time (TAT) & Multi-Reply Tracking
- **First Response TAT**: Automatically tracks the elapsed time from the customer's initial email to your first response.
- **Subsequent Re-query TAT**: When a customer re-queries and you reply again, TAT is tracked individually for each turn.
- **All Replies Dropdown**: Collapsible in-page HUD dropdown displaying the exact query and reply timestamp along with individual TAT for every message turn.
- **Last Query → Reply**: Instant visibility into how long the latest customer query took to resolve.

### 2. 🏢 Business Working Hours (Shift Hours) Engine
- Excludes off-hours, overnight hours, and non-working days (e.g. Sundays) so that off-hours queries do not artificially blow up your TAT into 2–3 days.
- **Configurable Shifts**: Set custom shift start and end times (e.g., 09:30 AM – 06:30 PM) and select working days (e.g., Mon–Sat).
- **Graceful Off-Hours Replies**: Prompt replies sent outside business hours are credited with their actual response time.
- **24/7 Clock Toggle**: Switch between Business Working Hours and 24/7 continuous clock anytime in Settings.

### 3. 🏷️ Real-Time Gmail Label & Tag Matrix Bifurcation
- Automatically extracts thread-level Gmail labels and categorizes conversations into operational matrix buckets:
  - **Resolved / Closed**
  - **Follow Up Needed (Total)**
    - **Follow Up (General)**
    - **Follow Up / Return**
    - **Follow Up / Replacement**
  - **Payment Pending**
- Live status detection: Automatically resolves threads when you reply and reopens when the customer replies back.

### 4. 📅 Strict Date-Wise Query Attribution
- **Today for Today, Tomorrow for Tomorrow**: Incoming customer queries are attributed strictly to the date they arrive.
- Top KPI cards and daily table isolate today's performance from older historical threads.
- Automatic daily rollover based on local system time.

### 5. 📊 Premium Analytics Dashboard
- **Volume & Resolution Chart**: Interactive visual breakdown of daily incoming query volume and resolution ratios.
- **SLA Compliance Distribution**: Stacked progress bar tracking Fast (<15m), Standard (15–60m), Moderate (1–2h), and Over-SLA queries.
- **Thread Audit Modal**: Step-by-step chronological audit log of all customer messages, agent reverts, and status transitions with a 📋 Copy Audit button.
- **Light & Dark Mode**: Persistent theme toggle with seamless UI styling.

### 6. 📥 One-Click RFC-4180 CSV Export
- **Export Thread Records**: Comprehensive per-thread CSV including Subject, Customer Email, Initial Query Time, First TAT, Last TAT, All Replies Breakdown, Revert Counts, and Gmail Tags.
- **Export Daily Matrix**: Daily aggregated summary CSV with thread counts, customer mails, agent replies, average turnaround times, and tag breakdowns.

### 7. 🔒 100% Private, Secure & Local
- All calculation and metadata storage is handled exclusively inside `chrome.storage.local`.
- Zero external server calls, zero database connections, and zero tracking.

---

## 📦 Installation Instructions (Chrome / Edge / Brave)

1. **Clone or Download this Repository**:
   ```bash
   git clone https://github.com/VargavMishra/email-tat-tracker.git
   ```
2. Open Google Chrome (or any Chromium browser).
3. Navigate to:
   ```text
   chrome://extensions/
   ```
4. Enable **Developer mode** using the toggle switch in the top-right corner.
5. Click **Load unpacked** in the top-left corner.
6. Select the folder containing `manifest.json`.
7. The extension **Email TAT & SLA Tracker (Gmail)** will now be installed and active! Pin it to your Chrome toolbar for quick access.

---

## 🛠️ Usage in Gmail

1. Open **[Gmail](https://mail.google.com)** (`mail.google.com`).
2. Open any email conversation thread:
   - A sleek floating HUD card appears above the email thread with:
     - **Status Badge**: `✓ Resolved` or `⏳ Awaiting Reply`.
     - **First Response TAT**: Time to your initial reply.
     - **Last Query → Reply**: Time to your most recent reply.
     - **All Replies Dropdown**: Click to expand and view every revert's turnaround time.
     - **Waiting on You**: Live timer for pending customer queries (automatically paused outside shift hours).
3. Reply to the customer and click **Send**:
   - The HUD banner updates automatically, records your reply, measures the TAT, and marks the query as resolved.

---

## ⚙️ Configuration & Settings

Click **⚙️ Settings** in the dashboard to customize:
- **Company Agent Emails**: Comma-separated list of agent email addresses (auto-detected by default).
- **SLA Warning Threshold**: Target hours threshold (default: 2 hours) for SLA compliance warnings.
- **Business Working Hours**:
  - Toggle Business Working Hours on/off.
  - Set Shift Start & End Times (e.g., `09:30` to `18:30`).
  - Configure active working days (Mon–Sat, Sun).
  - Saving settings automatically recalculates existing threads in storage.

---

## 📁 Project Architecture

```text
email-tat-tracker/
├── manifest.json       # Chrome Extension Manifest V3 configuration
├── background.js       # Background service worker & navigation monitoring
├── content.js          # In-page Gmail DOM observer & HUD banner injector
├── content.css         # Styling for Gmail in-page HUD & collapsible dropdown
├── utils.js            # Business hours engine, state machine, tag classification, CSV exporter
├── dashboard.html      # Full-screen analytics dashboard & settings modal
├── dashboard.css       # Complete dashboard design system (light/dark mode)
├── dashboard.js        # Dashboard controller, KPI aggregation & charts
├── popup.html          # Toolbar popup UI
├── popup.css           # Styling for toolbar popup
├── popup.js            # Popup metrics controller
├── icons/              # Extension icons (16px, 48px, 128px)
└── README.md           # Documentation & guides
```

---

## 📄 License

MIT License. Free for personal and commercial use.
