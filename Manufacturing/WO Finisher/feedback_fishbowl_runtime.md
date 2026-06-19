---
name: Fishbowl BI runtime
description: How Fishbowl embedded-browser BI reports read/write/persist, plus SQL planner traps
type: reference
---

Fishbowl BI reports are single HTML files run in JxBrowser 8 (Chromium, ES2022+). Host JS functions:
- **Read:** `runQuery(sql)` → JSON string or null (sync, blocks UI); `runQueryAsync(sql)` → `Promise<already-parsed array>` (do NOT JSON.parse the resolved value). Route both through one normaliser (`runQueryP`) that returns `[]` for null, parses strings, passes arrays through. Only SELECT allowed; all result column keys come back lowercase.
- **Write:** `runRestApiAsync({method,path,body,contentType,timeout})` → parsed response; throws on HTTP error. Fishbowl writes go through the legacy external API: `POST /api/legacy/external/{RequestName}` with body `{RequestName: payload}`. Success = `FbiJson.FbiMsgsRs.{Rs}.statusCode === 1000`. Check `ErrorRs` first; preserve `statusMessage`/`ErrorRs.Message`.
- **Persistence:** `saveSettings(key,value)`/`loadSettings(key)` (per user), `saveReportData`/`loadReportData` (per report). NO localStorage/sessionStorage (cleared regularly).
- Other: `getUser()`, `hasUserAccess("Module-Right")`, `getLocationGroupList()` → accessible LG ids, `openModule(name,item)` (e.g. `openModule("Work Order","20270:001")`, `openModule("Picking","W20270:001")`), `getIcon("WO",statusId)`.

**Why:** these are the only integration points; everything the tool does is built on them.

**How to apply:**
- `<meta charset="UTF-8">` required. Feature-detect host fns; show friendly message when absent (running outside Fishbowl).
- Capture a load token before every `await`; re-check after, to drop stale loads.
- SQL planner traps: bare top-level `WITH` is rejected — wrap as `SELECT * FROM (WITH ... SELECT ...) AS wrapped_for_fishbowl_api`; prefer derived tables over CTEs (CTEs re-plan pathologically); replace correlated `EXISTS(...)` with `JOIN (SELECT DISTINCT col FROM big)`; use `TIMESTAMP 'YYYY-MM-DD HH:MM:SS'` literals; scope big tag scans to relevant part ids (unscoped tag aggregate was 1.7s, scoped 8ms).
- `bit` columns (trackingFlag, activeFlag, pickable, countedAsAvailable) read fine as 0/1 in Fishbowl runQuery but come back as Buffer over raw MySQL — cast with `col+0` when you need a number.
- Reference guide: `..\bi-script-javascript-api-guide.md`. WO finish API flow: `.\FISHBOWL_WORK_ORDER_FINISH_API.md`.
