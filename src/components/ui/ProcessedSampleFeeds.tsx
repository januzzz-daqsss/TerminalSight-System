import { Pencil, Trash2, Video } from 'lucide-react';
import type { CameraHealth } from '../../notifications/model';
import { DEMO_MODE } from '../../demo';
import { defaultLegacyDisplays, legacyVideo, type LegacyDisplay } from '../../cameras/feedApi';
import { SamplePlayer } from './SamplePlayer';
import { MediaViewport } from './MediaViewport';

// Display overrides never determine the source URL, worker identity or physical bay.
export function ProcessedSampleFeeds({ health, localOnline, focusedCamera, displays = defaultLegacyDisplays, editable = false, onEdit, onRemove }: {
    health: CameraHealth[]; localOnline: boolean; focusedCamera?: number; displays?: LegacyDisplay[]; editable?: boolean;
    onEdit?: (display: LegacyDisplay) => void; onRemove?: (display: LegacyDisplay) => void;
}) {
    return <>{displays.filter(display => !display.hidden).map(display => {
        const { id, name } = display;
        const state = DEMO_MODE ? 'Not connected in hosted demo' : !localOnline ? 'Backend unavailable' : health.find(c => c.id === id)?.state || 'Not connected';
        return <article key={id} id={`camera-${id}`} tabIndex={-1} aria-label={name}
            className={`min-w-0 rounded-xl overflow-hidden border bg-white ${focusedCamera === id ? 'outline-4 outline-sky-500 border-sky-500' : 'border-slate-200'}`}>
            <div className="p-3"><h3 className="font-semibold text-slate-800 break-words">{name}</h3>
                <p className="text-xs text-slate-500 capitalize">{display.direction} · Bays {display.bays.join(', ')}</p></div>
            {!DEMO_MODE && state === 'Live' ? <MediaViewport label={name}>
                <img className="absolute inset-0 h-full w-full object-contain" alt={`${name} processed sample video`} src={`/video_feed/${id === 1 ? 'northbound' : 'southbound'}_cam1`} />
            </MediaViewport> : !DEMO_MODE && state === 'Disabled' ? <SamplePlayer video={legacyVideo(id)} autoPlay loop label={name} />
                : <div className="aspect-video bg-slate-950 flex flex-col justify-center items-center text-slate-400 p-6"><Video className="mb-3" /><p>{state}</p></div>}
            <div className="flex gap-3 p-3 text-xs">
                <button type="button" disabled={!editable || DEMO_MODE} onClick={() => onEdit?.(display)} className="rounded p-1 hover:bg-emerald-50 disabled:opacity-50"><Pencil className="inline mr-1" size={14} />Edit</button>
                <button type="button" disabled={!editable || DEMO_MODE} onClick={() => onRemove?.(display)} className="rounded p-1 text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 className="inline mr-1" size={14} />Remove</button>
            </div>
        </article>;
    })}</>;
}
