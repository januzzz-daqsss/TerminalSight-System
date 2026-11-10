import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { HOSTED_AUTH_OPTIONS } from '../src/auth/supabaseClient.ts';
import { acceptCallback, initialHostedView, requestRecovery, setPassword, LINK_ERROR } from '../src/auth/hostedFlows.ts';
import { createHostedAuthStore } from '../src/auth/hostedAuthStore.ts';
import { authorizeHostedAdmin } from '../server/hostedAuthorization.ts';

// Actual SDK, isolated clients, synthetic identities, and intercepted HTTP only.
// No credentials, email delivery, browser storage, or external requests are used.
const configuration = { url: 'https://auth.example.test', publishableKey: 'sb_publishable_test_only' };
function fixture(t, role = 'admin') {
    const user = { id: 'test-user', aud: 'authenticated', app_metadata: { role }, user_metadata: {} };
    const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const access = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`;
    const session = { access_token: access, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user };
    const consumed = new Set();
    const requests = [];
    let beforeRequest = () => {};
    const transport = async (input, init) => {
        beforeRequest();
        const request = new Request(input, init);
        const url = new URL(request.url);
        assert.equal(url.origin, configuration.url, 'SDK must use only the mocked Auth origin');
        const body = request.method === 'GET' ? null : await request.json();
        requests.push({ url, method: request.method, body });
        if (url.pathname === '/auth/v1/verify') {
            if (body.token_hash === 'expired' || consumed.has(body.token_hash)) {
                return Response.json({ code: 'otp_expired', msg: 'Private provider diagnostic' }, { status: 403 });
            }
            assert.ok(['invite', 'recovery'].includes(body.type));
            consumed.add(body.token_hash);
            return Response.json(session);
        }
        if (url.pathname === '/auth/v1/user') {
            assert.equal(request.headers.get('authorization'), `Bearer ${access}`);
            if (request.method === 'PUT') assert.deepEqual(body, {
                password: 'new-test-password', code_challenge: null, code_challenge_method: null,
            });
            return Response.json(user);
        }
        if (url.pathname === '/auth/v1/recover') {
            assert.equal(url.searchParams.get('redirect_to'), 'https://preview.example.test/auth/callback');
            assert.equal(body.code_challenge, null, 'Recovery must not initiate PKCE');
            return Response.json({});
        }
        assert.fail(`Unexpected SDK request: ${url.pathname}`);
    };
    const freshClient = () => {
        const client = createClient(configuration.url, configuration.publishableKey, {
            auth: HOSTED_AUTH_OPTIONS, global: { fetch: transport },
        });
        t.after(() => client.auth.stopAutoRefresh());
        return client;
    };
    return { freshClient, transport, access, requests, beforeRequest: fn => { beforeRequest = fn; } };
}

// Models replaceState's current-entry replacement without adding another history entry.
function page(href) {
    const entries = ['https://preview.example.test/', href];
    return {
        entries,
        get href() { return entries.at(-1); },
        scrub() { entries[entries.length - 1] = 'https://preview.example.test/auth/callback'; },
    };
}

for (const type of ['invite', 'recovery']) {
    for (const format of ['token-hash', 'implicit']) {
        test(`fresh-client ${type} callback works with ${format} and cleans URL before HTTP`, async t => {
            const f = fixture(t);
            const client = f.freshClient();
            assert.equal((await client.auth.getSession()).data.session, null);
            const suffix = format === 'token-hash' ? `?token_hash=unused-${type}&type=${type}`
                : `#access_token=${f.access}&refresh_token=synthetic-refresh&type=${type}`;
            const browser = page(`https://preview.example.test/auth/callback${suffix}`);
            f.beforeRequest(() => assert.equal(browser.href, 'https://preview.example.test/auth/callback'));
            await acceptCallback(client.auth, browser.href, () => browser.scrub());
            assert.equal(browser.entries.length, 2);
            assert.ok(browser.entries.every(entry => !/token|code=/.test(entry)));
            assert.equal((await client.auth.getSession()).data.session.user.id, 'test-user');
            await setPassword(client.auth, 'new-test-password', 'new-test-password');
            assert.ok(f.requests.some(request => request.method === 'PUT'));
            // A separate tab/client does not inherit this session.
            assert.equal((await f.freshClient().auth.getSession()).data.session, null);
        });
    }
}

test('expired and already-consumed links create no session on fresh clients', async t => {
    const f = fixture(t);
    const used = 'https://preview.example.test/auth/callback?type=invite&token_hash=once';
    await acceptCallback(f.freshClient().auth, used, () => {});
    for (const href of [used, 'https://preview.example.test/auth/callback?type=recovery&token_hash=expired']) {
        const client = f.freshClient();
        const browser = page(href);
        await assert.rejects(acceptCallback(client.auth, browser.href, () => browser.scrub()), { message: LINK_ERROR });
        assert.equal(browser.href, 'https://preview.example.test/auth/callback');
        assert.equal((await client.auth.getSession()).data.session, null);
    }
});

test('reload during setup loses session and safely restarts recovery without PKCE', async t => {
    const f = fixture(t);
    const browser = page('https://preview.example.test/auth/callback?type=recovery&token_hash=first');
    await acceptCallback(f.freshClient().auth, browser.href, () => browser.scrub());
    const reloaded = f.freshClient();
    assert.equal(initialHostedView(browser.href), 'callback');
    await assert.rejects(acceptCallback(reloaded.auth, browser.href, () => browser.scrub()), { message: LINK_ERROR });
    await assert.rejects(setPassword(reloaded.auth, 'new-test-password', 'new-test-password'));
    assert.ok(!f.requests.some(request => request.method === 'PUT'));
    assert.equal(initialHostedView('https://preview.example.test/admin?recovery=restart'), 'forgot');
    const message = await requestRecovery(reloaded.auth, 'test@example.test', 'https://preview.example.test');
    assert.match(message, /If this address is eligible/);
    // A newly issued link can be consumed in yet another empty client.
    const restarted = f.freshClient();
    await acceptCallback(restarted.auth, 'https://preview.example.test/auth/callback?type=recovery&token_hash=second', () => {});
    await setPassword(restarted.auth, 'new-test-password', 'new-test-password');
});

test('unsupported codes and provider errors are cleaned without SDK HTTP', async t => {
    const f = fixture(t);
    for (const suffix of ['?code=unsupported', '#error=access_denied&error_description=private']) {
        const browser = page(`https://preview.example.test/auth/callback${suffix}`);
        await assert.rejects(acceptCallback(f.freshClient().auth, browser.href, () => browser.scrub()), { message: LINK_ERROR });
        assert.equal(browser.href, 'https://preview.example.test/auth/callback');
    }
    assert.equal(f.requests.length, 0);
});

test('successful non-admin email callback still fails the actual server authorization gate', async t => {
    const f = fixture(t, 'viewer');
    const client = f.freshClient();
    await acceptCallback(client.auth, 'https://preview.example.test/auth/callback?type=invite&token_hash=viewer', () => {});
    let completed;
    const result = new Promise(resolve => { completed = resolve; });
    const store = createHostedAuthStore(client.auth, async (path, init) => {
        assert.equal(path, '/api/auth/authorize');
        const response = await authorizeHostedAdmin(new Request(`https://preview.example.test${path}`, init), configuration, f.transport);
        assert.equal(response.status, 403);
        return response;
    });
    t.after(store.subscribe(() => { if (store.getSnapshot().status === 'access-denied') completed(); }));
    t.after(store.start());
    await result;
    assert.equal(store.getSnapshot().status, 'access-denied');
});
