import { useEffect, useRef, useState, type RefObject } from 'react';
import { DEMO_MODE } from '../demo';

export const PILOT_VIDEO = 'sample-CCTV/Bays 1-2.mp4';
export const OVERLAY_COLORS = { AVAILABLE: '#22c55e', OCCUPIED: '#ef4444', UNCERTAIN: '#f59e0b', inactive: '#94a3b8', box: '#3b82f6', ocr: '#06b6d4' };
export type MonitoringFrame = {
    videoId: string; epoch: number; seconds: number; frame: number; width: number; height: number;
    method: 'ioa' | 'ground'; processingFps: number; sourceFps: number;
    runtime: { model: string; device: string }; states: Record<string, string>; diagnostics: string[];
    detections: { bbox: [number, number, number, number]; class_name: string; class_id: number; vehicle_type: string; confidence: number }[];
};
export function currentMonitoringFrame(frame: MonitoringFrame | null, videoId: string, epoch: number, seconds: number, method: string) {
    return !!frame && frame.videoId === videoId && frame.epoch === epoch && frame.method === method &&
        Number.isFinite(frame.seconds) && Math.abs(frame.seconds - seconds) <= .25;
}
export function occupancyColor(state?: string) {
    return state === 'AVAILABLE' ? OVERLAY_COLORS.AVAILABLE : state === 'OCCUPIED' ? OVERLAY_COLORS.OCCUPIED :
        state ? OVERLAY_COLORS.UNCERTAIN : OVERLAY_COLORS.inactive;
}
export async function requestMonitoringFrame(videoId: string, seconds: number, epoch: number, method: string, signal: AbortSignal): Promise<MonitoringFrame> {
    if (DEMO_MODE || videoId !== PILOT_VIDEO) throw new Error('Monitoring is limited to the local pilot recording.');
    const token = sessionStorage.getItem('terminalsight-export-token');
    if (!token) throw new Error('Sign in locally to enable monitoring.');
    const response = await fetch('/api/sample-monitor/frame', { method: 'POST', signal, cache: 'no-store', credentials: 'omit',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId, seconds, epoch, method }) });
    const data = await response.json().catch(() => { throw new Error('Restart the updated local backend to enable monitoring.'); });
    if (!response.ok) throw new Error(data.message || 'Monitoring unavailable. Playback continues.');
    return data;
}

/** One pending request. Seeking/looping/pausing invalidate earlier generations. */
export function useSynchronizedPreview(media: RefObject<HTMLVideoElement | null>, videoId: string, enabled: boolean, method: 'ioa' | 'ground') {
    const epoch = useRef(0);
    const latest = useRef<MonitoringFrame | null>(null);
    const [frame, setFrame] = useState<MonitoringFrame | null>(null);
    const [status, setStatus] = useState('AI inactive');
    const [metrics, setMetrics] = useState<MonitoringFrame | null>(null);
    useEffect(() => {
        const element = media.current;
        epoch.current++; latest.current = null; setFrame(null); setMetrics(null);
        if (!enabled || DEMO_MODE || !element || videoId !== PILOT_VIDEO) { setStatus('AI inactive'); return; }
        let disposed = false, timer: ReturnType<typeof setTimeout>, animation = 0;
        let previousTime = element.currentTime;
        const controller = new AbortController();
        const reset = () => { epoch.current++; latest.current = null; setFrame(null); setStatus('Waiting for synchronized AI'); };
        const events = ['seeking', 'seeked', 'pause', 'play', 'ratechange', 'emptied', 'error'] as const;
        events.forEach(event => element.addEventListener(event, reset));
        const paint = () => {
            if (element.currentTime < previousTime - .05) reset(); // Native looping has no seek event in some browsers.
            previousTime = element.currentTime;
            const valid = !element.seeking && element.readyState >= 2 && currentMonitoringFrame(latest.current, videoId, epoch.current, element.currentTime, method);
            setFrame(valid ? latest.current : null);
            animation = requestAnimationFrame(paint);
        };
        const poll = async () => {
            if (disposed) return;
            if (!element.seeking && !element.error && element.readyState >= 2 && !(element.paused && currentMonitoringFrame(latest.current, videoId, epoch.current, element.currentTime, method))) {
                const generation = epoch.current;
                const timeout = setTimeout(() => controller.abort(), 40000);
                try {
                    const result = await requestMonitoringFrame(videoId, element.currentTime, generation, method, controller.signal);
                    if (!disposed && generation === epoch.current && result.epoch === generation) {
                        latest.current = result; setMetrics(result); setStatus('Waiting for synchronized AI');
                    }
                } catch (error) {
                    if (!disposed) { latest.current = null; setFrame(null); setStatus(controller.signal.aborted ? 'AI request timed out. Stop and enable monitoring to retry.' : error instanceof Error ? error.message : 'Monitoring unavailable.'); }
                } finally { clearTimeout(timeout); }
            }
            if (!disposed && !controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 500);
        };
        setStatus('Waiting for synchronized AI');
        animation = requestAnimationFrame(paint); void poll();
        return () => { disposed = true; controller.abort(); clearTimeout(timer); cancelAnimationFrame(animation); events.forEach(event => element.removeEventListener(event, reset)); epoch.current++; latest.current = null; };
    }, [media, videoId, enabled, method]);
    return { frame, metrics, status };
}
