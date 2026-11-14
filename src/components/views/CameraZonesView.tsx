import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, Video, X } from 'lucide-react';
import { DEMO_MODE } from '../../demo';
import type { CameraHealth } from '../../notifications/model';
import { defaultLegacyDisplays, legacyVideo, emptyFeed, feedRequest, canMonitorRecording, type LegacyDisplay, type Feed, type FeedDraft, type FeedMode, type SampleVideo } from '../../cameras/feedApi';
import { DetectionSettings } from '../ui/DetectionSettings';
import { ProcessedSampleFeeds } from '../ui/ProcessedSampleFeeds';
import { SampleCoverageNotice } from '../ui/SampleCoverageNotice';
import { SamplePlayer } from '../ui/SamplePlayer';
import { RoiMappingPicker } from '../ui/RoiMappingPicker';
import { IntegratedSamplePreview } from '../ui/IntegratedSamplePreview';
import { OperationalCameraPreview } from '../ui/OperationalCameraPreview';
import { operationalClient, type OperationalStatus } from '../../cameras/operationalCamera';

const inputClass = 'w-full mt-1 rounded-lg border border-slate-300 bg-white p-2.5 focus-visible:outline-2 focus-visible:outline-emerald-600';
const actionClass = 'rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed';
const dialogClass = 'm-auto w-[min(94vw,720px)] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 sm:p-7 shadow-xl backdrop:bg-slate-950/60';

export function BayLabelSelector({ direction, bays, onChange }: {
    direction: FeedDraft['direction']; bays: number[]; onChange: (bays: number[]) => void;
}) {
    return <fieldset><legend className="text-sm font-semibold mb-2">Assigned bays (labels only)</legend>
        <p className="text-xs text-slate-500 mb-3">Choose the terminal direction above to enable its bays. Saved ROI assignments are separate.</p>
        <div className="space-y-3">{(['northbound', 'southbound'] as const).map(group => <fieldset key={group} disabled={direction !== group} className="disabled:opacity-50">
            <legend className="text-xs font-semibold capitalize mb-2">{group} · Bays {group === 'northbound' ? '1–5' : '6–10'}</legend>
            <div className="flex flex-wrap gap-3">{Array.from({ length: 5 }, (_, i) => i + (group === 'northbound' ? 1 : 6)).map(bay => <label key={bay} className="flex items-center gap-2 rounded border border-slate-200 p-2 text-sm"><input type="checkbox" checked={bays.includes(bay)} onChange={e => onChange(e.target.checked ? [...bays, bay] : bays.filter(b => b !== bay))} />Bay {bay}</label>)}</div>
        </fieldset>)}</div>
    </fieldset>;
}

export function CameraZonesView({ health, localOnline, focusedCamera, canConfigure = false }: {
    health: CameraHealth[]; localOnline: boolean; focusedCamera?: number; canConfigure?: boolean;
}) {
    const editable = canConfigure && !DEMO_MODE;
    const [mode, setMode] = useState<FeedMode>('sample');
    const [feeds, setFeeds] = useState<Feed[]>([]);
    const [legacyDisplays, setLegacyDisplays] = useState(defaultLegacyDisplays);
    const [editingLegacy, setEditingLegacy] = useState<number | null>(null);
    const [removingLegacy, setRemovingLegacy] = useState<LegacyDisplay | null>(null);
    const [monitoringFeed, setMonitoringFeed] = useState<string | null>(null);
    const [videos, setVideos] = useState<SampleVideo[]>([]);
    const [loading, setLoading] = useState(editable);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [revision, setRevision] = useState(0);
    const [operational, setOperational] = useState<OperationalStatus | null>(null);
    const [operationalError, setOperationalError] = useState('');
    const [draft, setDraft] = useState<FeedDraft>(emptyFeed('sample'));
    const [editing, setEditing] = useState<string | null>(null);
    const [removing, setRemoving] = useState<Feed | null>(null);
    const [selectedVideo, setSelectedVideo] = useState('');
    const [formError, setFormError] = useState('');
    const editor = useRef<HTMLDialogElement>(null);
    const picker = useRef<HTMLDialogElement>(null);
    const removal = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        if (!editable) return;
        let disposed = false, timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const state = await operationalClient().status();
                if (!disposed) { setOperational(state); setOperationalError(''); }
            } catch (e) {
                if (!disposed) { setOperational(null); setOperationalError(e instanceof Error ? e.message : 'Operational monitoring unavailable.'); }
            }
            if (!disposed) timer = setTimeout(poll, 2000);
        };
        void poll();
        return () => { disposed = true; clearTimeout(timer); };
    }, [editable, revision]);

    useEffect(() => {
        if (!editable) return;
        const controller = new AbortController();
        setLoading(true); setError('');
        void Promise.all([feedRequest<{ feeds: Feed[]; legacyDisplays?: LegacyDisplay[] }>('', 'GET', undefined, controller.signal),
            feedRequest<{ videos: SampleVideo[] }>('/videos', 'GET', undefined, controller.signal)])
            .then(([saved, catalog]) => { if (!controller.signal.aborted) {
                setFeeds(saved.feeds); setVideos(catalog.videos);
                setLegacyDisplays(defaultLegacyDisplays.map(original => saved.legacyDisplays?.find(d => d.id === original.id) || original));
            } })
            .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Cannot load local feeds.'); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [editable, revision]);

    useEffect(() => { if (focusedCamera) setMode('sample'); }, [focusedCamera]);

    const openEditor = (feed?: Feed) => {
        if (!editable || busy || loading || error) return;
        setEditing(feed?.id ?? null);
        setEditingLegacy(null);
        setDraft(feed ? { kind: feed.kind, name: feed.name, direction: feed.direction, bays: [...feed.bays], address: feed.address, transport: feed.transport, videoId: feed.videoId, ...(feed.roiId !== undefined ? { roiId: feed.roiId } : {}) } : emptyFeed(mode));
        setFormError(''); setNotice(''); editor.current?.showModal();
    };
    const openLegacyEditor = (display: LegacyDisplay) => {
        if (!editable || busy || loading || error) return;
        openEditor({ ...emptyFeed('sample'), ...display, id: `legacy-${display.id}`, videoId: legacyVideo(display.id).id });
        setEditingLegacy(display.id);
    };
    const saveDisplay = async (display: LegacyDisplay) => {
        const { id, ...settings } = display;
        const result = await feedRequest<{ display: LegacyDisplay }>(`/display/${id}`, 'PATCH', settings);
        setLegacyDisplays(previous => previous.map(d => d.id === id ? result.display : d));
    };
    const restoreDisplay = async (display: LegacyDisplay) => {
        if (!editable || busy || loading || error) return;
        setBusy(true);
        try { await saveDisplay({ ...display, hidden: false }); setNotice('Card restored. Its worker was not changed.'); }
        catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to restore card.'); }
        finally { setBusy(false); }
    };
    const save = async (event: FormEvent) => {
        event.preventDefault();
        if (!editable || busy) return;
        setBusy(true); setFormError('');
        try {
            if (editingLegacy !== null) {
                await saveDisplay({ id: editingLegacy, name: draft.name, direction: draft.direction, bays: draft.bays, hidden: false });
                editor.current?.close(); setNotice('Display labels saved. Physical detection bays and worker settings are unchanged.');
                return;
            }
            const result = await feedRequest<{ feed: Feed }>(editing ? `/${editing}` : '', editing ? 'PATCH' : 'POST', draft);
            if (editing === monitoringFeed) setMonitoringFeed(null);
            setFeeds(previous => editing ? previous.map(f => f.id === editing ? result.feed : f) : [...previous, result.feed]);
            editor.current?.close(); setNotice(draft.kind === 'sample' ? 'Feed saved. Valid mapped recordings are automatically monitored by the local camera manager.' : 'IP camera configuration saved. RTSP playback is not connected.');
        } catch (e) { setFormError(e instanceof Error ? e.message : 'Unable to save feed.'); }
        finally { setBusy(false); }
    };
    const remove = async () => {
        if (!editable || busy || (!removing && !removingLegacy)) return;
        setBusy(true); setFormError('');
        try {
            if (removingLegacy) {
                await saveDisplay({ ...removingLegacy, hidden: true });
                removal.current?.close(); setRemovingLegacy(null);
                setNotice('Card hidden. Detection, OCR, timers and announcements continue unchanged.');
                return;
            }
            if (!removing) return;
            await feedRequest(`/${removing.id}`, 'DELETE');
            if (removing.id === monitoringFeed) setMonitoringFeed(null);
            setFeeds(previous => previous.filter(f => f.id !== removing.id));
            removal.current?.close(); setRemoving(null); setNotice('Feed removed. Its worker will stop; the original video is preserved.');
        } catch (e) { setFormError(e instanceof Error ? e.message : 'Unable to remove feed.'); }
        finally { setBusy(false); }
    };
    const selected = videos.find(v => v.id === selectedVideo);
    const displayedFeeds = feeds.filter(f => f.kind === mode);

    return <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 className="text-lg font-bold text-slate-800">Camera Zones</h2><p className="text-sm text-slate-500">Manage local feeds and monitor mapped recordings.</p></div>
            <div className="flex flex-wrap items-center gap-3">
                {editable ? <DetectionSettings /> : <span className="text-sm text-slate-500">AI detection requires the local system</span>}
                <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{DEMO_MODE ? 'Hosted demo: no camera connection' : localOnline ? 'Local Backend: Online' : 'Local Backend: Unavailable'}</span>
            </div>
        </header>
        <SampleCoverageNotice />
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-end gap-3 justify-between">
                <label className="text-sm font-semibold text-slate-700 w-full sm:w-72">Feed mode
                    <select value={mode} onChange={e => { setMonitoringFeed(null); setMode(e.target.value as FeedMode); setNotice(''); }} className={inputClass}>
                        <option value="live">LIVE FEED</option><option value="sample">SAMPLE DEMONSTRATION</option>
                    </select>
                </label>
                <div className="flex flex-wrap gap-2">
                    {editable && <button type="button" className={actionClass} disabled={loading || busy} onClick={() => setRevision(r => r + 1)}>Refresh list</button>}
                    <button type="button" onClick={() => openEditor()} disabled={!editable || loading || busy || !!error}
                        className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"><Plus size={17} />{mode === 'live' ? 'Add IP Camera' : 'Add Sample Feed'}</button>
                </div>
            </div>
            <p className="text-sm text-slate-600">{mode === 'live' ? 'Configuration only. RTSP playback and connection testing are not enabled. No network connection is attempted.' : 'Valid mapped recordings are monitored automatically and update local bay occupancy, timers and OCR. Recordings without a mapping remain playback-only.'}</p>
            {mode === 'sample' && editable && legacyDisplays.some(d => d.hidden) && <details className="text-sm text-slate-500"><summary className="cursor-pointer">Hidden camera cards</summary><div className="flex flex-wrap gap-2 mt-2">{legacyDisplays.filter(d => d.hidden).map(d => <button key={d.id} type="button" className={actionClass} disabled={busy || loading || !!error} onClick={() => { void restoreDisplay(d); }}>Restore {d.name}</button>)}</div></details>}
            {!editable && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Read-only preview. Local administrator login is required to manage feeds. Real camera addresses and local recordings are not loaded here.</p>}
            {loading && <p role="status">Loading local feed configuration…</p>}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
            {!loading && !displayedFeeds.length && mode === 'live' && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500"><Video className="mx-auto mb-3" /><p>{editable ? 'No saved feeds in this mode. Add a configuration to get started.' : 'Sample layout only — no real feed configurations are exposed.'}</p></div>}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" aria-label={mode === 'sample' ? 'Sample Demonstration feeds' : 'Live feed configurations'}>
                {mode === 'sample' && <ProcessedSampleFeeds health={health} localOnline={localOnline} focusedCamera={focusedCamera}
                    displays={operational ? legacyDisplays.filter(d => operational.feeds.some(f => f.legacy && f.notificationId === d.id)) : legacyDisplays}
                    operational={operational?.feeds} onOperationalChange={() => setRevision(n => n + 1)}
                    editable={editable && !busy && !loading && !error} onEdit={openLegacyEditor} onRemove={display => { setRemoving(null); setRemovingLegacy(display); setFormError(''); removal.current?.showModal(); }} />}
                {displayedFeeds.map(feed => {
                const video = videos.find(v => v.id === feed.videoId);
                const camera = operational?.feeds.find(item => item.id === feed.id);
                return <article key={feed.id} id={camera ? `camera-${camera.notificationId}` : undefined} className="min-w-0 rounded-xl border border-slate-200 overflow-hidden">
                    <div className="p-3 space-y-2"><h3 className="font-semibold text-slate-800 break-words">{feed.name}</h3>
                        <p className="text-xs text-slate-500 capitalize">{feed.direction} · Bays {feed.bays.join(', ')}</p>
                        {feed.kind === 'live' ? <><p className="text-xs font-semibold text-amber-700">NOT CONNECTED · CONFIGURATION ONLY</p><p className="text-sm text-slate-600 break-all">{feed.address}</p><p className="text-xs text-slate-500">Transport: {feed.transport.toUpperCase()}</p></>
                            : camera && editable ? <OperationalCameraPreview feed={camera} onChanged={() => setRevision(n => n + 1)} />
                            : video ? monitoringFeed === feed.id && editable
                                ? <IntegratedSamplePreview key={feed.id} feedId={feed.id} name={feed.name} onStop={() => setMonitoringFeed(null)} />
                                : <SamplePlayer key={video.id} video={video} autoPlay loop label={feed.name} roi={feed.roiMapping?.roi} />
                                : <p className="text-sm text-amber-700">Recording unavailable. Select another video or restore the original file.</p>}
                        {feed.kind === 'sample' && feed.roiStatus !== 'valid' && <p className="text-xs text-slate-500">{feed.roiStatus === 'invalid' ? 'Saved mapping is invalid or unavailable. Edit the feed to select a compatible mapping.' : 'No parking-bay mapping. Video playback only.'}</p>}
                        {feed.kind === 'sample' && feed.roiStatus === 'valid' && !camera && <p className="text-xs text-slate-500">{operationalError || 'Waiting for the local operational camera manager.'}</p>}
                        <div className="flex flex-wrap gap-3 text-xs"><button type="button" className="rounded p-1 hover:bg-emerald-50 disabled:opacity-50" disabled={!editable || busy || loading || !!error} onClick={() => openEditor(feed)}><Pencil className="inline mr-1" size={14} />Edit</button>
                            <button type="button" className="rounded p-1 text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={!editable || busy || loading || !!error} onClick={() => { setRemovingLegacy(null); setRemoving(feed); setFormError(''); removal.current?.showModal(); }}><Trash2 className="inline mr-1" size={14} />Remove</button>
                            {editable && !camera && video && canMonitorRecording(feed) && monitoringFeed !== feed.id && <button type="button" className="ml-auto rounded border border-emerald-300 px-2 py-1 text-emerald-800" onClick={() => setMonitoringFeed(feed.id)}>Open diagnostic preview</button>}
                        </div>
                    </div>
                </article>;
            })}</div>
            {editable && (operational?.message || operational?.historyError) && <p role="alert" className="text-sm text-amber-800 mt-3">{operational.message || operational.historyError}</p>}
        </section>

        {editable && <>
            <dialog ref={editor} className={dialogClass} aria-labelledby="feed-editor-title" onCancel={e => { if (busy) e.preventDefault(); }}>
                <form onSubmit={save} className="space-y-4">
                    <div className="flex justify-between gap-3"><h3 id="feed-editor-title" className="font-bold text-lg">{editing ? 'Edit' : 'Add'} {draft.kind === 'live' ? 'IP camera' : 'sample feed'}</h3><button type="button" disabled={busy} onClick={() => editor.current?.close()} aria-label="Close feed editor"><X /></button></div>
                    <fieldset disabled={busy} className="space-y-4">
                        {editingLegacy !== null && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Display settings only. Renaming or relabeling this card does not move its physical ROI, change its source, or reconfigure its operational worker.</p>}
                        <label className="block text-sm font-semibold">Feed name<input autoFocus required maxLength={80} className={inputClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
                        <label className="block text-sm font-semibold">Terminal direction<select className={inputClass} value={draft.direction} onChange={e => setDraft({ ...draft, direction: e.target.value as FeedDraft['direction'], bays: [e.target.value === 'northbound' ? 1 : 6] })}><option value="northbound">Northbound</option><option value="southbound">Southbound</option></select></label>
                        <BayLabelSelector direction={draft.direction} bays={draft.bays} onChange={bays => setDraft({ ...draft, bays })} />
                        {draft.kind === 'live' ? <>
                            <label className="block text-sm font-semibold">IP / RTSP address<input required maxLength={512} autoComplete="off" spellCheck={false} className={inputClass} value={draft.address} placeholder="rtsp://camera-host:554/stream" onChange={e => setDraft({ ...draft, address: e.target.value })} /></label>
                            <p className="text-xs text-slate-500">Use a credential-free address. Usernames, passwords, query strings and fragments are not accepted. Camera credentials and live playback will require a separate integration.</p>
                            <label className="block text-sm font-semibold">RTSP transport<select className={inputClass} value={draft.transport} onChange={e => setDraft({ ...draft, transport: e.target.value as FeedDraft['transport'] })}><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
                        </> : editingLegacy === null && <div className="rounded-lg border border-slate-200 p-3 space-y-2"><p className="text-sm break-all">{draft.videoId || 'No recording selected'}</p><button type="button" className={actionClass} onClick={() => { setSelectedVideo(draft.videoId); picker.current?.showModal(); }}>Select video</button><p className="text-xs text-slate-500">Files are read from the local sample directories. No uploads or file deletions.</p></div>}
                        {draft.kind === 'sample' && editingLegacy === null && <RoiMappingPicker draft={draft} onChange={setDraft} />}
                    </fieldset>
                    {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
                    <div className="flex justify-end gap-2"><button type="button" disabled={busy} className={actionClass} onClick={() => editor.current?.close()}>Cancel</button><button type="submit" disabled={busy || !draft.bays.length || (draft.kind === 'sample' && !draft.videoId)} className="rounded-lg bg-emerald-600 px-4 py-2 text-white font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save configuration'}</button></div>
                </form>
            </dialog>
            <dialog ref={picker} className={dialogClass} aria-labelledby="video-picker-title" onClose={() => setSelectedVideo('')}>
                <div className="flex justify-between mb-4"><h3 id="video-picker-title" className="text-lg font-bold">Select a sample video</h3><button type="button" aria-label="Close video selection" onClick={() => picker.current?.close()}><X /></button></div>
                <p className="text-sm text-slate-500 mb-3">Local recordings from sample-CCTV and sample-videos. Preview support depends on your browser and video codec.</p>
                {!videos.length && <p>No supported recordings found. Add files to the local sample directories, close this dialog and refresh the list.</p>}
                <div className="max-h-52 overflow-y-auto space-y-2 mb-4">{videos.map(video => <label key={video.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${selectedVideo === video.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}><input className="mt-1" type="radio" name="sample-video" value={video.id} checked={selectedVideo === video.id} onChange={() => setSelectedVideo(video.id)} /><span className="min-w-0"><span className="block text-sm font-semibold break-all">{video.filename}</span><span className="text-xs text-slate-500">{video.directory}</span></span></label>)}</div>
                {selected && <SamplePlayer key={selected.id} video={selected} />}
                <div className="flex justify-end mt-4"><button type="button" disabled={!selected} className="rounded-lg bg-emerald-600 px-4 py-2 text-white font-semibold disabled:opacity-50" onClick={() => { setDraft({ ...draft, videoId: selectedVideo, ...(selectedVideo !== draft.videoId ? { roiId: '' } : {}) }); picker.current?.close(); }}>Use selected video</button></div>
            </dialog>
            <dialog ref={removal} className={dialogClass} aria-labelledby="remove-feed-title" onCancel={e => { if (busy) e.preventDefault(); }}>
                <h3 id="remove-feed-title" className="font-bold text-lg">{removingLegacy ? 'Hide camera card?' : 'Remove feed configuration?'}</h3><p className="my-3 text-sm">{removingLegacy ? `Hide “${removingLegacy.name}” from this grid only? Its operational detection, OCR, occupancy timers and announcements will continue. No worker is stopped, removed or reconfigured. Restore it later under Hidden camera cards.` : `Remove “${removing?.name || ''}” from the list? Its operational worker will stop and its bays will be reassigned or marked unmonitored. The original video will not be deleted.`}</p>
                {formError && <p role="alert" className="text-sm text-red-700 mb-3">{formError}</p>}
                <div className="flex justify-end gap-2"><button type="button" disabled={busy} className={actionClass} onClick={() => removal.current?.close()}>Cancel</button><button type="button" disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-50" onClick={() => { void remove(); }}>{busy ? 'Saving…' : removingLegacy ? 'Hide card only' : 'Remove feed'}</button></div>
            </dialog>
        </>}
    </div>;
}
