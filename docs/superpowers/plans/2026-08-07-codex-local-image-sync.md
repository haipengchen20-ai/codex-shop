# Codex Local Image Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move daily Steam image output inside the project and make the visible Codex task execute it at 11:00.

**Architecture:** Update the existing JSON settings consumed by `daily-sync.js`, then update the existing Codex cron automation to run that script and report its result. Delete the redundant Windows task by its exact ASCII task name.

**Tech Stack:** Node.js, local JSON settings, Codex automation, Windows Task Scheduler.

## Global Constraints

- Output path is `D:\iwen-codex\codex-shop\data\images`.
- Codex automation runs daily at Beijing time 11:00 and is visible in “已安排”.
- The Codex automation performs the actual sync, not merely a status check.
- Remove only Windows task `SteamImageDailySync`.

---

### Task 1: Switch output and scheduling ownership

**Files:**
- Modify: `data/settings.json`
- Modify: Codex automation `steam`
- Delete: Windows task `SteamImageDailySync`

- [ ] **Step 1: Verify the currently configured path differs from the project output path**

Run: `node -e "const s=require('./data/settings.json'); if(s.folder === 'D:\\iwen-codex\\codex-shop\\data\\images') process.exit(1)"`

Expected: exit 0 before the change.

- [ ] **Step 2: Set the project-local output path**

Write exactly:

```json
{ "folder": "D:\\iwen-codex\\codex-shop\\data\\images" }
```

- [ ] **Step 3: Update the visible Codex automation**

Set automation `steam` active with a daily 11:00 schedule. Its prompt runs `node daily-sync.js` in the project directory and reports attempted, saved, and failed entries from the newest JSON log.

- [ ] **Step 4: Remove the old Windows schedule**

Run: `schtasks /Delete /TN SteamImageDailySync /F`

Expected: confirmation that only this exact task was deleted.

- [ ] **Step 5: Verify a real project-local sync**

Run: `node daily-sync.js`, then parse the newest JSON log using Node and confirm `saved > 0`, `failed === 0`, and every result folder begins with `D:\\iwen-codex\\codex-shop\\data\\images`.

- [ ] **Step 6: Run regression tests**

Run: `node --test`

Expected: all tests pass.

## Self-review

- The task covers the output path, visible Codex schedule, removal of the Windows schedule, real-sync verification, and regression tests.
- No placeholder requirements or ambiguous target names remain.
