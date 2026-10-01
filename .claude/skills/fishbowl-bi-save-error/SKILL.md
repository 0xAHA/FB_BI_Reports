---
name: fishbowl-bi-save-error
description: Fix the Fishbowl BI error titled "Save Report Error" with the message "Loading data is only available on reports", caused by loadReportData running without a saved report context.
---

# Fix the Fishbowl BI save error

`loadReportData()` requires a saved report context. Calling it during script preview produces this error, even though the dialog title says "Save Report Error". `saveReportData()` has the same context requirement. The per-user APIs `loadSettings()` and `saveSettings()` work without that report context.

Find the call in the report's JavaScript and included libraries. It may be indirect: a settings initializer can load report data automatically. Checking whether the function exists or wrapping it in `try/catch` will not prevent a native error dialog.

Choose the fix according to the settings being stored:

- **Personal preferences:** use `loadSettings(key)` and `saveSettings(key, value)`, preserving existing keys and JSON values. If the report uses `FBLib.Settings`, add `masterStorage: 'none'` to its initialization config to disable the unused report-data layer. Ensure the library implements that option; otherwise add the equivalent conditional at the underlying report-data call. Reports using another settings library need the same behavior, not a dependency on FBLib.
- **Shared defaults or admin controls:** retain a shared master payload. Either access report data only when a saved report context is available, or move it to storage usable during preview. One approach is to publish through an authorized administrator's `saveSettings()` entry and read that same Dashboard `userproperties` entry for all users through `runQuery()`. Use a distinct key, preserve publisher permissions and report scope, and keep personal overrides separate. A per-user key alone does not create shared storage. Carry existing master values across or provide a one-time republish step.

Verify that preview no longer calls the native report-data APIs, then save a preference and reopen the report to confirm it persists. For shared settings, also confirm another user receives the published defaults. When Fishbowl is unavailable, check JavaScript syntax and mock the settings callbacks; state that live preview and persistence remain unverified.
