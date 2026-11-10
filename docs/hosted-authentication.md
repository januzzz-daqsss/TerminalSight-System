# Hosted authentication — Phase 2

The hosted demo build keeps `/` as its anonymous Explore Demo entry. `/admin`
and `/admin/*` mount the Supabase provider and administrator gate. `/auth/callback`
accepts invitation/recovery links and shows password setup. `/public-view` and
`/signage` remain public, labeled sample displays without Supabase initialization.
Normal local builds retain Flask login. Deployment mode chooses infrastructure;
it never proves administrator identity.

## Authentication and permissions

- `src/auth/supabaseClient.ts` lazily creates the browser client from public
  configuration. Sessions and refresh tokens remain in memory. Reloading loses
  the session; URL sessions are processed explicitly, not automatically.
- `HostedAuthProvider.tsx` and `hostedAuthStore.ts` initialize session state,
  process auth events, refresh tokens, enforce expiry and handle logout. A failed
  logout stays locally locked until reload. Supabase access tokens can remain
  valid until expiry after logout; no custom revocation service is introduced.
- `HostedAccess.tsx` provides email/password login, password visibility, accessible
  labels, loading/error states, recovery requests and invitation/password setup.
  It renders the sample application only after server authorization succeeds.
- `hostedFlows.ts` wraps SDK operations with non-revealing errors. Reset requests
  return the same message for unknown addresses, provider errors and success.
- `capabilities.ts` explicitly distinguishes `hosted-admin`, `demo-visitor`,
  `local-admin` and unauthenticated access. Only a local administrator in a local
  deployment can operate terminal controls. Hosted administrators and visitors
  see sample data; camera/AI/settings/PA controls and saved SQLite exports remain
  disabled. No live synchronization is implied.
- `api/auth/authorize.ts` contains the server-side gate, which verifies
  each bearer token using Supabase `auth.getUser(token)` and checks the returned
  user's trusted `app_metadata.role === 'admin'`. It ignores caller-supplied role
  headers, query parameters and user metadata. Responses are uncached: 401 for
  invalid/missing authentication, 403 for non-admin users, 503 for unavailable or
  unconfigured verification, and 200 with only the authorized user ID.

React route guards provide presentation controls. A person controlling their
browser can alter rendered UI; this cannot authorize the hosted endpoint or grant
local Flask access. Future hosted privileged endpoints must independently use
server-side authorization for every request. No hosted operational API exists.
Local tokens and hosted tokens are never exchanged or sent to each other's APIs.

## Invitation and recovery callbacks

Supported callback inputs:

- `?token_hash=...&type=invite` or `type=recovery`, verified with `verifyOtp`.
- Supabase implicit redirect fragments containing `access_token`, `refresh_token`
  and `type=invite` or `type=recovery`, accepted with `setSession`.

The client explicitly uses `flowType: 'implicit'` with memory-only sessions.
PKCE code callbacks (`?code=...`) are scrubbed and rejected without attempting an
exchange. PKCE is not supported without an approved verifier-storage design;
no verifier or session is persisted to make redirects work. Fresh-tab email
callbacks must use one of the two supported formats above.

URL credentials and provider errors are removed using replaceState before async
validation. The HTML referrer policy is `no-referrer`. Query-string token hashes
can still appear in hosting request logs: avoid logging full callback URLs.
Provider claims and callback type values do not grant administrator permission.
Successful links open password setup (minimum 12 characters plus confirmation).
After Supabase saves the password, the session is refreshed and server role
verification still gates entry. Supabase independently enforces its password policy.
Invalid links offer a new reset request; invitations must be reissued by a trusted
administrator when necessary. No invitation email is sent by this application.

Password setup warns users to save before refreshing or closing the page. Reloading
after callback consumption loses the session and cannot resume setup from the
cleaned URL. The failure screen offers recovery by email. The setup screen also
links to `/admin?recovery=restart`, a full navigation to the recovery form that
drops the old in-memory client and carries no credentials. It sends no email until
the user submits the form. A newly issued link can be opened in a fresh tab.
An expired or unusable invitation may require the administrator to reissue it.

## Environment and safe preview testing

`.env.example` contains placeholders only. Configure these later in the preview
scope, using the same project and **public publishable key** for both pairs:

| Variable | Consumer |
| --- | --- |
| `VITE_SUPABASE_URL` | Browser build |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser build |
| `SUPABASE_URL` | Vercel function runtime |
| `SUPABASE_PUBLISHABLE_KEY` | Vercel function runtime |

The key must use `sb_publishable_`. Never use a secret/service-role key, SMTP
password or database credential in frontend configuration. Missing/invalid browser
configuration shows a sign-in-unavailable message; Explore Demo still works.

After code review and separate deployment approval:

1. Use a Preview deployment of `feature/hosted-authentication`; leave the existing
   production branch/domain unchanged. Keep repository root, Vite preset,
   `npm run build:demo`, output `dist`, and Node 22.x.
2. Configure the four variables in Preview and rebuild. The Vercel allowlist
   includes only frontend inputs and the isolated auth function; Flask,
   SQLite, models and videos stay excluded. SPA fallback excludes `/api`.
3. In a test Supabase project, authorize the exact preview `/auth/callback` URL.
   Check the invitation/recovery email template actually honors that redirect,
   or uses the supported token-hash callback form. These dashboard operations
   have not been performed by the implementation.
4. Provision an administrator with trusted `app_metadata.role = admin` and a
   non-admin test account. Never grant roles through editable user metadata.
5. Confirm root Explore Demo and both displays load without authentication or
   auth API calls. Verify direct `/admin` access requires sign-in, wrong passwords
   fail generically, non-admins are denied, and valid admins see sample labels.
6. Test invitation and recovery manually with those test accounts, expiry/reused
   links, password confirmation, token refresh, logout and network failure.
   Reload should require login again. Inspect the address bar for token cleanup.
7. Call `/api/auth/authorize` directly with missing, invalid and non-admin tokens;
   verify rejection even when browser roles/state are changed. Check API paths
   return JSON/404 rather than the SPA, and public deep-link refreshes work.

Plain Vite does not run Vercel functions. Demo-mode development and preview disable
the Flask proxy so hosted tokens cannot be forwarded to it. Normal local mode
retains the operational proxy but always excludes `/api/auth`. Use
`npm run preview -- --mode demo` when serving a demo build,
and use an approved Vercel preview for real hosted end-to-end verification.
No Supabase dashboard settings, real credentials, actual email sends, migrations,
commits, pushes or deployments were used during automated validation.

## Automated checks and limits

```powershell
npm.cmd exec -- tsc --noEmit
node --experimental-strip-types --test tests/hosted-auth.test.mjs tests/hosted-flows.test.mjs tests/hosted-callbacks.test.mjs
node --test tests/hosted-function-runtime.test.mjs
node --experimental-strip-types --test --test-timeout=120000 tests/demo-deployment.test.mjs tests/notifications.test.mjs tests/public-display.test.mjs
npm.cmd run build:demo
npm.cmd run build
git diff --check
```

Callback lifecycle tests use the installed Supabase SDK with fresh independent
clients and intercepted HTTP, including token-hash and implicit invitations and
recovery, consumed/expired links, session loss on reload, recovery restart, URL
cleanup ordering, and non-admin denial through the real authorization helper.
History replacement is modeled in memory; these are not real browser navigation
tests. Other unit tests use mocked SDK methods. Render tests cover
markup and route selection, not a real browser email round-trip or deployed Vercel
function packaging. Real Supabase role settings and email delivery remain preview
prerequisites. Browser sessions remain JavaScript-accessible; XSS protections and
hosted request rate limits need deployment review. Existing local OTP disclosure
and the previously reported tooling dependency advisories were not changed.

References: [Supabase recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail),
[OTP verification](https://supabase.com/docs/reference/javascript/auth-verifyotp),
[PKCE limitations](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[server identity verification](https://supabase.com/docs/reference/javascript/auth-getuser).

## Serverless ESM import regression

The Preview at commit `4ad2fd6` crashed before authorization because the emitted
`api/auth/authorize.js` still imported `../../server/hostedAuthorization.ts`, which
was not resolvable in the deployed function. The frontend TypeScript configuration
allows `.ts` imports with `noEmit`; passing that check or Vite's frontend build
never proved that the function's JavaScript runtime imports were valid.

The small authorization gate now lives in the function entry point. Its only
runtime imports are `node:process` and the declared production dependency
`@supabase/supabase-js`. The old helper and its deployment exception were removed;
role checks, token verification and API routing are unchanged.

`tests/hosted-function-runtime.test.mjs` transpiles the actual entry point to an
isolated JavaScript artifact, omits source helpers, and imports it in a new Node
process with TypeScript stripping disabled. It resolves the installed Supabase
package and invokes the compiled default handler for missing/invalid tokens,
non-admins and admins with mocked upstream HTTP. The test reproduced the old
module-not-found failure and passes after the fix. This is a local emitted-entry
runtime check, not the Vercel builder or a deployed function test. A fresh Preview
must still confirm platform packaging and real Supabase connectivity.