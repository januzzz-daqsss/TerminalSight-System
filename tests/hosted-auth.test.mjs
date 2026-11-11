import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeHostedAdmin } from '../api/auth/authorize.ts';
import { createHostedAuthStore } from '../src/auth/hostedAuthStore.ts';
import endpoint from '../api/auth/authorize.ts';
import { signOutToLogin } from '../src/auth/hostedFlows.ts';

const configuration = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test_only' };
const request = (token = 'test-token') => new Request('https://example.test/api/auth/authorize', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const user = (role = 'admin') => ({ id: 'user-1', app_metadata: { role }, user_metadata: {} });
const upstream = (body, status = 200) => async () => Response.json(body, { status });

test('missing, malformed, duplicated and query-string tokens are rejected without contacting Supabase', async () => {
    let calls = 0;
    const never = async () => { calls++; throw Error('unexpected network'); };
    for (const req of [request(null), request('one,two'), new Request('https://example.test/api/auth/authorize?token=test-token&role=admin'),
        new Request('https://example.test/api/auth/authorize', { headers: { Authorization: 'Basic test' } })]) {
        assert.equal((await authorizeHostedAdmin(req, configuration, never)).status, 401);
    }
    assert.equal(calls, 0);
});

test('expired and invalid tokens rejected by Supabase never authorize an administrator', async () => {
    for (const code of ['jwt_expired', 'bad_jwt']) {
        const response = await authorizeHostedAdmin(request(), configuration, upstream({ code, msg: 'Token rejected' }, 401));
        assert.equal(response.status, 401);
        assert.equal((await response.json()).authorized, false);
        assert.equal(response.headers.get('cache-control'), 'no-store');
    }
});

test('only trusted app_metadata.role exactly equal to admin is accepted', async () => {
    for (const role of [undefined, 'viewer', 'authenticated', 'Admin', ['admin']]) {
        const identity = { ...user(role), app_metadata: { role }, user_metadata: { role: 'admin' } };
        const req = new Request('https://example.test/api/auth/authorize?role=admin', {
            headers: { Authorization: 'Bearer test-token', 'X-Role': 'admin' },
        });
        assert.equal((await authorizeHostedAdmin(req, configuration, upstream(identity))).status, 403);
    }
});

test('valid administrator token is verified against Supabase Auth and returns only its identifier', async () => {
    const response = await authorizeHostedAdmin(request('admin-token'), configuration, async (url, init) => {
        assert.equal(String(url), 'https://example.supabase.co/auth/v1/user');
        const headers = new Headers(init.headers);
        assert.equal(headers.get('authorization'), 'Bearer admin-token');
        assert.equal(headers.get('apikey'), configuration.publishableKey);
        return Response.json({ ...user(), email: 'private@example.test', user_metadata: { private: true } });
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authorized: true, user: { id: 'user-1' } });
    assert.equal(response.headers.get('vary'), 'Authorization');
});

test('configuration, upstream failures and malformed responses fail closed', async () => {
    for (const config of [{}, { ...configuration, publishableKey: 'sb_secret_do_not_use' }, { ...configuration, url: 'http://localhost' }]) {
        assert.equal((await authorizeHostedAdmin(request(), config)).status, 503);
    }
    assert.equal((await authorizeHostedAdmin(request(), configuration, upstream({}))).status, 401);
    assert.equal((await authorizeHostedAdmin(request(), configuration, upstream({ message: 'unavailable' }, 500))).status, 503);
    assert.equal((await authorizeHostedAdmin(new Request('https://example.test', { method: 'POST' }), configuration)).status, 405);
    // Exercise the actual exported Vercel handler without secrets or network access.
    assert.equal((await endpoint.fetch(request(null))).status, 401);
});

const settle = () => new Promise(resolve => setImmediate(resolve));
const session = (token = 'test-token') => ({ access_token: token, expires_at: Math.floor(Date.now() / 1000) + 3600, user: user() });
function mockAuth(initial = session()) {
    let callback;
    let unsubscribed = false;
    return {
        getSession: async () => ({ data: { session: initial }, error: null }),
        onAuthStateChange(cb) { callback = cb; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; },
        refreshSession: async () => ({ data: { session: session('refreshed-token') }, error: null }),
        signOut: async options => { assert.equal(options.scope, 'local'); callback?.('SIGNED_OUT', null); return { error: null }; },
        emit: (event, value) => callback(event, value),
        isUnsubscribed: () => unsubscribed,
    };
}
const allowed = async () => Response.json({ authorized: true, user: { id: 'user-1' } });

test('unconfigured store is unauthenticated and does not fetch', async () => {
    const store = createHostedAuthStore(null, () => { throw Error('unexpected fetch'); });
    const stop = store.start();
    assert.equal(store.getSnapshot().status, 'unauthenticated');
    await store.refreshSession();
    await store.logout();
    stop();
});

test('initialization, token refresh and logout use only hosted authorization', async t => {
    const auth = mockAuth();
    const tokens = [];
    const store = createHostedAuthStore(auth, async (path, options) => {
        assert.equal(path, '/api/auth/authorize');
        assert.equal(options.credentials, 'omit');
        tokens.push(options.headers.Authorization);
        return allowed();
    });
    assert.equal(store.getSnapshot().status, 'loading');
    t.after(store.start());
    await settle();
    assert.equal(store.getSnapshot().status, 'authenticated');
    await store.refreshSession();
    assert.equal(store.getSnapshot().status, 'authenticated');
    assert.deepEqual(tokens, ['Bearer test-token', 'Bearer refreshed-token']);
    await store.logout();
    assert.equal(store.getSnapshot().status, 'unauthenticated');
    assert.equal(store.getSnapshot().session, null);
});

test('non-admin, missing backend, invalid JSON and identity mismatch deny access', async t => {
    for (const result of [() => Response.json({}, { status: 403 }), () => Response.json({}, { status: 503 }),
        () => new Response('<html>SPA</html>'), () => Response.json({ authorized: true, user: { id: 'other' } })]) {
        const store = createHostedAuthStore(mockAuth(), async () => result());
        t.after(store.start());
        await settle();
        assert.equal(store.getSnapshot().status, 'access-denied');
    }
});

test('expired sessions and server 401 responses become unauthenticated', async t => {
    const expired = createHostedAuthStore(mockAuth({ ...session(), expires_at: 1 }), () => { throw Error('must not fetch'); });
    t.after(expired.start());
    const invalid = createHostedAuthStore(mockAuth(), async () => Response.json({}, { status: 401 }));
    t.after(invalid.start());
    await settle();
    assert.equal(expired.getSnapshot().status, 'unauthenticated');
    assert.equal(invalid.getSnapshot().status, 'unauthenticated');
});

test('late authorization cannot restore access after logout', async t => {
    let complete;
    const store = createHostedAuthStore(mockAuth(), () => new Promise(resolve => { complete = resolve; }));
    t.after(store.start());
    await settle();
    await store.logout();
    complete(await allowed());
    await settle();
    assert.equal(store.getSnapshot().status, 'unauthenticated');
});

test('auth changes are reverified; cleanup unsubscribes and ignores late responses', async () => {
    const auth = mockAuth(null);
    const store = createHostedAuthStore(auth, allowed);
    const stop = store.start();
    await settle();
    auth.emit('SIGNED_IN', session());
    await settle();
    assert.equal(store.getSnapshot().status, 'authenticated');
    auth.emit('TOKEN_REFRESHED', session('another-token'));
    assert.equal(store.getSnapshot().status, 'loading');
    await settle();
    auth.emit('SIGNED_OUT', null);
    assert.equal(store.getSnapshot().status, 'unauthenticated');
    stop();
    assert.ok(auth.isUnsubscribed());
    auth.emit('SIGNED_IN', session());
    await settle();
    assert.equal(store.getSnapshot().status, 'unauthenticated');
});


test('failed sign-out remains locked out even if the SDK emits a refreshed session', async t => {
    const auth = mockAuth();
    auth.signOut = async () => ({ error: new Error('offline') });
    const store = createHostedAuthStore(auth, allowed);
    t.after(store.start());
    await settle();
    await assert.rejects(store.logout(), /Reload/);
    auth.emit('TOKEN_REFRESHED', session());
    await settle();
    assert.equal(store.getSnapshot().status, 'unauthenticated');
});

test('logout clears administrator access before replacing the route with root login', async t => {
    const auth = mockAuth();
    const store = createHostedAuthStore(auth, allowed);
    t.after(store.start());
    await settle();
    assert.equal(store.getSnapshot().status, 'authenticated');
    const destinations = [];
    await signOutToLogin(store.logout, path => {
        assert.equal(store.getSnapshot().status, 'unauthenticated');
        assert.equal(store.getSnapshot().session, null);
        destinations.push(path);
    });
    assert.deepEqual(destinations, ['/']);
});

test('failed logout cannot navigate away or restore administrator access', async t => {
    const auth = mockAuth();
    auth.signOut = async () => ({ error: new Error('offline') });
    const store = createHostedAuthStore(auth, allowed);
    t.after(store.start());
    await settle();
    await assert.rejects(signOutToLogin(store.logout, () => assert.fail('Must not navigate after failed logout')));
    auth.emit('TOKEN_REFRESHED', session());
    await settle();
    assert.equal(store.getSnapshot().status, 'unauthenticated');
});
