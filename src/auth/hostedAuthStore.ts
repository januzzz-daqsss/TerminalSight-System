import type { Session, SupabaseClient } from '@supabase/supabase-js';

export type HostedAuthState = {
    status: 'loading' | 'unauthenticated' | 'authenticated' | 'access-denied';
    session: Session | null;
    message: string | null;
};
type Auth = Pick<SupabaseClient['auth'], 'getSession' | 'onAuthStateChange' | 'refreshSession' | 'signOut'>;

// This state is UX only. Each protected hosted endpoint must verify its own token.
export function createHostedAuthStore(auth: Auth | null, request: typeof fetch = fetch) {
    let state: HostedAuthState = { status: auth ? 'loading' : 'unauthenticated', session: null, message: null };
    const listeners = new Set<() => void>();
    let revision = 0;
    let running = false;
    let signingOut = false;
    let pending: AbortController | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const publish = (next: HostedAuthState) => {
        state = next;
        listeners.forEach(listener => listener());
    };
    const invalidate = () => {
        revision++;
        pending?.abort();
        clearTimeout(expiry);
    };
    const signedOut = () => {
        invalidate();
        publish({ status: 'unauthenticated', session: null, message: null });
    };
    const acceptSession = async (session: Session | null) => {
        if (!running || signingOut) return;
        invalidate();
        const current = revision;
        if (!session || !session.expires_at || session.expires_at * 1000 <= Date.now()) {
            signedOut();
            return;
        }
        publish({ status: 'loading', session, message: null });
        expiry = setTimeout(signedOut, Math.min(session.expires_at * 1000 - Date.now(), 2147483647));
        const controller = new AbortController();
        pending = controller;
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await request('/api/auth/authorize', {
                headers: { Authorization: `Bearer ${session.access_token}` },
                credentials: 'omit', cache: 'no-store', signal: controller.signal,
            });
            if (!running || revision !== current) return;
            if (response.status === 401) { signedOut(); return; }
            if (!response.ok) throw new Error('Authorization denied');
            const result = await response.json();
            if (!running || revision !== current) return;
            if (result.authorized !== true || result.user?.id !== session.user.id) {
                throw new Error('Invalid authorization response');
            }
            publish({ status: 'authenticated', session, message: null });
        } catch {
            if (running && revision === current) publish({
                status: 'access-denied', session, message: 'Hosted administrator access could not be verified.',
            });
        } finally { clearTimeout(timeout); }
    };

    return {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        start() {
            if (!auth || running) return () => {};
            running = true;
            let receivedEvent = false;
            const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
                receivedEvent = true;
                // Do not await Supabase methods inside its synchronous auth callback.
                void acceptSession(session);
            });
            const initialRevision = revision;
            void auth.getSession().then(({ data, error }) => {
                if (running && !receivedEvent && revision === initialRevision) {
                    if (error) signedOut(); else void acceptSession(data.session);
                }
            }).catch(() => { if (running && !receivedEvent && revision === initialRevision) signedOut(); });
            return () => { running = false; invalidate(); subscription.unsubscribe(); };
        },
        async refreshSession() {
            if (!auth || !running || signingOut) return;
            invalidate();
            const current = revision;
            publish({ status: 'loading', session: null, message: null });
            try {
                const { data, error } = await auth.refreshSession();
                if (!running || revision !== current) return;
                if (error) signedOut(); else await acceptSession(data.session);
            } catch { if (running && revision === current) signedOut(); }
        },
        async logout() {
            signingOut = true;
            signedOut();
            let completed = false;
            try {
                const result = await auth?.signOut({ scope: 'local' });
                if (result?.error) throw new Error('Hosted sign-out could not be completed.');
                completed = true;
            } catch {
                throw new Error('Hosted sign-out could not be completed. Reload before signing in again.');
            } finally {
                // Ignore any authorization response that raced with sign-out.
                signedOut();
                // If remote sign-out failed, do not let SDK refresh events silently restore access.
                signingOut = !completed;
            }
        },
    };
}
