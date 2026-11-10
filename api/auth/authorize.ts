import { env } from 'node:process';
import { createClient } from '@supabase/supabase-js';

type Configuration = { url?: string; publishableKey?: string };
const reply = (status: number, body: object) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', 'Vary': 'Authorization' },
});

// Keep this small gate in the entry point: emitted ESM must not import local .ts files.
// Never decode a caller's claims as proof of identity.
export async function authorizeHostedAdmin(
    request: Request, configuration: Configuration, upstreamFetch: typeof fetch = fetch,
): Promise<Response> {
    if (request.method !== 'GET') {
        const response = reply(405, { authorized: false, message: 'Method not allowed.' });
        response.headers.set('Allow', 'GET');
        return response;
    }
    const match = /^Bearer ([^\s,]+)$/i.exec(request.headers.get('Authorization') ?? '');
    if (!match) return reply(401, { authorized: false, message: 'Authentication required.' });
    const { url, publishableKey } = configuration;
    try {
        if (!url || !publishableKey?.startsWith('sb_publishable_') || new URL(url).protocol !== 'https:') {
            return reply(503, { authorized: false, message: 'Hosted authentication is not configured.' });
        }
        // One stateless client per request: no session persistence or cross-user state.
        const client = createClient(url, publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { fetch: (input, init) => upstreamFetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
        });
        const { data, error } = await client.auth.getUser(match[1]);
        if (error) {
            const status = error.status === 400 || error.status === 401 || error.status === 403 ? 401 : 503;
            return reply(status, { authorized: false, message: status === 401 ? 'Invalid or expired session.' : 'Authorization service unavailable.' });
        }
        if (!data.user?.id) return reply(401, { authorized: false, message: 'Invalid session.' });
        if (data.user.app_metadata?.role !== 'admin') {
            return reply(403, { authorized: false, message: 'Administrator access required.' });
        }
        // Do not return tokens, email addresses, or arbitrary metadata.
        return reply(200, { authorized: true, user: { id: data.user.id } });
    } catch {
        return reply(503, { authorized: false, message: 'Authorization service unavailable.' });
    }
}

// Vercel Node.js Web Standard handler; no Flask, SQLite, or service-role access.
export default {
    fetch(request: Request) {
        return authorizeHostedAdmin(request, {
            url: env.SUPABASE_URL,
            publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
        });
    },
};
