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
        { id: 2, status: 'Occupied', vehicleType: 'UV Express', ocrState: 'Detecting', timeRemaining: 0 },
        { id: 3, status: 'Overstaying', ocrState: 'Unknown', timeRemaining: -1 },
        { id: 4, status: 'Available', route: 'Old route', routeDetails: ['Stale destination'] },
    ];
    const html = renderToStaticMarkup(createElement(PublicView, { bays, now: new Date(0), live: false }));
    for (const text of ['Panabo → Davao', 'Route Detecting...', 'Route Unknown', 'BOARDING', 'DEPARTING', 'DELAYED', 'AVAILABLE', 'Live updates unavailable']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('ocrDebug'));
    assert.ok(html.includes('· MA-A · NCCC · SM CITY · BUHANGIN'));
    assert.ok(!html.includes('Stale destination'));
});
test('driver display keeps bay-card/map presentation and adds route and timer', async () => {
    const { PublicSignageView } = await server.ssrLoadModule('/src/components/views/PublicSignageView.tsx');
    const html = renderToStaticMarkup(createElement(PublicSignageView, { bays: [{ id: 6, type: 'Southbound', status: 'Occupied', vehicleType: 'Bus', route: 'Panabo - Davao', timeRemaining: 120 }], now: new Date(0), live: true }));
    for (const text of ['ROAD LANE', 'Panabo → Davao', '02:00', 'BOARDING']) assert.ok(html.includes(text), text);
});
