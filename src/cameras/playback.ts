import { DEMO_MODE } from '../demo';

export type PlaybackProblem = { kind: 'missing' | 'http' | 'network' | 'format' | 'decode' | 'aborted'; message: string };

export function playbackProblem(code: number, status?: number, contentType = ''): PlaybackProblem {
    if (status === 404 || status === 410) return { kind: 'missing', message: 'Recording not found at its video URL. Restore the original file or refresh the catalog and select an available recording.' };
    if (status !== undefined && (status < 200 || status >= 300)) return { kind: 'http', message: `The video server returned HTTP ${status}. Check the local frontend server and file access, then retry.` };
    if (/text\/html|application\/json/i.test(contentType)) return { kind: 'http', message: 'The video URL returned a page or API response instead of video. Check the frontend server and sample-file path.' };
    if (code === 1) return { kind: 'aborted', message: 'Video loading was interrupted. Retry to reload this recording.' };
    if (code === 2) return { kind: 'network', message: 'The video download failed. Check the local frontend connection and retry.' };
    if (code === 3) return { kind: 'decode', message: 'The browser could not decode the recording. The codec/profile may be unsupported, or the file may be damaged. The original file has not been changed.' };
    return { kind: 'format', message: 'The browser cannot play this video source or codec. MP4 alone does not guarantee compatibility; HEVC support varies by browser and device. Try a compatible browser or an existing H.264 recording. No conversion was performed.' };
}

// Only inspect the local static media URL, without credentials or full downloads.
export async function inspectPlayback(url: string, code: number, signal: AbortSignal): Promise<PlaybackProblem> {
    if (DEMO_MODE || !/^\/(sample-CCTV|sample-videos)\//.test(url) || url.includes('..')) return playbackProblem(code);
    try {
        const response = await fetch(url, { method: 'HEAD', credentials: 'omit', cache: 'no-store', signal });
        if (response.status === 405 || response.status === 501) return playbackProblem(code); // HEAD unsupported; don't label a missing video.
        return playbackProblem(code, response.status, response.headers.get('content-type') ?? '');
    } catch {
        return code === 1 ? playbackProblem(code) : { kind: 'network', message: 'Cannot check the local video server. Check the frontend connection, then retry; file and codec support could not be verified.' };
    }
}
