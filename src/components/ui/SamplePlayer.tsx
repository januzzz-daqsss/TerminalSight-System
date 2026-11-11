import { useEffect, useRef, useState } from 'react';
import type { SampleVideo } from '../../cameras/feedApi';
import { DEMO_MODE } from '../../demo';
import { inspectPlayback, type PlaybackProblem } from '../../cameras/playback';
import { scaledRoi, type RoiOverlay } from '../../cameras/roiOverlay';
import { MediaViewport } from './MediaViewport';
import { PILOT_VIDEO, OVERLAY_COLORS, occupancyColor, useSynchronizedPreview, type MonitoringFrame } from '../../cameras/synchronizedPreview';

export function ParkingRoiOverlay({ roi, width, height, monitoring }: { roi?: RoiOverlay; width: number; height: number; monitoring?: MonitoringFrame | null }) {
    const polygons = scaledRoi(roi, width, height);
    if (!polygons.length) return null;
    return <svg aria-label="Saved parking bay regions" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full pointer-events-none">
        {polygons.map(bay => <g key={bay.id}>
            <polygon points={bay.points.map(point => point.join(',')).join(' ')} fill={occupancyColor(monitoring?.states[bay.id])} fillOpacity="0.08" stroke={occupancyColor(monitoring?.states[bay.id])} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <text x={bay.points.reduce((sum, p) => sum + p[0], 0) / 4} y={bay.points.reduce((sum, p) => sum + p[1], 0) / 4}
                textAnchor="middle" fill="white" stroke="#0f172a" strokeWidth="4" paintOrder="stroke" fontSize={width / 48} fontWeight="bold">{bay.id.replace('_', ' ')}{monitoring ? `: ${monitoring.states[bay.id] || 'UNCERTAIN'}` : ''}</text>
        </g>)}
        {monitoring?.detections.map((detection, index) => <g key={index}>
            <rect x={detection.bbox[0]} y={detection.bbox[1]} width={Math.max(0, detection.bbox[2] - detection.bbox[0])} height={Math.max(0, detection.bbox[3] - detection.bbox[1])}
                fill="none" stroke={OVERLAY_COLORS.box} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <text x={Math.max(0, detection.bbox[0])} y={Math.max(width / 48, detection.bbox[1] - 8)} fontSize={width / 48} fill="white" stroke="#0f172a" strokeWidth="4" paintOrder="stroke">
                {detection.vehicle_type} · {(detection.confidence * 100).toFixed(0)}%
            </text>
        </g>)}
    </svg>;
}

/** Native, independent playback. Never polls AI or ties its clock to inference. */
export function SamplePlayer({ video, autoPlay = false, loop = false, label, roi, canMonitor = false, monitoringEnabled = false, onMonitoringChange }: {
    video: SampleVideo; autoPlay?: boolean; loop?: boolean; label?: string; roi?: RoiOverlay;
    canMonitor?: boolean; monitoringEnabled?: boolean; onMonitoringChange?: (enabled: boolean) => void;
}) {
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [problem, setProblem] = useState<PlaybackProblem | null>(null);
    const [checking, setChecking] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const media = useRef<HTMLVideoElement>(null);
    const [method, setMethod] = useState<'ioa' | 'ground'>('ioa');
    const eligible = canMonitor && !DEMO_MODE && video.id === PILOT_VIDEO && !!roi;
    const monitoring = useSynchronizedPreview(media, video.id, eligible && monitoringEnabled && !problem, method);
    const currentResult = !problem && eligible && monitoringEnabled && monitoring.frame?.method === method && monitoring.frame?.videoId === video.id && monitoring.frame?.width === dimensions.width && monitoring.frame?.height === dimensions.height ? monitoring.frame : null;
    const check = useRef<AbortController | null>(null);
    const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => {
        setProblem(null); setChecking(false); setDimensions({ width: 0, height: 0 });
        const element = media.current;
        // Restore after React StrictMode's setup/cleanup replay as well as retry.
        if (element && !DEMO_MODE) element.src = video.url;
        return () => {
            check.current?.abort(); clearTimeout(timeout.current);
            check.current = null;
            // Explicitly release this element only; other cards continue playing.
            element?.pause(); element?.removeAttribute('src'); element?.load();
        };
    }, [video.url, attempt]);
    const failed = async () => {
        check.current?.abort(); clearTimeout(timeout.current);
        const controller = new AbortController();
        check.current = controller;
        const code = media.current?.error?.code ?? 4;
        setChecking(true);
        const timer = setTimeout(() => {
            controller.abort();
            if (check.current === controller) {
                setProblem({ kind: 'network', message: 'The video-server check timed out. Verify the frontend connection and retry.' });
                setChecking(false);
            }
        }, 5000);
        timeout.current = timer;
        const result = await inspectPlayback(video.url, code, controller.signal);
        clearTimeout(timer);
        if (check.current === controller && !controller.signal.aborted) { setProblem(result); setChecking(false); }
        else if (check.current === controller && controller.signal.aborted) setChecking(false);
    };
    if (DEMO_MODE) return <p className="text-sm text-slate-500">Local recordings are not available in hosted Demo Mode.</p>;
    return <div className="space-y-2">
        <MediaViewport label={label || video.filename}>
        <video key={`${video.url}:${attempt}`} ref={media} controls muted playsInline preload="metadata" autoPlay={autoPlay} loop={loop} src={video.url}
            controlsList="nofullscreen" onLoadedMetadata={event => setDimensions({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
            onError={() => { void failed(); }} onLoadedData={() => { check.current?.abort(); check.current = null; clearTimeout(timeout.current); setProblem(null); setChecking(false); }}
            className="absolute inset-0 w-full h-full object-contain" aria-label={label || `Preview ${video.filename}`} />
        <ParkingRoiOverlay roi={roi} {...dimensions} monitoring={currentResult} />
        </MediaViewport>
        {eligible && <div className="px-2 space-y-2">
            <div className="flex flex-wrap gap-2 items-center text-xs"><button type="button" className="rounded border border-emerald-300 px-2 py-1 text-emerald-800" onClick={() => onMonitoringChange?.(!monitoringEnabled)}>{monitoringEnabled ? 'Stop AI monitoring' : 'Enable AI monitoring'}</button>
                <label>Assignment <select aria-label="Monitoring assignment method" value={method} onChange={event => setMethod(event.target.value as 'ioa' | 'ground')} className="rounded border border-slate-300 p-1 ml-1"><option value="ioa">IoA baseline</option><option value="ground">Ground diagnostic</option></select></label>
            </div>
            <p role="status" className="text-xs text-slate-500">{!monitoringEnabled ? 'AI inactive' : currentResult ? `${method.toUpperCase()} · frame ${currentResult.frame} · instantaneous diagnostic occupancy` : monitoring.status}
                {monitoringEnabled && monitoring.metrics && ` · ${monitoring.metrics.processingFps} processing FPS · source ${monitoring.metrics.sourceFps.toFixed(1)} FPS (not measured playback) · ${monitoring.metrics.runtime.model}/${monitoring.metrics.runtime.device}`}</p>
            {monitoringEnabled && <p className="text-xs text-slate-500">Results more than 0.25s from playback are hidden. Pause to inspect a matching frame. Ground is experimental. OCR is not enabled in this checkpoint.</p>}
            {currentResult && currentResult.diagnostics.length > 0 && <details className="text-xs text-amber-700"><summary>Assignment uncertainty</summary>{currentResult.diagnostics.map((message, index) => <p key={index}>{message}</p>)}</details>}
        </div>}
        {roi && dimensions.width > 0 && !scaledRoi(roi, dimensions.width, dimensions.height).length && <p role="status" className="text-xs text-amber-700">Saved ROI dimensions do not match this recording. Overlay hidden; playback remains available.</p>}
        {!video.preview && !problem && <p className="text-xs text-amber-700">This container may not be supported by your browser. Playback is attempted without converting the recording.</p>}
        {checking && <p role="status" className="text-xs text-slate-500">Checking video delivery…</p>}
        {problem && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p>{problem.message}</p><button type="button" className="mt-2 rounded border border-amber-400 px-3 py-1 font-semibold" onClick={() => setAttempt(n => n + 1)}>Retry video</button>
        </div>}
    </div>;
}
