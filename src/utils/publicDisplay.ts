import type { Bay } from '../types';
import { formatTimer } from './helpers';

export function passengerStatus(bay: Bay): 'AVAILABLE' | 'BOARDING' | 'DEPARTING' | 'DELAYED' {
    if (bay.status === 'Available') return 'AVAILABLE';
    if (bay.status === 'Overstaying' || (bay.timeRemaining != null && bay.timeRemaining < 0)) return 'DELAYED';
    if (bay.timeRemaining === 0) return 'DEPARTING';
    return 'BOARDING';
}
export function routeLabel(bay: Bay): string {
    if (bay.status === 'Available') return '\u2014';
    if (bay.route) return bay.route.replace(/\s+-\s+/g, ' \u2192 ');
    return bay.ocrState === 'Unknown' ? 'Route Unknown' : 'Route Detecting...';
}
export function publicTimer(bay: Bay): string {
    if (bay.status === 'Available' || bay.timeRemaining == null) return '\u2014';
    return formatTimer(Math.max(0, bay.timeRemaining));
}
export const publicStatusClasses = {
    AVAILABLE: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/40',
    BOARDING: 'text-amber-300 bg-amber-400/10 border-amber-400/40',
    DEPARTING: 'text-orange-200 bg-orange-500/20 border-orange-400/60',
    DELAYED: 'text-red-300 bg-red-500/20 border-red-400/50',
};
