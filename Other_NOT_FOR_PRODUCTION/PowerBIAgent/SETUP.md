# Fishbowl → Power BI Agent — Setup Guide

This agent runs as a Windows Service, queries your Fishbowl server on a schedule, and pushes the data to a Power BI streaming dataset so your dashboards stay current automatically.

---

## Overview

```
Fishbowl Server  →  Windows Service  →  Power BI Streaming Dataset  →  Dashboard
  (REST API)          (this agent)         (push URL)
```

---

## Part 1 — Power BI Setup

Do this first so you have the push URL ready when the installer wizard asks for it.

### 1.1 — Create a free Power BI account (if you don't have one)

1. Go to [app.powerbi.com](https://app.powerbi.com)
2. Sign in with a Microsoft account (Outlook, Hotmail, or work Microsoft 365 account)
3. A free account is sufficient for testing — you only need Power BI Pro if you want to share dashboards with other people

### 1.2 — Create a Streaming Dataset

A streaming dataset is a special Power BI dataset that accepts data pushed via HTTP. It does not require a scheduled refresh — data arrives in real time.

1. In Power BI, click **My workspace** in the left sidebar
2. Click **+ New** → **Streaming dataset**
3. Select **API** and click **Next**

   > Do not choose Azure Stream or PubNub — those are different sources

4. Give the dataset a name, e.g. `Fishbowl Sales Orders`
5. Under **Values from stream**, add the following columns exactly as shown (names are case-sensitive):

   | Column name | Data type |
   |---|---|
   | OrderNumber | Text |
   | Customer | Text |
   | Total | Number |
   | Status | Text |
   | DateFirstShip | DateTime |

6. Leave **Historic data analysis** turned **On** — this lets you use the data in reports, not just live tiles
7. Click **Create**
8. Power BI shows you the **Push URL** — it looks like:
   ```
   https://api.powerbi.com/beta/{tenant-id}/datasets/{dataset-id}/rows?key={api-key}
   ```
9. **Copy this URL** — you will paste it into the installer wizard. Keep it private (it contains an API key).

### 1.3 — Create a Dashboard Tile

After the agent has pushed at least one batch of data:

1. Go to **My workspace** → **+ New** → **Dashboard**, give it a name
2. In the dashboard, click **Edit** → **Add a tile**
3. Choose **Custom Streaming Data** → **Next**
4. Select your `Fishbowl Sales Orders` dataset → **Next**
5. Choose a visualisation type — for example:
   - **Card** → set Value to `Total` → shows current total of open orders
   - **Line chart** → Axis = `DateFirstShip`, Values = `Total` → trend over time
   - **Table** → include all columns → a live order list
6. Click **Apply**

You can add multiple tiles from the same dataset. Tiles refresh automatically as the agent pushes new data.

---

## Part 2 — Fishbowl Setup

### 2.1 — Approve the Integrated Application

The Fishbowl REST API requires third-party tools to be approved before they can log in. **You cannot add the app manually** — it only appears in Fishbowl *after* the agent has attempted to log in once and failed. That first failed attempt is what registers it.

So the order is:

1. Finish installing and let the agent run (Part 3). Its first sync attempt will **fail to authenticate** — this is expected, not a misconfiguration.
2. In the Fishbowl Advanced client, go to **Setup** → **Settings** → **Integrated Apps** tab
3. The app now appears in the list, showing the **App Name** and **App ID** you entered in the installer wizard (default `PowerBI Agent` / `200`)
4. Select it and click the green **Approve** button in the top-right corner
5. No restart needed — the agent authenticates on its next scheduled sync

> Until you approve it, the agent logs:
> `App "PowerBI Agent" (id=200) is registered but not yet approved.`

---

## Part 3 — Install the Agent

### Prerequisites (on the Windows machine that will run the agent)

- Windows 10 or Windows 11 (Windows Server 2019+ also supported)
- Network access to the Fishbowl server (port 2456 by default)
- Internet access to `api.powerbi.com`
- Administrator rights (required to install a Windows Service)

### 3.1 — Run the installer

1. Double-click **FishbowlPowerBIAgent-Setup.exe**
2. Accept the UAC prompt (administrator rights required)
3. Follow the Inno Setup wizard — accept the default install location (`C:\Program Files\Fishbowl Power BI Agent`) or choose your own
4. On the final page, leave **Configure connection settings now** ticked and click **Finish**

### 3.2 — Config wizard

The configuration wizard opens automatically after installation.

| Field | What to enter |
|---|---|
| **Server URL** | URL of your Fishbowl server, e.g. `http://192.168.1.10:2456` or `http://localhost:2456` |
| **App Name** | Must match exactly what you entered in Integrated Applications — e.g. `PowerBI Agent` |
| **App ID** | Must match exactly — e.g. `200` |
| **Username** | A Fishbowl user account with read access to the data you want to sync |
| **Password** | That user's Fishbowl password — stored encrypted, never written as plain text |
| **Streaming Dataset URL** | The push URL copied from Power BI in Step 1.2 |
| **Sync interval (minutes)** | How often to push data — `15` is a good starting point |

Click **Save & Close**. The agent writes your settings to `config.ini` and the installer then starts the Windows Service automatically.

---

## Part 4 — After Installation

### Check it's working

1. Open **Services** (search for it in the Start Menu)
2. Find **Fishbowl Power BI Agent** — status should be **Running**
3. Open `C:\Program Files\Fishbowl Power BI Agent\agent.log` to see sync activity — you should see something like:
   ```
   2026-06-19 10:00:01  INFO     Fishbowl → Power BI Agent started  (interval: 15 min)
   2026-06-19 10:00:02  INFO     Authenticated to Fishbowl REST API as admin
   2026-06-19 10:00:03  INFO     sync_open_sales_orders complete — 47 row(s)
   2026-06-19 10:00:03  INFO     Pushed 47 row(s) to Power BI
   ```
4. Go back to your Power BI dashboard — your tiles should now show live data

### Change settings later

All non-sensitive settings live in:
```
C:\Program Files\Fishbowl Power BI Agent\config.ini
```

Open it in Notepad and edit any values:

```ini
[fishbowl]
base_url = http://localhost:2456
app_name = PowerBI Agent
app_id   = 200
username = admin

[powerbi]
push_url = https://api.powerbi.com/beta/…

[agent]
sync_interval_minutes = 15
log_file = C:\Program Files\Fishbowl Power BI Agent\agent.log

[secrets]
password_enc = <encrypted — do not edit this line manually>
```

After saving `config.ini`, restart the service for changes to take effect (see below).

To change the **password**, use **Start Menu → Fishbowl Power BI Agent → Configure Agent** — this reopens the wizard and re-encrypts the new password correctly.

### Manage the service

From the Start Menu open **Services**, find **Fishbowl Power BI Agent**, and use the right-click menu to start, stop, or restart it.

Or from an administrator Command Prompt:

```cmd
net start FishbowlPowerBIAgent
net stop  FishbowlPowerBIAgent
```

### Uninstall

Go to **Settings → Apps** (or **Control Panel → Add or Remove Programs**), find **Fishbowl Power BI Agent**, and click **Uninstall**.

The uninstaller will:
1. Ask for confirmation
2. Stop the Windows Service
3. Remove the service registration
4. Delete all installed files including `config.ini` and `agent.log`

---

## Part 5 — Adding More Data to Power BI

The agent is designed to be extended. To push additional datasets (e.g. inventory levels, open purchase orders):

1. Create another streaming dataset in Power BI with the columns you need
2. Copy its push URL
3. Open `PowerBIAgent\sync.py` and add a new sync function — there are commented examples at the bottom of that file
4. Rebuild the installer (see the developer section below)

---

## Part 6 — For Developers — Building the Installer

### Requirements

```
Python 3.11 or 3.12 (64-bit)
Inno Setup 6  →  https://jrsoftware.org/isinfo.php
```

### Steps

```cmd
cd PowerBIAgent

:: Install Python dependencies (including PyInstaller)
pip install -r requirements.txt

:: Bundle into a self-contained folder
pyinstaller FishbowlPBIAgent.spec

:: Open installer.iss in Inno Setup Compiler, then Build → Compile
:: Output: installer_output\FishbowlPowerBIAgent-Setup.exe
```

### Testing without installing

To run the agent in the console without creating a Windows Service:

```cmd
cd PowerBIAgent
python service.py debug
```

This runs the sync loop in the foreground and logs to the console. Press Ctrl+C to stop.

To test the config wizard standalone:

```cmd
python wizard.py
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Service won't start | `config.ini` missing or incomplete | Run **Configure Agent** from Start Menu |
| `App not yet approved` in log | Integrated app not approved in Fishbowl | Setup → Settings → Integrated Apps → select the app → green Approve button (top-right) |
| `401 Unauthorized` in log | Wrong username/password | Run **Configure Agent** and re-enter credentials |
| `Fetch failed` / network error | Agent can't reach Fishbowl server | Check `base_url` in `config.ini`; confirm port 2456 is accessible |
| No data appearing in Power BI | Wrong or expired push URL | Re-create streaming dataset in Power BI and update `push_url` in `config.ini` |
| Log file growing too large | Default — no rotation configured | Manually delete or truncate `agent.log`; the service will recreate it |
