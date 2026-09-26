import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { Notice, SystemStatus } from './model';

const BANNER_MS = 7000;
export function NotificationBanner({ notice, dismiss, inspect }: { notice: Notice; dismiss: (id: string) => void; inspect: (notice: Notice) => void }) {
    const [remaining, setRemaining] = useState(1);
    useEffect(() => {
        const deadline = performance.now() + BANNER_MS;
        let frame = 0;
        const tick = () => {
            const fraction = Math.max(0, (deadline - performance.now()) / BANNER_MS);
            setRemaining(fraction);
            if (fraction > 0) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        const timeout = setTimeout(() => dismiss(notice.id), BANNER_MS);
        return () => { cancelAnimationFrame(frame); clearTimeout(timeout); };
    }, [notice.id, dismiss]);
    return <section role="alert" className="pointer-events-auto relative w-full max-w-lg overflow-hidden rounded-xl border border-amber-300 bg-white shadow-xl">
        <div className="flex items-start gap-3 p-4">
            <AlertTriangle size={20} className="mt-1 shrink-0 text-amber-600" />
            <button onClick={() => { inspect(notice); dismiss(notice.id); }} className="flex-1 text-left focus-visible:outline-2 focus-visible:outline-emerald-600">
                <p className="text-sm font-bold text-slate-900">{notice.title}</p>
                <p className="mt-1 text-xs text-slate-600">{notice.message}</p>
                <span className="mt-1 block text-xs text-emerald-700">View details</span>
            </button>
            <button aria-label="Dismiss notification" onClick={() => dismiss(notice.id)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={16} /></button>
        </div>
        <div className="h-1 bg-amber-100" aria-hidden="true"><div className="h-full origin-left bg-amber-500" style={{ transform: `scaleX(${remaining})` }} /></div>
    </section>;
}

export function SystemDetails({ system, close, testNotification }: { system: SystemStatus; close: () => void; testNotification: (scenario: 'overstay' | 'camera' | 'cloud' | 'info' | 'resolve') => void }) {
    const closeRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        closeRef.current?.focus();
        const keyboard = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close();
            if (event.key === 'Tab') {
                const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>('button');
                if (!buttons?.length) return;
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        };
        const outside = (event: MouseEvent) => { if (!panelRef.current?.contains(event.target as Node)) close(); };
        document.addEventListener('keydown', keyboard);
        document.addEventListener('mousedown', outside);
        return () => { document.removeEventListener('keydown', keyboard); document.removeEventListener('mousedown', outside); previous?.focus(); };
    }, [close]);
    const cloud = system.cloud;
    return <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/30 p-6 pt-24">
        <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="system-details-title" className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between"><h2 id="system-details-title" className="font-bold text-slate-900">Local System & Cloud Sync</h2><button ref={closeRef} onClick={close} aria-label="Close system status" className="rounded p-1 hover:bg-slate-100"><X size={18} /></button></div>
            <dl className="space-y-3 text-sm">
                {[
                    ['Local System', system.local],
                    ['Camera processing', system.cameras.length ? `${system.cameras.filter(camera => camera.state === 'Live').length} live / ${system.cameras.length} configured` : 'Not available'],
                    ['Route Recognition', system.ocr?.state || 'Not available'],
                    ['Cloud Connection', system.local === 'Online' ? cloud.connection : 'Unknown (local backend unavailable)'],
                    ['Synchronization', system.local === 'Online' ? cloud.state : 'Unknown'],
                    ['Last successful sync', cloud.last_successful_sync ? new Date(cloud.last_successful_sync).toLocaleString() : 'Never'],
                    ['Pending record count', cloud.pending_records === null ? 'Not available' : String(cloud.pending_records)],
                    ['Last sync result', cloud.last_result],
                ].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="shrink-0 text-slate-500">{label}</dt><dd className="text-right text-slate-800">{value}</dd></div>)}
            </dl>
            {import.meta.env.DEV && <section className="mt-4 border-t border-slate-200 pt-4">
                <h3 className="text-sm font-bold text-slate-800">Test notifications</h3>
                <p className="mt-1 text-xs text-slate-500">Test alerts only. Cameras, bay states, and cloud status stay unchanged. Repeating an active test does not reopen its banner. Resolve tests to try a new incident.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {([
                        ['overstay', 'Test overstay'], ['camera', 'Test camera alert'],
                        ['cloud', 'Test cloud alert'], ['info', 'Test quiet info'],
                        ['resolve', 'Resolve test issues'],
                    ] as const).map(([scenario, label]) => <button key={scenario} onClick={() => { testNotification(scenario); close(); }} className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">{label}</button>)}
                </div>
                <p className="mt-2 text-xs text-slate-500">Warning sound has a 10-second cooldown. Test controls are available only in development.</p>
            </section>}
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{system.local !== 'Online' ? 'Local backend status is unavailable. Last known cloud details may be stale.' : !cloud.configured ? 'Cloud synchronization is not configured. TerminalSight operates locally; no remote uploads are being performed.' : cloud.connection === 'Offline' ? 'Terminal monitoring continues locally. Pending data will synchronize when connectivity is restored.' : 'Local terminal operation does not depend on cloud synchronization.'}</p>
        </div>
    </div>;
}
