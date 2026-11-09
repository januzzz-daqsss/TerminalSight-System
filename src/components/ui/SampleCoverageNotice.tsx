import { DEMO_MODE, DEMO_DESCRIPTION } from '../../demo';
export function SampleCoverageNotice({ dark = false }: { dark?: boolean }) {
    if (DEMO_MODE) return <aside aria-label="Hosted demonstration" className={`rounded-lg border px-4 py-3 text-sm ${dark ? "border-amber-500/40 bg-slate-900 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900"}`}><strong>Hosted demonstration.</strong> {DEMO_DESCRIPTION}</aside>;
    return <aside aria-label="Demonstration coverage" className={`rounded-lg border px-4 py-3 text-sm ${dark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-white text-slate-600'}`}>
        <strong className={dark ? 'text-white' : 'text-slate-800'}>Sample-video demonstration.</strong>{' '}
        Camera coverage: Bay 1 and Bay 6 only. Other bays are not monitored.
    </aside>;
}
