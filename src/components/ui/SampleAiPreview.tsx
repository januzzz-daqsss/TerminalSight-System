import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEMO_MODE } from '../../demo';
import { createSampleAiClient, type AiFrame, type AiMapping } from '../../cameras/sampleAi';

export function SampleAiPreview({ videoId, mapping, allowed, children }: {
    videoId: string; mapping?: AiMapping; allowed: boolean; children: ReactNode;
}) {
    const [enabled, setEnabled] = useState(false);
    const [paused, setPaused] = useState(false);
    const [method, setMethod] = useState<'ioa' | 'ground'>('ioa');
    const [frame, setFrame] = useState<AiFrame | null>(null);
    const [error, setError] = useState('');
    const pauseRef = useRef(paused);
    pauseRef.current = paused;
    const eligible = allowed && !DEMO_MODE && !!mapping;
    useEffect(() => {
        if (!enabled || !eligible) return;
        const controller = new AbortController();
        let id: string | undefined;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let wake: (() => void) | undefined;
        let client: ReturnType<typeof createSampleAiClient>;
        try { client = createSampleAiClient(); }
        catch (e) { setError(e instanceof Error ? e.message : 'Sign in locally.'); setEnabled(false); return; }
        const stop = () => {
            if (id && !stopped) { stopped = true; void client.stop(id).catch(() => {}); }
        };
        setFrame(null); setError('');
        void (async () => {
            try {
                // Do not abort creation: if unmounted during start, immediately
                // delete the returned session. Lost responses also expire server-side.
                id = (await client.start(videoId, method)).id;
                if (controller.signal.aborted) return;
                while (!controller.signal.aborted) {
                    const result = await client.frame(id, !pauseRef.current, controller.signal);
                    if (controller.signal.aborted) break;
                    setFrame(result);
                    if (result.ended) setPaused(true);
                    await new Promise<void>(resolve => {
                        wake = resolve;
                        timer = setTimeout(resolve, pauseRef.current || result.ended ? 2000 : 100);
                    });
                }
            } catch (e) {
                if (!controller.signal.aborted) {
                    setError(e instanceof Error ? e.message : 'Sample AI failed.');
                    setEnabled(false);
                }
            } finally { stop(); }
        })();
        return () => { controller.abort(); clearTimeout(timer); wake?.(); stop(); };
    }, [enabled, eligible, method, videoId]);
    if (!eligible) return <>{children}</>;
    return <div className="space-y-3">
        <p className="text-xs text-emerald-800">Saved ROI: {mapping.bays.join(', ')} · {mapping.direction}. AI uses these bays, not the feed’s editable labels.</p>
        <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">Assignment method <select disabled={enabled} value={method} onChange={e => setMethod(e.target.value as 'ioa' | 'ground')}
                className="ml-2 rounded border border-slate-300 bg-white p-2 disabled:opacity-50"><option value="ioa">IoA diagnostic</option><option value="ground">Ground diagnostic</option></select></label>
            <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                onClick={() => { setPaused(false); setEnabled(!enabled); }}>{enabled ? 'Stop AI Preview' : 'Enable AI Preview'}</button>
            {enabled && <button type="button" disabled={!frame || frame.ended} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => setPaused(!paused)}>{paused ? 'Resume AI' : 'Pause AI'}</button>}
        </div>
        <p className="text-xs text-slate-500">Local CPU · one AI preview at a time · starts from frame 0. Instantaneous diagnostics only; Ground is not guaranteed more accurate. Stop before changing method. OCR is not enabled.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error} Ordinary playback remains available in the grid.</p>}
        {!enabled ? children : frame ? <>
            <img src={`data:image/jpeg;base64,${frame.image}`} alt={`Sample AI ${frame.method} frame ${frame.frame}`} className="w-full rounded-lg bg-slate-900 object-contain" />
            <p className="text-xs text-slate-600">{frame.method.toUpperCase()} · Frame {frame.frame} · {frame.seconds.toFixed(1)}s · {frame.processingFps} processing FPS {frame.ended ? '· End of recording — stop and enable again to restart.' : paused ? '· Paused' : ''}</p>
            <ul className="flex flex-wrap gap-2 text-xs">{Object.entries(frame.states).map(([bay, state]) => <li key={bay} className="rounded bg-slate-100 p-2">{bay}: {state} · max IoA {(frame.overlaps[bay] ?? 0).toFixed(2)}</li>)}</ul>
            {!!frame.diagnostics.length && <details className="text-xs text-slate-600"><summary>Assignment evidence / uncertainty</summary><ul>{frame.diagnostics.map((text, i) => <li key={i}>{text}</li>)}</ul></details>}
        </> : <p role="status" className="rounded-lg bg-slate-100 p-8">Loading local YOLO model and first frame…</p>}
    </div>;
}
