import { useCallback, useEffect, useRef, useState } from 'react';
import { Bay } from '../types';
import { cloudEvents, EventGate, initialSystem } from './model';
import type { Notice, NoticeInput, SystemStatus } from './model';

const STORAGE = 'terminalsight-notifications-v1';
function restore(): { notices: Notice[]; active: string[] } {
    try {
        const value = JSON.parse(sessionStorage.getItem(STORAGE) || '{}');
        return { notices: Array.isArray(value.notices) ? value.notices.slice(0, 100) : [], active: Array.isArray(value.active) ? value.active : [] };
    } catch { return { notices: [], active: [] }; }
}

export function useNotifications(bays: Bay[], enabled: boolean, liveDataReady: boolean) {
    const [notices, setNotices] = useState<Notice[]>(() => restore().notices);
    const [banners, setBanners] = useState<Notice[]>([]);
    const [system, setSystem] = useState<SystemStatus>(initialSystem);
    const gate = useRef(new EventGate());
    const restored = useRef(false);
    if (!restored.current) {
        gate.current.active = new Set(restore().active);
        restored.current = true;
    }
    const audio = useRef<AudioContext | null>(null);
    const lastSound = useRef(0);
    const previousSystem = useRef<SystemStatus | null>(null);
    const sound = useCallback(() => {
        const context = audio.current;
        const now = Date.now();
        if (!context || context.state !== 'running' || now - lastSound.current < 10000) return;
        lastSound.current = now;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.frequency.setValueAtTime(740, context.currentTime);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
        oscillator.start(); oscillator.stop(context.currentTime + 0.32);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }, []);
    useEffect(() => {
        if (!enabled) return;
        const unlock = () => {
            try {
                audio.current ??= new AudioContext();
                void audio.current.resume().catch(() => {});
            } catch { /* Alerts remain visible when browser audio is unavailable. */ }
        };
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
            void audio.current?.close().catch(() => {}); audio.current = null;
        };
    }, [enabled]);
    const publish = useCallback((input: NoticeInput, ongoing = false) => {
        if (ongoing && !gate.current.accept(input.key)) return;
        const notice: Notice = { ...input, id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: Date.now(), read: false };
        setNotices(items => [notice, ...items].slice(0, 100));
        if (notice.priority === 'high') {
            setBanners(items => [...items, notice].slice(-20));
            sound();
        }
    }, [sound]);
    const resolve = useCallback((key: string) => {
        const existed = gate.current.resolve(key);
        if (existed) setBanners(items => items.filter(item => item.key !== key));
        return existed;
    }, []);
    useEffect(() => {
        try { sessionStorage.setItem(STORAGE, JSON.stringify({ notices, active: [...gate.current.active] })); } catch { /* Storage is optional. */ }
    }, [notices, bays, system]);
    useEffect(() => {
        if (!enabled || !liveDataReady) return;
        for (const bay of bays) {
            const prefix = `overstay:bay:${bay.id}`;
            const key = `${prefix}:${bay.sessionId || 'legacy'}`;
            for (const active of gate.current.active) {
                if ((active === prefix || active.startsWith(`${prefix}:`)) && active !== key) resolve(active);
            }
            if (bay.status === 'Overstaying') publish({ key, title: 'Overstay Violation', message: `Bay ${bay.id} (${bay.vehicleType || 'Vehicle'}) has exceeded its loading limit.`, priority: 'high', target: { kind: 'bay', id: bay.id } }, true);
            // Occupied may fluctuate around a threshold; only departure ends this episode.
            if (bay.status === 'Available' && resolve(key)) publish({ key: `${key}:resolved`, title: 'Bay Cleared', message: `Bay ${bay.id} is available again.`, priority: 'medium', target: { kind: 'bay', id: bay.id } });
        }
    }, [bays, enabled, liveDataReady, publish, resolve]);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        let controller: AbortController;
        const poll = async () => {
            controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetch('/api/system/status', { signal: controller.signal, cache: 'no-store' });
                if (!response.ok) throw new Error('Status unavailable');
                const next: SystemStatus = await response.json();
                if (!next.cloud || !Array.isArray(next.cameras) || next.local !== 'Online') throw new Error('Invalid status');
                if (cancelled) return;
                if (resolve('local:offline')) publish({ key: 'local:restored', title: 'Local System Restored', message: 'The local backend is responding again.', priority: 'medium', target: { kind: 'system' } });
                if (next.ocr?.state === 'Failed') publish({ key: 'ocr:failed', title: 'Route Recognition Unavailable', message: 'The local OCR service needs attention. Vehicle detection, timers and bay monitoring continue. Check the edge server OCR setup.', priority: 'high', target: { kind: 'system' } }, true);
                else if (next.ocr?.state === 'Ready' && resolve('ocr:failed')) publish({ key: 'ocr:restored', title: 'Route Recognition Restored', message: 'The local OCR service is available again.', priority: 'medium', target: { kind: 'system' } });
                for (const camera of next.cameras) {
                    const key = `camera:${camera.id}`;
                    if (camera.state === 'Disconnected' || camera.state === 'Unstable') publish({ key, title: camera.state === 'Disconnected' ? 'Camera Disconnected' : 'Camera Feed Unstable', message: `${camera.name}: ${camera.state.toLowerCase()}. Inspect the camera connection.`, priority: 'high', target: { kind: 'camera', id: camera.id } }, true);
                    else if (camera.state === 'Live' && resolve(key)) publish({ key: `${key}:restored`, title: 'Camera Reconnected', message: `${camera.name} is receiving frames again.`, priority: 'medium', target: { kind: 'camera', id: camera.id } });
                    else if (camera.state === 'Disabled') resolve(key);
                }
                if (next.cloud.connection !== 'Offline') resolve('cloud:offline');
                if (next.cloud.state !== 'Sync Error') resolve('cloud:error');
                for (const event of cloudEvents(previousSystem.current?.cloud ?? null, next.cloud)) publish(event, event.priority === 'high');
                previousSystem.current = next;
                setSystem(next);
            } catch {
                if (cancelled) return;
                setSystem(previous => ({ ...previous, local: 'Offline' }));
                publish({ key: 'local:offline', title: 'Local Backend Unreachable', message: 'Live monitoring cannot be verified. Displayed bay data may be stale. Check the edge server.', priority: 'high', target: { kind: 'system' } }, true);
            } finally {
                clearTimeout(timeout);
                if (!cancelled) timer = setTimeout(poll, 3000);
            }
        };
        void poll();
        return () => { cancelled = true; controller?.abort(); clearTimeout(timer); };
    }, [enabled, publish, resolve]);
    useEffect(() => {
        if (!enabled) return;
        const handler = () => publish({ key: `csv:${Date.now()}`, title: 'CSV Export Ready', message: 'The occupancy CSV download has started.', priority: 'low' });
        window.addEventListener('terminalsight:csv-exported', handler);
        return () => window.removeEventListener('terminalsight:csv-exported', handler);
    }, [enabled, publish]);
    const dismiss = useCallback((id: string) => setBanners(items => items.filter(item => item.id !== id)), []);
    const markRead = (id: string) => setNotices(items => items.map(item => item.id === id ? { ...item, read: true } : item));
    const markAllRead = () => setNotices(items => items.map(item => ({ ...item, read: true })));
    const testNotification = (scenario: 'overstay' | 'camera' | 'cloud' | 'info' | 'resolve') => {
        if (!import.meta.env.DEV) return;
        if (scenario === 'resolve') {
            for (const key of ['test:overstay', 'test:camera', 'test:cloud']) resolve(key);
            publish({ key: 'test:recovery', title: '[TEST] Issues Resolved', message: 'Test alerts are reset. Trigger one again to test a new incident.', priority: 'medium' });
            return;
        }
        const samples: Record<Exclude<typeof scenario, 'resolve'>, NoticeInput> = {
            overstay: { key: 'test:overstay', title: '[TEST] Overstay Violation', message: 'Demo alert for Bay 1. Its actual occupancy and timer are unchanged.', priority: 'high', target: { kind: 'bay', id: 1 } },
            camera: { key: 'test:camera', title: '[TEST] Camera Disconnected', message: 'Demo alert for Northbound Cam 1. The video keeps running.', priority: 'high', target: { kind: 'camera', id: 1 } },
            cloud: { key: 'test:cloud', title: '[TEST] Cloud Connection Lost', message: 'Demo cloud alert. Open system details to inspect the actual connection status.', priority: 'high', target: { kind: 'system' } },
            info: { key: 'test:info', title: '[TEST] CSV Export Complete', message: 'Quiet informational test. No file was downloaded.', priority: 'low' },
        };
        publish(samples[scenario], scenario !== 'info');
    };
    return { notices, banners, system, dismiss, markRead, markAllRead, testNotification };
}
