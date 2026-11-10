import { env } from 'node:process';
import { authorizeHostedAdmin } from '../../server/hostedAuthorization.ts';

// Vercel Node.js Web Standard handler; no Flask, SQLite, or service-role access.
export default {
    fetch(request: Request) {
        return authorizeHostedAdmin(request, {
            url: env.SUPABASE_URL,
            publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
        });
    },
};
