export type Priority = 'high' | 'medium' | 'low';
export type Target = { kind: 'bay' | 'camera'; id: number } | { kind: 'system' };
export interface Notice {
    id: string;
    key: string;
    title: string;
    message: string;
    priority: Priority;
    target?: Target;
    createdAt: number;
    read: boolean;
}
export interface CloudStatus {
    configured: boolean;
    connection: 'Online' | 'Offline' | 'Not configured';
    state: 'Synced' | 'Syncing' | 'Pending' | 'Offline' | 'Sync Error' | 'Not configured';
    last_successful_sync: string | null;
    pending_records: number | null;
    last_result: string;
    completed_records: number;
    completion_id: string | null;
}
export interface CameraHealth {
    id: number;
    name: string;
    state: 'Disabled' | 'Starting' | 'Live' | 'Unstable' | 'Disconnected';
}
export interface SystemStatus {
    local: 'Online' | 'Offline' | 'Checking';
    cameras: CameraHealth[];
    ocr?: { state: 'Starting' | 'Ready' | 'Failed' | 'Disabled'; message: string | null };
    cloud: CloudStatus;
}
export const initialSystem: SystemStatus = {
    local: 'Checking', cameras: [], cloud: {
        configured: false, connection: 'Not configured', state: 'Not configured',
        last_successful_sync: null, pending_records: null,
        last_result: 'Waiting for local backend status.', completed_records: 0, completion_id: null,
    },
};
export type NoticeInput = Omit<Notice, 'id' | 'createdAt' | 'read'>;

/** One banner per active issue. Resolving an issue rearms its stable key. */
export class EventGate {
    active = new Set<string>();
    accept(key: string) {
        if (this.active.has(key)) return false;
        this.active.add(key);
        return true;
    }
    resolve(key: string) { return this.active.delete(key); }
}

export function cloudEvents(previous: CloudStatus | null, next: CloudStatus): NoticeInput[] {
    if (!next.configured) return [];
    const events: NoticeInput[] = [];
    const add = (key: string, title: string, message: string, priority: Priority) =>
        events.push({ key, title, message, priority, target: { kind: 'system' } });
    if (next.connection === 'Offline' && previous?.connection !== 'Offline')
        add('cloud:offline', 'Cloud Connection Lost', 'TerminalSight is operating locally. New records will synchronize when connectivity is restored.', 'high');
    if (next.connection === 'Online' && previous?.connection === 'Offline')
        add('cloud:restored', 'Cloud Connection Restored', next.pending_records ? `${next.pending_records} locally stored records are awaiting synchronization.` : 'Cloud connection is available again.', 'medium');
    if (next.state === 'Sync Error' && previous?.state !== 'Sync Error')
        add('cloud:error', 'Cloud Sync Failed', next.last_result, 'high');
    if (previous?.state === 'Sync Error' && next.state !== 'Sync Error' && next.connection === 'Online')
        add('cloud:error-resolved', 'Cloud Sync Issue Resolved', 'The sync service has recovered from its previous error.', 'medium');
    if (next.state === 'Syncing' && previous?.state !== 'Syncing')
        add('cloud:syncing', 'Cloud Sync Started', `Synchronizing ${next.pending_records ?? 'pending'} locally stored records.`, 'medium');
    if (next.state === 'Synced' && next.completion_id && next.completion_id !== previous?.completion_id)
        add(`cloud:complete:${next.completion_id}`, 'Cloud Sync Complete', `${next.completed_records} records successfully synchronized.`, 'low');
    return events;
}
