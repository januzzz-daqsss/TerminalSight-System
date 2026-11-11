import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { MonitorSmartphone, ArrowRight } from 'lucide-react';
import { getHostedSupabaseClient } from './supabaseClient';
import { useHostedAuth } from './HostedAuthProvider';
import { acceptCallback, requestRecovery, setPassword, signIn, signOutToLogin, initialHostedView, LINK_ERROR } from './hostedFlows';

export function HostedAccess({ children }: { children: (logout: () => void) => ReactNode }) {
    const identity = useHostedAuth();
    const client = getHostedSupabaseClient();
    const [view, setView] = useState<'login' | 'forgot' | 'callback' | 'password'>(
        () => initialHostedView(window.location.href));
    const [email, setEmail] = useState('');
    const [password, setValue] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [visible, setVisible] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [logoutFailed, setLogoutFailed] = useState(false);
    const callback = useRef<Promise<void> | null>(null);
    useEffect(() => {
        if (view !== 'callback') return;
        if (!callback.current) {
            const href = window.location.href;
            const scrub = () => window.history.replaceState(null, '', '/auth/callback');
            if (!client) { scrub(); callback.current = Promise.reject(new Error(LINK_ERROR)); }
            else callback.current = acceptCallback(client.auth, href, scrub);
        }
        let active = true;
        void callback.current.then(() => { if (active) setView('password'); }, () => {
            if (active) { setError(LINK_ERROR); setView('forgot'); }
        });
        return () => { active = false; };
    }, [client, view]);

    const logout = async () => {
        setBusy(true); setError('');
        try { await signOutToLogin(identity.logout, path => window.location.replace(path)); }
        catch { setLogoutFailed(true); setError('Sign-out could not be completed. Reload this page before signing in again.'); }
        finally { setBusy(false); }
    };
    // Callback password setup must finish even if the SDK has already emitted SIGNED_IN.
    if (view === 'login' && identity.status === 'authenticated' && !busy && !logoutFailed) return children(() => { void logout(); });
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!client || busy || logoutFailed) return;
        setBusy(true); setError(''); setMessage('');
        try {
            if (view === 'forgot') setMessage(await requestRecovery(client.auth, email, window.location.origin));
            else if (view === 'password') {
                await setPassword(client.auth, password, confirmation);
                setValue(''); setConfirmation('');
                await identity.refreshSession();
                window.history.replaceState(null, '', '/admin');
                setView('login'); setMessage('Password saved. Administrator access is being verified.');
            } else { await signIn(client.auth, email, password); setValue(''); }
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to complete this request.'); }
        finally { setBusy(false); }
    };
    const checking = identity.status === 'loading' && view === 'login';
    const denied = identity.status === 'access-denied' && view === 'login';
    const inputStyle = 'mt-1 w-full rounded-lg border border-slate-300 p-3 focus-visible:outline-2 focus-visible:outline-emerald-600';
    return <main className="min-h-screen bg-gradient-to-br from-emerald-900 via-emerald-800 to-slate-900 flex items-center justify-center p-4">
        <section aria-labelledby="hosted-title" className="w-full max-w-md rounded-3xl bg-white p-7 sm:p-10 shadow-xl space-y-5">
            <MonitorSmartphone aria-hidden="true" className="mx-auto text-emerald-600" size={44} />
            <h1 id="hosted-title" className="text-center text-2xl font-bold text-slate-800">TerminalSight</h1>
            <h2 className="text-center font-semibold text-emerald-700">{view === 'password' ? 'Set your password' : view === 'forgot' ? 'Reset your password' : 'Hosted administrator sign-in'}</h2>
            <p className="text-sm text-slate-600">Hosted access uses sample data. Live cameras and terminal controls are available only on the local system.</p>
            {view === 'password' && <p role="note" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Save your password before refreshing or closing this page. Your session is kept only in this tab's memory; if interrupted, you may need to request a new recovery link. If an invitation cannot be used, contact your administrator for a new invitation.</p>}
            {!client && <p role="status">Hosted sign-in is not configured yet. Explore Demo remains available.</p>}
            {(checking || view === 'callback') && <p role="status">Verifying access…</p>}
            {denied && <p role="alert">Administrator access could not be verified. Contact your administrator or try again.</p>}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {message && <p role="status" className="text-sm text-emerald-800">{message}</p>}
            {!checking && !denied && view !== 'callback' && !logoutFailed && <form onSubmit={submit} aria-busy={busy} className="space-y-4">
                <fieldset disabled={busy || !client} className="space-y-4">
                    {view !== 'password' && <label className="block">Email<input className={inputStyle} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>}
                    {view !== 'forgot' && <>
                        <label className="block">{view === 'password' ? 'New password' : 'Password'}<input className={inputStyle} type={visible ? 'text' : 'password'} autoComplete={view === 'password' ? 'new-password' : 'current-password'} required minLength={view === 'password' ? 12 : undefined} value={password} onChange={e => setValue(e.target.value)} /></label>
                        <button type="button" aria-pressed={visible} onClick={() => setVisible(!visible)} className="text-sm text-emerald-700 underline">{visible ? 'Hide password' : 'Show password'}</button>
                    </>}
                    {view === 'password' && <label className="block">Confirm password<input className={inputStyle} type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
                    <button className="w-full rounded-lg bg-emerald-600 p-3 font-semibold text-white disabled:opacity-60" type="submit">{busy ? 'Please wait…' : view === 'forgot' ? 'Send reset link' : view === 'password' ? 'Save password' : 'Sign in'}</button>
                </fieldset>
            </form>}
            {view === 'login' && !checking && !denied && <button disabled={busy || logoutFailed || !client} className="text-sm text-emerald-700 underline" onClick={() => { setView('forgot'); setError(''); setValue(''); }}>Forgot password?</button>}
            {view === 'forgot' && <button disabled={busy} className="text-sm underline" onClick={() => { setView('login'); setError(''); setMessage(''); }}>Back to sign-in</button>}
            {view === 'password' && !busy && <a href="/admin?recovery=restart" className="block text-sm text-emerald-700 underline">Request a new recovery link</a>}
            {denied && <button disabled={busy} onClick={() => { void logout(); }} className="underline">Sign out</button>}
            <div className="border-t border-slate-200 pt-5 space-y-3">
                <a href="/demo" aria-describedby="demo-description" className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                    Explore Demo Mode <ArrowRight size={18} aria-hidden="true" />
                </a>
                <p id="demo-description" className="text-center text-xs leading-relaxed text-slate-500">No sign-in required. Read-only sample data with no live terminal operations.</p>
            </div>
        </section>
    </main>;
}
