import type { SupabaseClient } from '@supabase/supabase-js';
type Auth = SupabaseClient['auth'];
export const SIGN_IN_ERROR = 'Unable to sign in. Check your details and try again.';
export const LINK_ERROR = 'This link is invalid or expired. Request a new link or contact your administrator.';

export function initialHostedView(href: string): 'login' | 'forgot' | 'callback' {
    const url = new URL(href);
    if (url.pathname === '/auth/callback') return 'callback';
    return url.searchParams.get('recovery') === 'restart' ? 'forgot' : 'login';
}

export async function signIn(auth: Auth, email: string, password: string) {
    try {
        const { error } = await auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
    } catch { throw new Error(SIGN_IN_ERROR); }
}

export async function requestRecovery(auth: Auth, email: string, origin: string) {
    // Always the same result to the visitor, regardless of account existence or email errors.
    try { await auth.resetPasswordForEmail(email.trim(), { redirectTo: `${origin}/auth/callback` }); }
    catch { /* Do not reveal account existence or provider diagnostics. */ }
    return 'If this address is eligible, you will receive a password-reset email. Check your inbox or try again later.';
}

export async function acceptCallback(auth: Auth, href: string, scrub: () => void) {
    // Remove credentials and provider error details before any asynchronous operation.
    scrub();
    try {
        const url = new URL(href);
        const query = url.searchParams;
        const hash = new URLSearchParams(url.hash.slice(1));
        // No PKCE verifier is retained across navigation. Reject code callbacks explicitly.
        if (query.has('code')) throw new Error();
        if (query.has('error') || hash.has('error') || hash.has('error_code') || query.has('error_code')) throw new Error();
        let result;
        const type = query.get('type') || hash.get('type');
        if (query.has('token_hash') && (type === 'invite' || type === 'recovery')) {
            result = await auth.verifyOtp({ token_hash: query.get('token_hash')!, type });
        } else if (hash.get('access_token') && hash.get('refresh_token') && (type === 'invite' || type === 'recovery')) {
            result = await auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
        } else throw new Error();
        if (result.error || !result.data.session) throw new Error();
    } catch { throw new Error(LINK_ERROR); }
}

export async function setPassword(auth: Auth, password: string, confirmation: string) {
    if (password.length < 12 || password !== confirmation) throw new Error('Use at least 12 characters and matching passwords.');
    try {
        const { error } = await auth.updateUser({ password });
        if (error) throw error;
    } catch { throw new Error('Unable to save your password. Try a different password or request a new link.'); }
}
