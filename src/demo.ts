import type { Bay } from './types';
import { initialBays } from './mockData';

// Explicit build-time opt-in; never infer demo mode from a backend outage.
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
export const DEMO_DESCRIPTION = 'Illustrative data only. No live terminal connection. Timers are fixed examples; cameras, account changes and saved-record exports require the local system.';

export const demoBays: Bay[] = initialBays.map(bay => bay.id === 1 ? {
    ...bay, status: 'Occupied', vehicleType: 'UV Express', route: 'Panabo - Davao',
    ocrState: 'Recognized', timeRemaining: 600, elapsedSeconds: 300, sessionId: 'demo-bay-1',
} : { ...bay });
