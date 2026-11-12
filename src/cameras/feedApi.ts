import { DEMO_MODE } from '../demo';
import type { RoiOverlay } from './roiOverlay';

export type FeedMode = 'live' | 'sample';
export type FeedDraft = {
    kind: FeedMode; name: string; direction: 'northbound' | 'southbound'; bays: number[];
    address: string; transport: 'tcp' | 'udp'; videoId: string; roiId?: string;
};
export type RoiMapping = { id: string; bays: number[]; direction: FeedDraft['direction']; roi: RoiOverlay; warnings: string[] };
export type Feed = FeedDraft & { id: string; roiStatus?: 'valid' | 'invalid' | 'none'; roiMapping?: RoiMapping | null; legacyAiCompatible?: boolean; integratedAiCompatible?: boolean };
// Presentation eligibility only; the authenticated backend revalidates every start.
export function canMonitorRecording(feed: Feed) {
    return feed.kind === 'sample' && feed.roiStatus === 'valid' && feed.integratedAiCompatible === true;
}
export type SampleVideo = { id: string; filename: string; directory: string; url: string; preview: boolean };
export type LegacyDisplay = { id: number; name: string; direction: FeedDraft['direction']; bays: number[]; hidden: boolean };
export const defaultLegacyDisplays: LegacyDisplay[] = [
    { id: 1, name: 'Northbound Cam 1', direction: 'northbound', bays: [1], hidden: false },
    { id: 2, name: 'Southbound Cam 1', direction: 'southbound', bays: [6], hidden: false },
];
export function legacyVideo(id: number): SampleVideo {
    const filename = `sample-VID_20260604_${id === 1 ? '131402' : '133427'}.mp4`;
    return { id: `sample-videos/${filename}`, filename, directory: 'sample-videos', url: `/sample-videos/${filename}`, preview: true };
}

// No addresses, credentials or feed lists are persisted in browser storage.
export async function feedRequest<T>(path = '', method = 'GET', body?: FeedDraft | Omit<LegacyDisplay, 'id'>, signal?: AbortSignal): Promise<T> {
    if (DEMO_MODE) throw new Error('Feed configuration is available only to local administrators.');
    const token = sessionStorage.getItem('terminalsight-export-token');
    if (!token) throw new Error('Please sign in locally to manage feeds.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 10000);
    try {
    const response = await fetch(`/api/camera-feeds${path}`, {
        method, signal: controller.signal, cache: 'no-store', credentials: 'omit',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('Restart the updated local backend to manage feed configurations.'); }
    if (!response.ok) throw new Error(result.message || 'Unable to update feed configuration.');
    return result as T;
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export function emptyFeed(kind: FeedMode): FeedDraft {
    return { kind, name: '', direction: 'northbound', bays: [1], address: '', transport: 'tcp', videoId: '', ...(kind === 'sample' ? { roiId: '' } : {}) };
}
