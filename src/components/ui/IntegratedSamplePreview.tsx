import { useEffect, useRef, useState } from 'react';
import { createIntegratedClient, type PreviewState } from '../../cameras/integratedPreview';
import { MediaViewport } from './MediaViewport';

export function IntegratedSamplePreview({ feedId, name, onStop }: { feedId: string; name: string; onStop: () => void }) {
    const [state, setState] = useState<PreviewState | null>(null);
    const [image, setImage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [seek, setSeek] = useState<number | null>(null);
    const active = useRef<{ client: ReturnType<typeof createIntegratedClient>; id: string; generation: number; changing: boolean; fail: (message: string) => void } | null>(null);
    useEffect(() => {
        let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, objectUrl = '';
        const controller = new AbortController();
        let client: ReturnType<typeof createIntegratedClient> | undefined, identifier = '';
        const clearImage = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; setImage(''); };
        const fail = (message: string) => {
            if (disposed) return;
            setError(message); clearImage(); controller.abort(); clearTimeout(timer);
            if (identifier) void client?.stop(identifier).catch(() => {});
        };
        const heartbeat = async () => {
            try {
                const next = await client!.status(identifier);
                if (disposed || controller.signal.aborted) return;
                const current = active.current;
                if (!current || current.id !== identifier) return;
                if (next.stopped) { fail('Preview stopped. Return to playback and select Monitor recording to retry.'); return; }
                if (next.generation >= current.generation && !current.changing) {
                    if (next.generation > current.generation) clearImage();
                    current.generation = next.generation; setState(next);
                }
                timer = setTimeout(() => { void heartbeat(); }, 1000);
            } catch { fail('Local preview connection or authorization expired. Sign in again if needed.'); }
        };
        setState(null); setError(''); setImage('');
        void (async () => {
            try {
                client = createIntegratedClient();
                const initial = await client.start(feedId);
                identifier = initial.id;
                if (disposed) { await client.stop(identifier).catch(() => {}); return; }
                active.current = { client, id: identifier, generation: initial.generation, changing: false, fail };
                setState(initial); void heartbeat();
                await client.stream(identifier, controller.signal, (jpeg, generation) => {
                    const current = active.current;
                    if (disposed || !current || current.id !== identifier || current.changing || generation < current.generation) return;
                    current.generation = generation;
                    const next = URL.createObjectURL(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
                    if (objectUrl) URL.revokeObjectURL(objectUrl);
                    objectUrl = next; setImage(next);
                });
                if (!controller.signal.aborted) fail('Preview stream ended. Return to playback to retry.');
            } catch (reason) { if (!controller.signal.aborted) fail(reason instanceof Error ? reason.message : 'Preview unavailable.'); }
        })();
        return () => {
            disposed = true; controller.abort(); clearTimeout(timer);
            if (active.current?.id === identifier) active.current = null;
            if (identifier) void client?.stop(identifier).catch(() => {});
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [feedId]);

    const control = async (data: object) => {
        const current = active.current;
        if (!current || busy || error) return;
        setBusy(true); current.changing = true; setImage('');
        try {
            const next = await current.client.control(current.id, data);
            if (active.current === current) {
                current.generation = Math.max(current.generation, next.generation);
                setState(next); setSeek(null);
            }
        } catch { if (active.current === current) current.fail('Playback control failed. Return to playback and retry.'); }
        finally { current.changing = false; setBusy(false); }
    };
    return <div className="space-y-2">
        <MediaViewport label={name}>
            {image && !error ? <img src={image} alt={`Integrated monitoring: ${name}`} className="absolute inset-0 h-full w-full object-contain" />
                : <p className="absolute inset-0 grid place-items-center text-sm text-slate-300">{error ? 'Preview unavailable' : 'Loading integrated preview…'}</p>}
        </MediaViewport>
        <p role="status" className="text-xs text-slate-600">{error || state?.status || 'AI loading'} · Diagnostic only
            {state && ` · ${state.seconds.toFixed(1)}s / ${state.duration.toFixed(1)}s · ${state.inferenceFps} measured AI updates/s · source ${state.sourceFps.toFixed(1)} FPS`}</p>
        {state && <fieldset disabled={busy || !!error || state.stopped} className="flex flex-wrap items-center gap-2 text-xs disabled:opacity-50">
            <button type="button" className="rounded border px-2 py-1" onClick={() => { void control({ action: state.paused ? 'play' : 'pause' }); }}>{state.paused ? 'Resume' : 'Pause'}</button>
            <button type="button" className="rounded border px-2 py-1" onClick={() => { void control({ action: 'restart' }); }}>Restart</button>
            <label className="flex items-center gap-1"><input type="checkbox" checked={state.loop} onChange={e => { void control({ action: 'loop', enabled: e.target.checked }); }} />Loop</label>
            <label className="flex items-center gap-1">Position<input aria-label="Preview position in seconds" type="range" min={0} max={state.duration} step={1 / state.sourceFps} value={seek ?? state.seconds} onChange={e => setSeek(Number(e.target.value))} /></label>
            <button type="button" disabled={seek === null} className="rounded border px-2 py-1 disabled:opacity-50" onClick={() => { void control({ action: 'seek', seconds: seek }); }}>Seek</button>
        </fieldset>}
        <div className="flex justify-between gap-2 text-xs"><p className="text-slate-500">IoA 0.20 · Occupancy expires after 2s; boxes after 0.35s of video movement. No OCR.</p>
            <button type="button" className="shrink-0 font-semibold text-emerald-700 underline" onClick={onStop}>Stop monitoring</button></div>
    </div>;
}
