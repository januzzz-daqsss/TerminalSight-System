import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudEvents, EventGate, initialSystem } from '../src/notifications/model.ts';

test('one banner per ongoing issue; dismissal/read do not rearm; resolution does', () => {
    const gate = new EventGate();
    assert.equal(gate.accept('overstay:bay:6'), true);
    for (let poll = 0; poll < 100; poll++) assert.equal(gate.accept('overstay:bay:6'), false);
    assert.equal(gate.accept('overstay:bay:1'), true);
    assert.equal(gate.resolve('overstay:bay:6'), true);
    assert.equal(gate.accept('overstay:bay:6'), true);
});
test('cloud outage, recovery, sync and completion have correct priority and no repeated events', () => {
    const online = { ...initialSystem.cloud, configured: true, connection: 'Online', state: 'Synced' };
    const offline = { ...online, connection: 'Offline', state: 'Offline', pending_records: 42 };
    assert.equal(cloudEvents(online, offline)[0].priority, 'high');
    assert.deepEqual(cloudEvents(offline, offline), []);
    const syncing = { ...offline, connection: 'Online', state: 'Syncing' };
    assert.deepEqual(cloudEvents(offline, syncing).map(item => item.priority), ['medium', 'medium']);
    const completed = { ...online, completion_id: 'batch-1', completed_records: 42, pending_records: 0 };
    assert.equal(cloudEvents(syncing, completed)[0].priority, 'low');
    assert.match(cloudEvents(syncing, completed)[0].message, /42/);
    assert.deepEqual(cloudEvents(completed, completed), []);
    assert.equal(cloudEvents(completed, offline)[0].priority, 'high');
});
test('sync errors alert once and recovery remains nonintrusive', () => {
    const syncing = { ...initialSystem.cloud, configured: true, connection: 'Online', state: 'Syncing' };
    const failure = { ...syncing, state: 'Sync Error', last_result: 'Upload rejected' };
    assert.equal(cloudEvents(syncing, failure)[0].priority, 'high');
    assert.deepEqual(cloudEvents(failure, failure), []);
    assert.ok(cloudEvents(failure, syncing).every(item => item.priority === 'medium'));
});
test('unconfigured cloud never produces a fake outage or successful sync', () => {
    assert.deepEqual(cloudEvents(null, initialSystem.cloud), []);
});
