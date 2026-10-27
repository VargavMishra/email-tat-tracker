# ☁️ 24/7 Cloud Automation & Multi-Laptop Sync Guide
### Never Miss a Day's TAT or Daily Dump — Even When Your Laptops Are Turned Off!

---

## 🎯 The Problem This Solves
1. **You have 2 laptops:** When you work on Laptop 2, Laptop 1 doesn't have the data.
2. **You don't open a laptop for a day:** Because browser extensions only run when Chrome is open on that specific computer, taking a day off or working from your phone would normally mean that day's TAT isn't calculated and no daily dump is generated.
3. **Automated Central Dump:** You want a live spreadsheet (Google Sheet) that automatically updates every day without needing you to manually download a CSV file on a specific laptop.

---

## ⚡ The Solution: Google Cloud + Google Sheets 24/7 Automation

We have built a dedicated **Google Apps Script (`google_apps_script.js`)** that runs **inside your Google account on Google's cloud servers**:
* **24/7 Autonomous Cloud Execution:** Every day at 7:30 PM (after support hours end), Google Cloud searches Gmail, calculates Support Hours TAT (10am–7pm Mon–Sat with off-hours start clock), extracts Order IDs, extracts Customer Email Replies (`1: ... \n\n 2: ...`), and updates the **Google Sheet Dump**.
* **Zero Laptop Dependency:** Both of your laptops can be turned off, and the daily dump will still be created and calculated in your Google Sheet!
* **Multi-Laptop Synchronization:** Laptop 1 and Laptop 2 both connect to the same Google Sheet Webhook so they always stay 100% in sync!

---

## 🚀 Quick Setup (Takes Under 2 Minutes)

### Step 1: Create Your Google Sheet
1. Open [Google Sheets](https://sheets.new) in your browser.
2. Name the spreadsheet: **`Email TAT Tracker Master Dump`**.

### Step 2: Open Apps Script
1. In the Google Sheets top menu, click **Extensions** > **Apps Script**.
2. A new tab will open with code editor showing `Code.gs`.
3. Select and delete any default code inside `Code.gs`.

### Step 3: Paste the Script
1. Open the file [`google_apps_script.js`](file:///C:/Users/Sanjay%20Mishra/.gemini/antigravity/scratch/email-tat-tracker/google_apps_script.js) from your repository.
2. Copy the entire contents and paste it into `Code.gs`.
3. Click the **Save (💾)** icon in the toolbar.

### Step 4: Activate 24/7 Cloud Daily Trigger (Run Once)
1. In the toolbar function dropdown, select **`setupDailyTrigger`**.
2. Click **Run**.
3. Google will ask for permission:
   * Click **Review permissions**.
   * Select your Google Account (`care@betterhood.in`).
   * Click **Advanced** (bottom left).
   * Click **Go to Untitled project (unsafe)**.
   * Click **Allow**.
4. ✅ **Done!** The 24/7 daily trigger is now active! Every day at 7:30 PM, Google Cloud will scan Gmail and write the complete dump to your Google Sheet automatically!

---

### Step 5: (Optional) Connect Laptop 1 & Laptop 2 for Real-Time Sync
If you want both Laptop 1 and Laptop 2 to sync live whenever you open emails:

1. In the Apps Script window, click the blue **Deploy** button (top right) > **New deployment**.
2. Click the gear icon (⚙️) next to "Select type" and choose **Web app**.
3. Configure:
   * **Description:** `Email TAT Tracker Sync`
   * **Execute as:** `Me (care@betterhood.in)`
   * **Who has access:** `Anyone` *(Note: This allows your extension on both laptops to push/pull data seamlessly without authentication popups).*
4. Click **Deploy**.
5. Copy the **Web App URL** (looks like `https://script.google.com/macros/s/.../exec`).

#### Link Both Laptops:
* **On Laptop 1:**
  1. Open Dashboard (`chrome-extension://.../dashboard.html`) > Click **⚙️ Settings**.
  2. Under **☁️ Multi-Laptop Cloud Sync**, paste the URL into **Google Apps Script Webhook URL**.
  3. Click **🔄 Test & Sync Now** > You will see `✓ Success`.
  4. Click **Save Settings**.
* **On Laptop 2:**
  1. Open the Extension Dashboard on Laptop 2 > Click **⚙️ Settings**.
  2. Paste the exact same Web App URL into **Google Apps Script Webhook URL**.
  3. Click **🔄 Test & Sync Now**.
  4. Click **Save Settings**.

---

## 💻 Alternative: 100% Offline Laptop-to-Laptop Transfer (No Cloud Required)

If you prefer not to use Google Cloud or Webhooks, you can easily sync between laptops using the new **JSON Backup** feature:
1. **On Laptop 1:** Open Dashboard > Settings > Click **📤 Export Backup File (JSON)**.
   * A file named `email_tat_backup_YYYY-MM-DD.json` will download.
2. **On Laptop 2:** Open Dashboard > Settings > Click **📥 Import & Merge Backup (JSON)** and select the file.
   * All records from Laptop 1 are instantly merged into Laptop 2 without overwriting existing data!

---

## 📊 Summary of What You Now Have
| Feature | Local Extension (Single PC) | With Google Apps Script 24/7 Cloud |
| :--- | :--- | :--- |
| **Works when Laptop is turned off** | ❌ No | ✅ **Yes (Runs in Google Cloud)** |
| **Syncs between Laptop 1 & Laptop 2** | ❌ Separate | ✅ **Yes (Shared Database)** |
| **Daily Dump Generated Automatically** | ❌ Manual Export | ✅ **Yes (Always in Google Sheet)** |
| **Order ID & Customer Body Captured** | ✅ Yes | ✅ **Yes** |
| **Support Hours TAT (10am–7pm Mon–Sat)** | ✅ Yes | ✅ **Yes** |
| **24x7 Full Elapsed Actual TAT** | ✅ Yes | ✅ **Yes** |
