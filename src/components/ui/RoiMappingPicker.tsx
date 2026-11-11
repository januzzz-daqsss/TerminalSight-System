import { useEffect, useState } from 'react';
import { feedRequest, type FeedDraft, type RoiMapping } from '../../cameras/feedApi';

/** Mounted only inside the authenticated local editor. No uploads or GUI launch. */
export function RoiMappingPicker({ draft, onChange }: { draft: FeedDraft; onChange: (draft: FeedDraft) => void }) {
    const [options, setOptions] = useState<RoiMapping[]>([]);
    const [revision, setRevision] = useState(0);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        setOptions([]); setMessage('');
        if (!draft.videoId) return;
        setLoading(true);
        void feedRequest<{ mappings: RoiMapping[]; excluded: number }>(`/roi?videoId=${encodeURIComponent(draft.videoId)}`, 'GET', undefined, controller.signal)
            .then(result => { if (!controller.signal.aborted) {
                setOptions(result.mappings);
                setMessage(result.excluded ? 'Incompatible or invalid files are excluded. Check the source recording, dimensions, bay numbers and direction.' : '');
            } })
            .catch(() => { if (!controller.signal.aborted) setMessage('Could not load mappings. Ordinary playback remains available.'); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [draft.videoId, revision]);
    const selected = options.find(option => option.id === draft.roiId);
    return <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2 text-sm">
        <label className="block font-semibold">Parking-bay mapping
            <select className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5" value={draft.roiId ?? '__legacy__'} disabled={!draft.videoId || loading}
                onChange={event => {
                    const mapping = options.find(option => option.id === event.target.value);
                    onChange({ ...draft, roiId: event.target.value, ...(mapping ? { direction: mapping.direction, bays: [...mapping.bays] } : {}) });
                }}>
                {draft.roiId === undefined && <option value="__legacy__">Keep existing recording association</option>}
                <option value="">No mapping — video playback only</option>
                {draft.roiId && !selected && <option value={draft.roiId}>Saved mapping unavailable: {draft.roiId}</option>}
                {options.map(option => <option key={option.id} value={option.id}>{option.id} · Bays {option.bays.join(', ')}</option>)}
            </select>
        </label>
        <button type="button" className="font-semibold text-emerald-800 underline disabled:opacity-50" disabled={!draft.videoId || loading} onClick={() => setRevision(value => value + 1)}>{loading ? 'Checking mappings…' : 'Refresh mapping list'}</button>
        <p>Choosing a mapping sets its bay labels and direction. This saves geometry only; it does not activate detection.</p>
        {message && <p role="status" className="text-amber-800">{message}</p>}
        {selected?.warnings.map(warning => <p key={warning} className="text-amber-800">Warning: {warning}</p>)}
        <details><summary className="cursor-pointer font-semibold">Create or register a mapping</summary>
            <p className="mt-2">From the project folder, open the desktop ROI Mapper with your recording. Save its JSON under config/roi, then refresh this list, select it and save the feed. The browser cannot launch the mapper.</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{'.\\.venv\\Scripts\\python.exe -B tools/roi_mapper.py --video "public/<recording>" --output "config/roi/<new-name>.json"'}</pre>
            <p>Use the video picker filename for &lt;recording&gt;, including sample-CCTV/ or sample-videos/. Keep the same camera viewpoint when mapping different frames.</p>
        </details>
    </section>;
}
