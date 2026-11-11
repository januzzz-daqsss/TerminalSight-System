import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getHostedSupabaseClient } from './supabaseClient';
import { createHostedAuthStore } from './hostedAuthStore';

type Store = ReturnType<typeof createHostedAuthStore>;
const HostedAuthContext = createContext<Store | null>(null);

// Mounted only on hosted administrator and callback routes.
export function HostedAuthProvider({ children }: { children: ReactNode }) {
    const [store] = useState(() => createHostedAuthStore(getHostedSupabaseClient()?.auth ?? null));
    useEffect(() => store.start(), [store]);
    return <HostedAuthContext.Provider value={store}>{children}</HostedAuthContext.Provider>;
}

export function useHostedAuth() {
    const store = useContext(HostedAuthContext);
    if (!store) throw new Error('useHostedAuth requires HostedAuthProvider.');
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    return { ...state, refreshSession: store.refreshSession, logout: store.logout };
}
