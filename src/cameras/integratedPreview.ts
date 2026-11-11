import { DEMO_MODE } from '../demo';

export type PreviewState = { id: string; generation: number; seconds: number; duration: number;
    paused: boolean; loop: boolean; status: string; sourceFps: number; inferenceFps: number;
    stopped: boolean; runtime: { model: string; device: string } | null };

/** Bounded multipart parser, independent of network chunk boundaries. */
export class JpegParts {
    private pending = new Uint8Array(0);
    push(chunk: Uint8Array): { jpeg: Uint8Array; generation: number }[] {
        if (this.pending.length + chunk.length > 4_194_304) throw new Error('Preview response exceeded its size limit.');
        const combined = new Uint8Array(this.pending.length + chunk.length);
        combined.set(this.pending); combined.set(chunk, this.pending.length); this.pending = combined;
        const frames = [];
        while (true) {
            let end = -1;
            for (let i = 0; i + 3 < this.pending.length; i++) {
                if (this.pending[i] === 13 && this.pending[i + 1] === 10 && this.pending[i + 2] === 13 && this.pending[i + 3] === 10) { end = i; break; }
            }
            if (end < 0) { if (this.pending.length > 4096) throw new Error('Invalid preview headers.'); break; }
            const headers = new TextDecoder().decode(this.pending.slice(0, end));
            const length = Number(/Content-Length: (\d+)/i.exec(headers)?.[1]);
            const generation = Number(/X-Generation: (\d+)/i.exec(headers)?.[1]);
            if (!headers.trimStart().startsWith('--frame\r\n') || !Number.isInteger(length) || length < 1 || length > 2_097_152 || !Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid preview frame.');
            if (this.pending.length < end + 4 + length + 2) break;
            frames.push({ jpeg: this.pending.slice(end + 4, end + 4 + length), generation });
            this.pending = this.pending.slice(end + 4 + length + 2);
        }
        return frames;
    }
}

export function createIntegratedClient() {
    if (DEMO_MODE) throw new Error('Integrated monitoring is local-only.');
    const token = sessionStorage.getItem('terminalsight-export-token');
    if (!token) throw new Error('Sign in locally to monitor this recording.');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const path = (id: string) => `/api/sample-preview/${encodeURIComponent(id)}`;
    async function json(url: string, method = 'GET', body?: object): Promise<PreviewState> {
        const response = await fetch(url, { method, headers, credentials: 'omit', cache: 'no-store',
            signal: AbortSignal.timeout(10000), ...(body ? { body: JSON.stringify(body) } : {}) });
        const data = await response.json().catch(() => { throw new Error('Restart the updated local backend.'); });
        if (!response.ok) throw new Error(data.message || 'Local preview unavailable.');
        return data;
    }
    return {
        start: (feedId: string) => json('/api/sample-preview', 'POST', { feedId }),
        status: (id: string) => json(path(id)),
        control: (id: string, data: object) => json(path(id), 'PATCH', data),
        stop: (id: string) => json(path(id), 'DELETE'),
        async stream(id: string, signal: AbortSignal, frame: (jpeg: Uint8Array, generation: number) => void) {
            const response = await fetch(`${path(id)}/stream`, { headers, signal, credentials: 'omit', cache: 'no-store' });
            if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('multipart/x-mixed-replace')) throw new Error('Authenticated preview stream unavailable.');
            const reader = response.body.getReader(), parser = new JpegParts();
            try {
                while (!signal.aborted) {
                    const value = await reader.read();
                    if (value.done) break;
                    const frames = parser.push(value.value);
                    // If several frames arrived together, paint only the newest one.
                    const latest = frames.at(-1);
                    if (latest) frame(latest.jpeg, latest.generation);
                }
            } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        },
    };
}
