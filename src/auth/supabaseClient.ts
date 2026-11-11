import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export const HOSTED_AUTH_OPTIONS = {
    flowType: 'implicit',
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'terminalsight-hosted-auth',
} as const;

// Lazy: importing this module never contacts Supabase or reads local Flask tokens.
export function getHostedSupabaseClient(): SupabaseClient | null {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim();
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
    if (!url || !key) return null;
    try {
        if (!key.startsWith('sb_publishable_') || new URL(url).protocol !== 'https:') return null;
    } catch { return null; }
    client ??= createClient(url, key, {
        // Memory-only sessions; callbacks are explicitly consumed on /auth/callback.
        auth: HOSTED_AUTH_OPTIONS,
    });
    return client;
}
