# Notifications and local/cloud status

## What runs now

- The existing bay polling drives overstay notifications, after a successful live response.
- A bay's active overstay is deduplicated until a confirmed Available state rearms it.
  Current backend does not supply occupancy log IDs; this is a bay-episode fallback.
  If future APIs supply log_id/alert_id, use them as the event key to distinguish visits
  even when a complete departure/arrival occurs between browser polls.
- Camera IDs 1 and 2 correspond to the existing Northbound and Southbound workers.
  Health comes from real frame receipts; 10 seconds without frames is Unstable,
  30 seconds is Disconnected. API-only mode reports Disabled, not a camera failure.
- Local backend health is polled separately from cloud status, every 3 seconds, with
  a 5-second timeout and no overlapping requests. Failed requests do not erase bays.
- A 7-second banner reserves space below the header, keeping controls accessible.
  Its progress uses the same duration/deadline as dismissal. Manual dismissal and
  unmount clean up the timer and animation. Alerts remain in the bell afterward.
- High-priority events get a banner, bell entry and a short generated tone. Sound is
  limited to once per 10 seconds and requires a browser interaction to enable audio.
- Recovery notifications use the bell without a warning sound/banner. CSV export
  completion is low priority and appears only in the bell.
- The newest 100 notices and active issue keys survive refresh within the browser tab.
  Notifications are currently per-browser, not a shared database audit trail.
- Clicking alerts opens the relevant bay/camera or system details. Target outlines
  last 5 seconds without changing occupancy colors. Read controls do not navigate.

## Cloud integration boundary

There is no cloud provider, upload worker, cloud credential, or remote database in
this repository. The UI therefore reports **Not configured**, not a fake Synced state.
No network dependency has been added to detection, SQLite, CSV export, or PA code.

`GET /api/system/status` returns local health, camera health, and the cloud status
contract. A future sync worker can call `system_status.update_cloud_status` inside
the same backend process (a separate worker will need a shared persistent status store).
The function is internal, not an unauthenticated network write endpoint.

The worker must report actual connection state (Online/Offline), sync state
(Synced/Syncing/Pending/Offline/Sync Error), pending count, last result, and UTC
last_successful_sync. Each acknowledged completed batch needs a unique completion_id
and completed_records count. Only acknowledge uploaded records after durable remote
success. On reconnect, the worker should enter Syncing when records are pending.
The UI reacts to these changes; it does not simulate uploads or infer cloud reachability
from browser internet access. Backend unavailability makes cloud status Unknown.

## Verification

```powershell
node --experimental-strip-types --test tests/notifications.test.mjs
.venv\Scripts\python -m unittest discover -s tests -v
npm.cmd run build
```

Manual checks after signing in:
1. Sidebar: Local System Online; Cloud Sync Not configured in current API-only mode.
2. Click system status; inspect the status details, close with Escape.
3. Export CSV in Analytics; bell adds a low-priority entry without a banner/sound.
4. Read one entry, then Mark all as read; counts follow actual unread entries.
5. With real detection enabled, an overstay produces one banner. Repeated polls do
   not reopen it. Clicking targets the bay with a temporary blue outline.
6. Disconnect a working camera long enough to become stale; reconnect and repeat.
   Each incident has one warning, followed by one recovery notification.
7. Stop/restart the local API: one local backend warning, then recovery. Stale cloud
   information is labeled Unknown rather than being shown as current.

Cloud transition tests use controlled fixtures, not a live cloud deployment.
No automated browser interaction or audible playback verification has been performed.
Existing camera configuration remains a UI-only feature; this change reports health
for the two actual configured backend workers rather than pretending added cameras are live.
