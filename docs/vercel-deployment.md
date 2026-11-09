# IT415 frontend deployment

This is a clearly labeled, static demonstration. It needs no Flask server,
database, camera, login credentials, Supabase, or cloud synchronization. The
hosted entry offers **Explore Demo**, which opens a separate visitor state, not
an authenticated administrator session. **Exit Demo** returns to that entry page.
Sample bay values and timers are fixed examples. Demo mode does not read or write
local account/settings/notification storage, issue auth tokens, or call Flask.
Analytics and violation examples, navigation, `/public-view`, and `/signage`
remain available. Camera connection, AI selection, account/settings changes,
PA controls and saved database exports are disabled. Sample analytics CSV/PDF
exports remain available.

Local `npm run dev` and `npm run build` retain normal backend-connected behavior.
Only `npm run build:demo` loads the committed `.env.demo` flag. Never place secrets
in `VITE_*` variables: their values can be included in browser JavaScript.

## Commit the latest work

Current branch: `feature/seminar-skills`. Nothing has been staged, committed or
pushed by this deployment preparation.

The database and three YOLO binaries were already tracked. First stop tracking
them while keeping the local files. This does not erase their earlier Git history.
Do not use plain `git rm` or delete the files from Explorer.

```powershell
git rm --cached --ignore-unmatch -- terminalsight.db trained_models/yolov8n/AMD/best.onnx trained_models/yolov8n/best.pt trained_models/yolov8n/yolov8n.pt
git add -u
git add .env.demo .vercelignore vercel.json AGENTS.md .agents/skills backend docs/backend-structure.md docs/vercel-deployment.md src tests/test_backend_startup.py tests/demo-deployment.test.mjs
git diff --cached --stat
git diff --cached --name-only
git commit -m "Organize backend and prepare labeled IT415 frontend demo"
git push -u origin feature/seminar-skills
```

The staged changes should include:

- Existing backend moves, root launcher, path handling, script/test updates and
  documentation from the completed organization work.
- Existing UI/report/cleanup changes and the two project skills/`AGENTS.md`.
- Deployment files `.env.demo`, `.vercelignore`, `vercel.json`, `.gitignore`,
  `package.json`, `vite.config.ts`, and this guide.
- `src/demo.ts`, demo branches in `App.tsx`, Sidebar, SampleCoverageNotice,
  Dashboard, Camera Zones, Analytics and Public Signage, plus demo tests.
- Index removals of the database and three model binaries above. Their local
  copies remain in place. No model/video/local-setting additions should appear.

Repository: https://github.com/januzzz-daqsss/TerminalSight-System

Latest branch after pushing:
https://github.com/januzzz-daqsss/TerminalSight-System/tree/feature/seminar-skills

## Update the existing production deployment

1. Open the **existing** Vercel project whose Settings > Domains lists
   `terminal-sight-system.vercel.app`. Keep this submitted domain; do not create
   another project.
2. In Settings > Git, confirm the connected repository is
   `januzzz-daqsss/TerminalSight-System`. In Settings > Environments > Production >
   Branch Tracking, select **feature/seminar-skills**, the branch containing this
   work. Confirm the deployment's source commit matches the new commit you pushed.
3. Use these settings (also recorded in `vercel.json`):

| Setting | Value |
| --- | --- |
| Root Directory | `./` — repository root containing `package.json` |
| Framework Preset | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build:demo` |
| Output Directory | `dist` |
| Node.js | 22.x |
| Environment variables | None required in the dashboard; `.env.demo` contains only `VITE_DEMO_MODE=true` |

Do not add SMTP passwords, database credentials, or a localhost backend URL to
Vercel. The demo build disables public-asset copying, and `.vercelignore` allows
only frontend build inputs. Only the generated `dist` is intended to be served.
The SPA rewrite supports refreshing and opening the public-display URLs directly.

4. Build the **new commit** in this existing project and ensure the successful
   deployment is Production (promote it if it was built as Preview). Redeploying an
   old commit will not include the fix. Open the submitted URL in a private browser,
   click **Explore Demo**, and verify Dashboard, Camera Zones, Violation Logs, Analytics and Settings, then
   open `/public-view` and `/signage` directly and refresh them. Confirm the
   hosted-demonstration label is present. Use a publicly accessible production
   deployment for the submission, rather than a Vercel-login-protected preview.
5. Continue using the submitted production URL:
   https://terminal-sight-system.vercel.app
   No production deployment or Vercel setting was changed by this preparation.

## Verification and current production findings

- Demo and normal production builds pass, including TypeScript checks.
- 16 frontend checks cover demo entry, all views, disabled camera controls,
  isolated storage, preserved local login, public displays and routing.
- Eight Flask API/authentication checks pass using temporary databases. Backend
  code, operational SQLite, detection and OCR were not changed for this fix.
- The hosted artifact contains only HTML, CSS and JavaScript. No database, model,
  video, credentials or backend source is served. The existing bundle-size warning
  is non-blocking.
- Read-only HTTPS checks found the submitted root URL returns 200, but its current
  JavaScript still references `/api/login` and contains no Explore Demo/hosted-demo
  UI. Both `/public-view` and `/signage` return 404 on that old deployment. The
  prepared `vercel.json` rewrite fixes deep links when included in the new build.
- `terminalsight.vercel.app` returns 404. Public HTTP results cannot establish
  whether the domains belong to the same Vercel project. Confirm domain assignments
  in the existing project's Settings > Domains; its live Git branch was not
  accessible from the public site.
- Interactive browser verification stopped because the desktop automation tool
  could not safely establish Chrome's current URL. No deployment settings were
  touched. Complete the short browser check above after updating production.

## Files changed for the Explore Demo follow-up

`src/App.tsx`, `src/demo.ts`, `src/components/views/AdminLogin.tsx`,
`src/components/views/SettingsView.tsx`, `src/components/views/CameraZonesView.tsx`,
`src/components/layout/Sidebar.tsx`, `src/notifications/useNotifications.ts`,
`tests/demo-deployment.test.mjs`, and this guide. The previously prepared
`.env.demo`, `vercel.json`, `.vercelignore`, build script, demo labels and other
control restrictions are reused and must be committed too.

References: [Vercel Vite guide](https://vercel.com/docs/frameworks/frontend/vite),
[Git and production branch settings](https://vercel.com/docs/git), and
[deployment exclusions](https://vercel.com/docs/deployments/vercel-ignore).
