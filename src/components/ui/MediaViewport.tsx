import { useRef, useState, type ReactNode } from 'react';
import { Maximize } from 'lucide-react';

export async function toggleMediaFullscreen(element: HTMLElement) {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await element.requestFullscreen();
}

/** Fullscreen the media and its overlays together, rather than the video alone. */
export function MediaViewport({ label, children }: { label: string; children: ReactNode }) {
    const container = useRef<HTMLDivElement>(null);
    const [error, setError] = useState('');
    return <div>
        <div ref={container} className="relative w-full aspect-video bg-slate-950 overflow-hidden [&:fullscreen]:h-screen [&:fullscreen]:w-screen [&:fullscreen]:aspect-auto">
            {children}
            <button type="button" aria-label={`Fullscreen ${label}`} title="Fullscreen" className="absolute top-2 right-2 z-10 rounded bg-slate-950/70 p-2 text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-400"
                onClick={() => { if (container.current) void toggleMediaFullscreen(container.current).then(() => setError('')).catch(() => setError('Fullscreen is unavailable in this browser.')); }}><Maximize size={16} /></button>
        </div>
        {error && <p role="status" className="text-xs text-amber-700 p-2">{error}</p>}
    </div>;
}
