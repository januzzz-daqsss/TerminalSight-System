import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signIn, requestRecovery, acceptCallback, setPassword, SIGN_IN_ERROR, LINK_ERROR } from '../src/auth/hostedFlows.ts';
import { capabilities } from '../src/auth/capabilities.ts';

test('login sends only credentials and reports generic failures', async () => {
    const auth = { signInWithPassword: async value => {
        assert.deepEqual(value, { email: 'user@example.test', password: 'test-password' });
        return { error: null };
    } };
    await signIn(auth, ' user@example.test ', 'test-password');
    for (const failure of [async () => ({ error: { message: 'private detail' } }), async () => { throw Error('network detail'); }]) {
        await assert.rejects(signIn({ signInWithPassword: failure }, 'x', 'y'), { message: SIGN_IN_ERROR });
    }
});

test('forgot password always returns the same response and uses this site callback', async () => {
    const replies = [];
    for (const result of [{ error: null }, { error: { message: 'account does not exist' } }, null]) {
        replies.push(await requestRecovery({ resetPasswordForEmail: async (email, options) => {
            assert.equal(email, 'user@example.test');
            assert.equal(options.redirectTo, 'https://example.test/auth/callback');
            if (!result) throw Error('offline');
            return result;
        } }, 'user@example.test', 'https://example.test'));
    }
    assert.equal(new Set(replies).size, 1);
});

test('invitation and recovery token hashes are scrubbed before verification', async () => {
    for (const type of ['invite', 'recovery']) {
        let scrubbed = false;
        await acceptCallback({ verifyOtp: async payload => {
            assert.ok(scrubbed);
            assert.deepEqual(payload, { token_hash: 'test-hash', type });
            return { data: { session: {} }, error: null };
        } }, `https://example.test/auth/callback?token_hash=test-hash&type=${type}`, () => { scrubbed = true; });
    }
});

test('implicit invitation/recovery sessions are supported', async () => {
    for (const type of ['invite', 'recovery']) {
        await acceptCallback({ setSession: async payload => {
            assert.deepEqual(payload, { access_token: 'test-access', refresh_token: 'test-refresh' });
            return { data: { session: {} }, error: null };
        } }, `https://example.test/auth/callback#type=${type}&access_token=test-access&refresh_token=test-refresh`, () => {});
    }
});

test('PKCE callbacks are scrubbed and rejected without attempting an exchange', async () => {
    let scrubbed = false;
    await assert.rejects(acceptCallback({ exchangeCodeForSession: () => { assert.fail('PKCE must not be attempted'); } },
        'https://example.test/auth/callback?code=test-code', () => { scrubbed = true; }), { message: LINK_ERROR });
    assert.ok(scrubbed);
});

test('invalid, expired, missing and provider-error callbacks fail safely', async () => {
    for (const suffix of ['', '?error=private', '#error_code=otp_expired', '?type=signup&token_hash=x', '#type=invite&access_token=x', '?type=recovery&token_hash=expired', '?code=missing-verifier']) {
        let scrubbed = false;
        const reject = async () => ({ error: { message: 'sensitive details' }, data: { session: null } });
        await assert.rejects(acceptCallback({ verifyOtp: reject, exchangeCodeForSession: reject }, `https://example.test/auth/callback${suffix}`, () => { scrubbed = true; }), { message: LINK_ERROR });
        assert.ok(scrubbed);
    }
});

test('password setup validates confirmation and forwards only the password', async () => {
    let calls = 0;
    const auth = { updateUser: async payload => { calls++; assert.deepEqual(payload, { password: 'long-test-password' }); return { error: null }; } };
    await assert.rejects(setPassword(auth, 'short', 'short'));
    await assert.rejects(setPassword(auth, 'long-test-password', 'different'));
    assert.equal(calls, 0);
    await setPassword(auth, 'long-test-password', 'long-test-password');
    assert.equal(calls, 1);
});

test('deployment flags never grant admin access; only local admins can operate the terminal', () => {
    assert.equal(capabilities(null, true).canViewDashboard, false);
    for (const mode of ['demo-visitor', 'hosted-admin', 'local-admin', null]) {
        assert.equal(capabilities(mode, true).canOperateTerminal, false);
    }
    assert.equal(capabilities('demo-visitor', true).canViewDashboard, true);
    assert.equal(capabilities('local-admin', true).canViewDashboard, false);
    assert.equal(capabilities('hosted-admin', false).canViewDashboard, false);
    assert.equal(capabilities('local-admin', false).canOperateTerminal, true);
});
