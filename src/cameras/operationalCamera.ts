import { DEMO_MODE } from '../demo';
import { JpegParts } from './integratedPreview';

export type OperationalFeed = { id: string; name: string; bays: string[]; state: string; healthy: boolean;
    message: string | null; inferenceFps: number; generation: number; instance?: string; legacy: boolean; notificationId: number };
export type OperationalStatus = { feeds: OperationalFeed[]; message: string | null; historyError: string | null };

export function operationalClient() {
    if (DEMO_MODE) throw new Error('Operational cameras are local-only.');
    const token = sessionStorage.getItem('terminalsight-export-token');
    if (!token) throw new Error('Sign in locally to view operational cameras.');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const path = (id: string) => `/api/operational-cameras/${encodeURIComponent(id)}`;
    async function json(url: string, method = 'GET', body?: object): Promise<OperationalStatus> {
        const response = await fetch(url, { method, headers, cache: 'no-store', credentials: 'omit',
            signal: AbortSignal.timeout(10000), ...(body ? { body: JSON.stringify(body) } : {}) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Operational monitoring unavailable.');
        return data;
    }
    return {
        status: () => json('/api/operational-cameras'),
        control: (id: string, action: 'stop' | 'restart') => json(path(id), 'POST', { action }),
        async stream(id: string, signal: AbortSignal, display: (jpeg: Uint8Array) => void) {
            const response = await fetch(`${path(id)}/stream`, { headers, signal, cache: 'no-store', credentials: 'omit' });
            if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('multipart/x-mixed-replace')) throw new Error('Camera stream unavailable.');
            const reader = response.body.getReader(), parser = new JpegParts();
            try {
                while (!signal.aborted) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    const frame = parser.push(chunk.value).at(-1);
                    if (frame) display(frame.jpeg);
                }
            } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        },
    };
}
