# Occupancy CSV export — local verification

Run all commands from `D:\Documents\CAPSTONE\app` in PowerShell.
The complete implementations are in `app.py`, `src/components/views/AnalyticsView.tsx`,
`src/components/views/AdminLogin.tsx`, `src/components/views/DashboardView.tsx`,
`src/App.tsx`, and `vite.config.ts`.

## 1. Automated checks

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install flask flask-cors
.venv\Scripts\python -m unittest discover -s tests -v
npm.cmd run build
```

The tests create isolated temporary databases and cover authorization, token expiry,
credential changes, both endpoint URLs, empty exports, bay joins, unfinished visits,
ordering, Unicode, CSV quoting, formula protection, and database errors.

## 2. Start the API and frontend

```powershell
$env:TERMINALSIGHT_DISABLE_AI = '1'
.venv\Scripts\python app.py
```

In a second terminal:

```powershell
npm.cmd run dev -- --host 127.0.0.1
```

The AI-disable flag allows API-only verification without camera/model dependencies.
For normal camera operation, remove that environment variable and install requirements.txt.
Vite proxies `/api` to the local Flask server. Production hosting must also forward
`/api` to Flask on the same LAN host. No WAN is needed at runtime for this feature.

## 3. Verify the endpoint with your local admin account

```powershell
$credential = Get-Credential -Message 'TerminalSight local administrator'
$body = @{ username = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json
$login = Invoke-RestMethod http://127.0.0.1:5000/api/login -Method Post -ContentType 'application/json' -Body $body
Invoke-WebRequest http://127.0.0.1:5000/api/export/occupancy-csv -Headers @{ Authorization = "Bearer $($login.export_token)" } -OutFile "$env:TEMP\occupancy_logs.csv"
Get-Content "$env:TEMP\occupancy_logs.csv"
```

Without the Authorization header the endpoint returns 401. Export tokens expire after
8 hours or a backend restart, and become invalid after an account credential change.
Logout removes the browser's token; it does not revoke an already copied bearer token.

## 4. Verify the browser download

Sign in, open Analytics, and select **Export Turnaround Logs (CSV)**.
Check the disabled **Exporting…** state and the download confirmation, then open
`occupancy_logs.csv`. The export includes all database history regardless of the mock
chart date range. Empty databases correctly produce only the CSV header.
Stop Flask and retry to check the error message and that the button becomes available again.
Capture the Analytics screen and the automated check output for submission.

## Data compatibility and scope

The existing schema uses TEXT `Bay_N` slot IDs; initialization adds a compatible
`Parking_Slot` table and seeds ten bays without replacing existing rows. A LEFT JOIN
preserves historical rows whose slots are missing. The six specified occupancy columns
retain their names; `slot_number` is appended. Null values become empty cells, RFC 4180
quoting uses CRLF, and dangerous spreadsheet text is prefixed with an apostrophe.
The legacy `/api/export/csv` route shares the same authorization and serializer.

Existing Analytics charts and violation CSV remain mock data. Existing detector code
does not yet insert occupancy records, so real history requires a separate logging
integration. The existing email OTP feature is unrelated and still needs WAN access.

## 5. Commit and push after verification

```powershell
git diff --check
git add app.py vite.config.ts src/App.tsx src/components/views/AdminLogin.tsx src/components/views/AnalyticsView.tsx src/components/views/DashboardView.tsx tests/test_occupancy_export.py docs/occupancy-csv.md
git commit -m "Add authenticated occupancy CSV export to Analytics"
git push origin main
```
