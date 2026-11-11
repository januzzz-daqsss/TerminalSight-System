import { DEMO_MODE } from '../demo';

import type { RoiOverlay } from './roiOverlay';
export type AiMapping = { videoId: string; bays: string[]; direction: string; roi?: RoiOverlay };
export type AiFrame = {
    image: string; frame: number; seconds: number; ended: boolean; method: 'ioa' | 'ground';
    states: Record<string, string>; processingFps: number; diagnostics: string[]; overlaps: Record<string, number>;
};

// Capture only the local token, so cleanup can stop its own session after unmount.
// No token in URLs, media src attributes, or persistent preview state.
export function createSampleAiClient() {
    if (DEMO_MODE) throw new Error('Sample AI is available only on the local terminal.');
    const token = sessionStorage.getItem('terminalsight-export-token');
    if (!token) throw new Error('Sign in locally to enable sample AI.');
    async function request<T>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (signal?.aborted) abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 100000);
        try {
            const response = await fetch(`/api/sample-ai${path}`, {
                method, signal: controller.signal, cache: 'no-store', credentials: 'omit',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            const data = await response.json().catch(() => { throw new Error('Restart the local backend to use sample AI.'); });
            if (!response.ok) throw new Error(data.message || 'Sample AI preview failed.');
            return data as T;
        } finally {
            clearTimeout(timer); signal?.removeEventListener('abort', abort);
        }
    }
    const path = (id: string) => `/sessions/${encodeURIComponent(id)}`;
    return {
        mappings: (signal?: AbortSignal) => request<{ mappings: AiMapping[] }>('/mappings', 'GET', undefined, signal),
        start: (videoId: string, method: 'ioa' | 'ground') => request<{ id: string }>('/sessions', 'POST', { videoId, method }),
        frame: (id: string, advance: boolean, signal: AbortSignal) => request<AiFrame>(`${path(id)}/frame`, 'POST', { advance }, signal),
        stop: (id: string) => request(path(id), 'DELETE'),
    };
}
