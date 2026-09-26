import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, MapPin, Bell, Check } from 'lucide-react';
import type { Notice } from '../../notifications/model';

export function Header({ clock, date, notices, markRead, markAllRead, inspect }: {
    clock: string; date: string; notices: Notice[];
    markRead: (id: string) => void; markAllRead: () => void; inspect: (notice: Notice) => void;
}) {
    const [open, setOpen] = useState(false);
    const panel = useRef<HTMLDivElement>(null);
    const bell = useRef<HTMLButtonElement>(null);
    const unread = notices.filter(item => !item.read).length;
    useEffect(() => {
        if (!open) return;
        const outside = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); bell.current?.focus(); } };
        document.addEventListener('mousedown', outside); document.addEventListener('keydown', key);
        return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key); };
    }, [open]);
    return <header className="relative z-50 flex h-16 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-6 shadow-sm">
        <div className="flex-1"><h1 className="text-base font-bold leading-tight text-slate-800">Terminal Overview</h1><p className="flex items-center gap-1 text-[11px] text-slate-400"><MapPin size={10} />Panabo City Bus Terminal</p></div>
        <div className="hidden flex-col items-end md:flex"><span className="font-mono text-sm font-bold text-slate-800">{clock}</span><span className="text-[11px] text-slate-400">{date}</span></div>
        <div ref={panel} className="relative">
            <button ref={bell} aria-label={`Notifications, ${unread} unread`} aria-expanded={open} aria-controls="notification-list" onClick={() => setOpen(!open)} className="relative rounded-xl p-2 text-slate-600 hover:bg-slate-100">
                <Bell size={20} />{unread > 0 && <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
            </button>
            {open && <section id="notification-list" aria-label="System notifications" className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3"><h2 className="text-sm font-bold text-slate-800">System Alerts</h2><button onClick={markAllRead} className="text-xs font-semibold text-emerald-700">Mark all as read</button></div>
                <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                    {!notices.length && <p className="p-6 text-center text-sm text-slate-500">No notifications yet.</p>}
                    {notices.map(notice => <div key={notice.id} className={`flex items-start gap-2 p-3 ${notice.read ? 'bg-white' : 'border-l-4 border-emerald-500 bg-emerald-50/50'}`}>
                        <AlertTriangle size={16} className={`mt-1 shrink-0 ${notice.priority === 'high' ? 'text-amber-600' : 'text-slate-400'}`} />
                        <button onClick={() => { inspect(notice); setOpen(false); }} className="flex-1 text-left">
                            <p className="text-xs font-bold text-slate-800">{notice.title}{!notice.read && <span className="ml-2 text-emerald-700">New</span>}</p>
                            <p className="mt-1 text-xs text-slate-600">{notice.message}</p>
                            <time className="mt-1 block text-[10px] text-slate-400">{new Date(notice.createdAt).toLocaleString()}</time>
                        </button>
                        {!notice.read && <button aria-label={`Mark ${notice.title} as read`} onClick={() => markRead(notice.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-100"><Check size={14} /></button>}
                    </div>)}
                </div>
            </section>}
        </div>
    </header>;
}
