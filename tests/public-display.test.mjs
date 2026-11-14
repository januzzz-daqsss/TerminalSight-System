import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let server, display;
before(async () => {
    server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
    display = await server.ssrLoadModule('/src/utils/publicDisplay.ts');
});
after(async () => { await server?.close(); });

test('passenger states and times use shared server values, including the zero boundary', () => {
    const bay = { id: 1, type: 'Northbound', status: 'Occupied', timeRemaining: 42 };
    assert.equal(display.passengerStatus(bay), 'BOARDING');
    assert.equal(display.publicTimer(bay), '00:42');
    assert.equal(display.passengerStatus({ ...bay, timeRemaining: 0 }), 'DEPARTING');
    assert.equal(display.passengerStatus({ ...bay, status: 'Overstaying', timeRemaining: -1 }), 'DELAYED');
    assert.equal(display.publicTimer({ ...bay, status: 'Overstaying', timeRemaining: -1 }), '00:00');
    assert.equal(display.routeLabel({ ...bay, route: 'Panabo - Tagum' }), 'Panabo → Tagum');
    assert.equal(display.routeLabel({ ...bay, ocrState: 'Unknown' }), 'Route Unknown');
    assert.equal(display.routeLabel({ ...bay, status: 'Available', route: 'Old route' }), '—');
});
test('passenger list renders recognized, detecting, unknown and stale-data states without OCR debug', async () => {
    const { PublicView } = await server.ssrLoadModule('/src/components/views/PublicView.tsx');
    const bays = [
        { id: 1, status: 'Occupied', vehicleType: 'Bus', route: 'Panabo - Davao', routeDetails: ['MA-A', 'NCCC', 'SM CITY', 'BUHANGIN'], timeRemaining: 120 },
        { id: 1, status: 'Occupied', vehicleType: 'UV Express', ocrState: 'Detecting', timeRemaining: 0 },
        { id: 6, status: 'Overstaying', ocrState: 'Unknown', timeRemaining: -1 },
        { id: 6, status: 'Available', route: 'Old route', routeDetails: ['Stale destination'] },
    ];
    // Render each state independently within the current sample-camera coverage.
    const html = bays.map(bay => renderToStaticMarkup(createElement(PublicView, { bays: [{ ...bay, monitored: true }], now: new Date(0), live: false }))).join('');
    for (const text of ['Panabo → Davao', 'Route Detecting...', 'Route Unknown', 'BOARDING', 'DEPARTING', 'DELAYED', 'AVAILABLE', 'Live updates unavailable']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('ocrDebug'));
    assert.ok(html.includes('· MA-A · NCCC · SM CITY · BUHANGIN'));
    assert.ok(!html.includes('Stale destination'));
});
test('driver display keeps bay-card/map presentation and adds route and timer', async () => {
    const { PublicSignageView } = await server.ssrLoadModule('/src/components/views/PublicSignageView.tsx');
    const html = renderToStaticMarkup(createElement(PublicSignageView, { bays: [{ monitored: true, id: 6, type: 'Southbound', status: 'Occupied', vehicleType: 'Bus', route: 'Panabo - Davao', timeRemaining: 120 }], now: new Date(0), live: true }));
    for (const text of ['ROAD LANE', 'Panabo → Davao', '02:00', 'BOARDING']) assert.ok(html.includes(text), text);
});

test('sample coverage never presents unmonitored bays as available or counts them in summaries', async () => {
    const { PublicView } = await server.ssrLoadModule('/src/components/views/PublicView.tsx');
    const { PublicSignageView } = await server.ssrLoadModule('/src/components/views/PublicSignageView.tsx');
    const { DashboardView } = await server.ssrLoadModule('/src/components/views/DashboardView.tsx');
    const bays = Array.from({ length: 10 }, (_, index) => ({
        monitored: [0, 5].includes(index), id: index + 1, type: index < 5 ? 'Northbound' : 'Southbound', status: 'Available', timeRemaining: 0,
    }));
    bays[0] = { ...bays[0], status: 'Occupied', vehicleType: 'Bus', route: 'Panabo - Davao', timeRemaining: 120 };
    const before = JSON.stringify(bays);
    const props = { bays, now: new Date(0), live: true };
    const passenger = renderToStaticMarkup(createElement(PublicView, props));
    const driver = renderToStaticMarkup(createElement(PublicSignageView, props));
    const dashboard = renderToStaticMarkup(createElement(DashboardView, { bays }));
    for (const html of [passenger, driver]) {
        assert.equal((html.match(/NOT MONITORED/g) || []).length, 8);
        assert.ok(html.includes('02:00'));
        assert.ok(html.includes('Panabo → Davao'));
        assert.ok(html.includes('Sample-video demonstration.'));
    }
    assert.equal((dashboard.match(/>Not monitored</g) || []).length, 8);
    assert.match(dashboard, /Available Slots<\/span><span[^>]*>1<\/span>/);
    assert.match(dashboard, /Occupied Slots<\/span><span[^>]*>1<\/span>/);
    assert.ok(dashboard.includes('Sample Detections'));
    assert.ok(!dashboard.includes('YOLOv8 Live'));
    assert.ok(driver.includes('BAY 6 IS OPEN'));
    for (const id of [2, 3, 4, 5, 7, 8, 9, 10]) assert.ok(!driver.includes(`BAY ${id} IS OPEN`));
    assert.equal(JSON.stringify(bays), before, 'presentation must not mutate backend snapshots');
});

test('disconnected sample signage does not issue instructions from retained data', async () => {
    const { PublicSignageView } = await server.ssrLoadModule('/src/components/views/PublicSignageView.tsx');
    const bays = [
        { id: 1, type: 'Northbound', status: 'Available', timeRemaining: 0 },
        { id: 6, type: 'Southbound', status: 'Overstaying', timeRemaining: -10 },
    ];
    const html = renderToStaticMarkup(createElement(PublicSignageView, { bays, now: new Date(0), live: false }));
    assert.ok(html.includes('Bay information is not current.'));
    assert.ok(!html.includes('IS OPEN FOR'));
    assert.ok(!html.includes('PLEASE DEPART IMMEDIATELY'));
});

test('coverage follows healthy workers for all ten bays and fails closed without metadata', async () => {
    const { PublicView } = await server.ssrLoadModule('/src/components/views/PublicView.tsx');
    const { DashboardView } = await server.ssrLoadModule('/src/components/views/DashboardView.tsx');
    const bays = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, monitored: true,
        type: i < 5 ? 'Northbound' : 'Southbound', status: 'Available' }));
    const html = renderToStaticMarkup(createElement(PublicView, { bays, now: new Date(0), live: true }));
    assert.equal((html.match(/NOT MONITORED/g) || []).length, 0);
    assert.equal((html.match(/>AVAILABLE</g) || []).length, 10);
    bays[9].monitored = false;
    const dashboard = renderToStaticMarkup(createElement(DashboardView, { bays }));
    assert.equal((dashboard.match(/>Not monitored</g) || []).length, 1);
    assert.match(dashboard, /Available Slots<\/span><span[^>]*>9<\/span>/);
    const unknown = renderToStaticMarkup(createElement(PublicView, { bays: [{ id: 1, status: 'Available' }], now: new Date(0), live: true }));
    assert.ok(unknown.includes('NOT MONITORED'));
});
