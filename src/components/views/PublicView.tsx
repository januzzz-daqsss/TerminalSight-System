import type { Bay } from '../../types';
import { Bus, Users, Clock } from 'lucide-react';
import { formatClock, formatDate } from '../../utils/helpers';
import { passengerStatus, publicStatusClasses, publicTimer, routeLabel } from '../../utils/publicDisplay';

export function PublicView({ bays, now, live }: { bays: Bay[]; now: Date; live: boolean }) {
    return <div className="flex min-h-screen flex-col bg-slate-950 font-sans text-white">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b-4 border-emerald-500 bg-slate-900 px-8 py-5 xl:px-12">
            <div className="flex items-center gap-5">
                <div className="rounded-2xl bg-emerald-600 p-4"><Bus size={32} /></div>
                <div><p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-400">TerminalSight / Public View</p><h1 className="text-2xl font-black xl:text-4xl">Panabo City Bus Terminal</h1><p className="mt-1 flex items-center gap-2 text-lg text-slate-300"><Users size={20} />Passenger Boarding Information</p></div>
            </div>
            <div className="text-right"><p className="font-mono text-3xl font-bold xl:text-4xl">{formatClock(now)}</p><p className="mt-1 text-sm text-slate-400 xl:text-lg">{formatDate(now)}</p></div>
        </header>
        {!live && <div role="status" className="bg-amber-400/15 px-8 py-3 text-center font-semibold text-amber-200">Live updates unavailable. Please confirm bay information with terminal staff.</div>}
        <main className="flex-1 overflow-x-auto px-6 py-4 xl:px-10">
            <table className="w-full min-w-[760px] border-separate border-spacing-y-2 text-left">
                <thead><tr className="text-sm uppercase tracking-widest text-slate-400 xl:text-lg">
                    <th className="px-5 pb-2">Bay</th><th className="px-5 pb-2">Route / Destination</th><th className="px-5 pb-2">Vehicle</th><th className="px-5 pb-2">Status</th><th className="px-5 pb-2 text-right">Time</th>
                </tr></thead>
                <tbody>{bays.map(bay => {
                    const status = passengerStatus(bay);
                    return <tr key={bay.id} className="h-[6.5vh] bg-slate-900">
                        <td className="rounded-l-xl border-l-4 border-emerald-600 px-5 py-3 text-2xl font-black xl:text-3xl">{String(bay.id).padStart(2, '0')}</td>
                        <td className={`px-5 py-3 text-[clamp(1.1rem,1.7vw,2.3rem)] font-bold ${bay.route ? 'text-white' : 'text-slate-400'}`}>
                            {routeLabel(bay)}
                            {bay.status !== 'Available' && bay.route && !!bay.routeDetails?.length &&
                                <span className="ml-3 inline-block text-[0.75em] font-semibold text-emerald-300">· {bay.routeDetails.join(' · ')}</span>}
                        </td>
                        <td className="px-5 py-3 text-lg text-slate-300 xl:text-2xl">{bay.status === 'Available' ? '\u2014' : bay.vehicleType || 'Vehicle'}</td>
                        <td className="px-5 py-3"><span className={`inline-block rounded-lg border px-3 py-2 text-base font-bold tracking-wide xl:text-xl ${publicStatusClasses[status]}`}>{status}</span></td>
                        <td className="rounded-r-xl px-5 py-3 text-right font-mono text-2xl font-bold tabular-nums xl:text-3xl">{publicTimer(bay)}</td>
                    </tr>;
                })}</tbody>
            </table>
        </main>
        <footer className="flex items-center justify-between gap-4 border-t border-slate-800 bg-slate-900 px-8 py-4 text-sm text-slate-300 xl:text-lg"><span className="flex items-center gap-2"><Clock size={20} className="text-emerald-400" />Please be ready at your bay before the loading timer ends.</span><span className="font-semibold text-emerald-400">Travel safely.</span></footer>
    </div>;
}
