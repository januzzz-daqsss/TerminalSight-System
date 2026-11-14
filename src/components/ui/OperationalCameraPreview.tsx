import { useEffect, useState } from 'react';
import { operationalClient, type OperationalFeed } from '../../cameras/operationalCamera';
import { MediaViewport } from './MediaViewport';

/** Viewing/unmounting never starts or stops an operational camera. */
export function OperationalCameraPreview({ feed, onChanged }: { feed: OperationalFeed; onChanged?: () => void }) {
    const [image, setImage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const running = ['Starting', 'Live', 'Unstable'].includes(feed.state);
    useEffect(() => {
        const controller = new AbortController();
        let url = '', timer: ReturnType<typeof setTimeout> | undefined;
        const clear = () => { if (url) URL.revokeObjectURL(url); url = ''; setImage(''); };
        setError(''); clear();
        const connect = async () => {
            try {
                await operationalClient().stream(feed.id, controller.signal, jpeg => {
                    if (controller.signal.aborted) return;
                    const next = URL.createObjectURL(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
                    if (url) URL.revokeObjectURL(url);
                    url = next; setImage(next); setError('');
                });
                if (!controller.signal.aborted) { clear(); setError('Stream ended; reconnecting.'); }
            } catch {
                if (!controller.signal.aborted) { clear(); setError('Stream unavailable; check local connection or sign in again.'); }
            }
            if (!controller.signal.aborted) timer = setTimeout(() => { void connect(); }, 5000);
        };
        if (running) void connect();
        return () => { controller.abort(); clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
    }, [feed.id, feed.instance, running]);
    const control = async (action: 'stop' | 'restart') => {
        setBusy(true);
        try { await operationalClient().control(feed.id, action); onChanged?.(); }
        catch (e) { setError(e instanceof Error ? e.message : 'Camera control failed.'); }
        finally { setBusy(false); }
    };
    return <div className="space-y-2">
        <MediaViewport label={feed.name}>
            {image && running ? <img className="absolute inset-0 h-full w-full object-contain" src={image} alt={`${feed.name} operational CCTV`} />
                : <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-slate-300">{feed.state} · {feed.message || 'Waiting for camera frames'}</p>}
        </MediaViewport>
        <p role="status" className="text-xs text-slate-600">Operational · {feed.state} · {feed.inferenceFps} measured AI updates/s{!feed.healthy && ' · Bay data not current'}</p>
        {(error || feed.message) && <p role="alert" className="text-xs text-amber-800">{error || feed.message}</p>}
        <div className="flex gap-3 text-xs">
            {running && <button disabled={busy} className="text-red-700 underline disabled:opacity-50" onClick={() => { void control('stop'); }}>Stop camera</button>}
            <button disabled={busy} className="text-emerald-700 underline disabled:opacity-50" onClick={() => { void control('restart'); }}>Restart camera</button>
        </div>
    </div>;
}
