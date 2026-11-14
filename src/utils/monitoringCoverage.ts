import { DEMO_MODE } from '../demo';
import type { Bay } from '../types';

export function isSampleMonitoredBay(bay: Pick<Bay, 'monitored' | 'status'>): boolean {
    return bay.status !== 'Unmonitored' && (DEMO_MODE || bay.monitored === true);
}
