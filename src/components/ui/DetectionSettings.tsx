import { useEffect, useRef, useState } from 'react';

type Choice = { id: string; label: string; available: boolean; amd_available?: boolean };
type Status = { model: string; device: string; ready: boolean; loading: boolean; error: string | null; models: Choice[]; devices: Choice[] };

export function DetectionSettings() {
    const dialog = useRef<HTMLDialogElement>(null);
    const [status, setStatus] = useState<Status | null>(null);
    const [model, setModel] = useState('yolov8');
    const [device, setDevice] = useState('cpu');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const request = async (save: boolean) => {
        setBusy(true); setError(''); setMessage('');
        try {
            const response = await fetch('/api/detection', {
                method: save ? 'POST' : 'GET', cache: 'no-store',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('terminalsight-export-token') || ''}` },
                ...(save ? { body: JSON.stringify({ model, device }) } : {}),
            });
            const body = await response.text();
            let data;
            try { data = JSON.parse(body); }
            catch { throw new Error('The backend returned no valid response. Check that the Python server is running, then reopen this dialog.'); }
            if (!response.ok && data.status && mounted.current) {
                setStatus(data.status); setModel(data.status.model); setDevice(data.status.device);
            }
            if (!response.ok) throw new Error(data.message || 'Detection settings unavailable.');
            if (!mounted.current) return;
            setStatus(data); setModel(data.model); setDevice(data.device);
            if (save) setMessage('Detection updated for both camera feeds.');
        } catch (e) {
            if (mounted.current) setError(e instanceof Error ? e.message : 'Cannot reach backend.');
        } finally { if (mounted.current) setBusy(false); }
    };
    return <>
        <button onClick={() => { dialog.current?.showModal(); void request(false); }}
            className="px-4 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-100">
            AI Detection
        </button>
        <dialog ref={dialog} aria-labelledby="detection-title" onCancel={event => { if (busy) event.preventDefault(); }}
            className="m-auto w-[min(92vw,480px)] rounded-xl border border-slate-200 bg-white p-6 text-slate-800 shadow-xl backdrop:bg-slate-950/60">
            <h2 id="detection-title" className="text-lg font-bold">Detection algorithm</h2>
            <p className="mt-2 text-sm text-slate-500">Applies to both camera feeds. Detection briefly pauses while switching. Video playback continues. If an AMD worker fails, detection recovers on CPU.</p>
            {status && <p className="mt-3 text-sm">Active: {status.models.find(item => item.id === status.model)?.label} · {status.device.toUpperCase()}{!status.ready ? ' (not initialized)' : ''}</p>}
            <label className="block mt-4 text-sm font-semibold">Algorithm
                <select value={model} onChange={e => { setModel(e.target.value); if (device === 'amd' && !status?.models.find(item => item.id === e.target.value)?.amd_available) setDevice('cpu'); }} disabled={busy || !status}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 bg-white disabled:opacity-60">
                    {status?.models.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{!item.available ? ' — weights missing' : ''}</option>)}
                </select>
            </label>
            <label className="block mt-4 text-sm font-semibold">Processing device
                <select value={device} onChange={e => setDevice(e.target.value)} disabled={busy || !status}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 bg-white disabled:opacity-60">
                    {status?.devices.map(item => <option key={item.id} value={item.id} disabled={!item.available || (item.id === 'amd' && !status.models.find(choice => choice.id === model)?.amd_available)}>{item.label}{!item.available && ['cuda', 'amd'].includes(item.id) ? ' — unavailable' : ''}{item.id === 'amd' && !status.models.find(choice => choice.id === model)?.amd_available ? ' — model export missing' : ''}</option>)}
                </select>
            </label>
            <p className="mt-2 text-xs text-slate-500">CPU works without a supported GPU. Faster R-CNN and SSD may process more slowly on CPU.</p>
            {(error || status?.error) && <p role="alert" className="mt-3 text-sm text-red-700">{error || status?.error}</p>}
            <p role="status" className="mt-3 text-sm text-emerald-700">{busy ? 'Loading… Please keep this window open.' : message}</p>
            <div className="mt-5 flex justify-end gap-3">
                <button disabled={busy} onClick={() => dialog.current?.close()} className="rounded-lg px-4 py-2 text-sm border border-slate-300 disabled:opacity-50">Close</button>
                <button disabled={busy || !status || status.loading} onClick={() => void request(true)} className="rounded-lg px-4 py-2 text-sm bg-emerald-600 text-white font-semibold disabled:opacity-50">Apply</button>
            </div>
        </dialog>
    </>;
}
