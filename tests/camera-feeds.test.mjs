import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let server, api;
before(async () => {
    server = await createServer({ mode: 'production', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, ws: false }, appType: 'custom' });
    api = await server.ssrLoadModule('/src/cameras/feedApi.ts');
});
after(async () => { await server?.close(); });

test('feed requests require a local token and never store feed configuration', async t => {
    const previousFetch = globalThis.fetch;
    const previousStorage = globalThis.sessionStorage;
    t.after(() => { globalThis.fetch = previousFetch; globalThis.sessionStorage = previousStorage; });
    globalThis.sessionStorage = { getItem: () => null };
    globalThis.fetch = () => assert.fail('Unauthenticated request reached network');
    await assert.rejects(api.feedRequest(), /sign in locally/);
    globalThis.sessionStorage = {
        getItem: key => { assert.equal(key, 'terminalsight-export-token'); return 'fixture-local-token'; },
        setItem: () => assert.fail('Do not persist camera details in frontend storage'),
    };
    const draft = { ...api.emptyFeed('live'), name: 'Fixture', address: 'rtsp://camera.example.test/stream' };
    const calls = [];
    globalThis.fetch = async (path, options) => {
        calls.push(options.method);
        assert.ok(path.startsWith('/api/camera-feeds'));
        assert.equal(options.headers.Authorization, 'Bearer fixture-local-token');
        assert.equal(options.cache, 'no-store');
        assert.equal(options.credentials, 'omit');
        if (options.body) assert.deepEqual(JSON.parse(options.body), draft);
        return Response.json({ feeds: [], feed: { id: 'fixture', ...draft } });
    };
    await api.feedRequest();
    await api.feedRequest('', 'POST', draft);
    await api.feedRequest('/fixture', 'PATCH', draft);
    await api.feedRequest('/fixture', 'DELETE');
    assert.deepEqual(calls, ['GET', 'POST', 'PATCH', 'DELETE']);
});

test('backend errors and missing updated API are shown without treating writes as successful', async t => {
    const previousFetch = globalThis.fetch, previousStorage = globalThis.sessionStorage;
    t.after(() => { globalThis.fetch = previousFetch; globalThis.sessionStorage = previousStorage; });
    globalThis.sessionStorage = { getItem: () => 'fixture' };
    globalThis.fetch = async () => Response.json({ message: 'Please sign in locally.' }, { status: 401 });
    await assert.rejects(api.feedRequest(), /sign in locally/);
    globalThis.fetch = async () => new Response('<html>old backend</html>');
    await assert.rejects(api.feedRequest(), /Restart the updated local backend/);
});

test('local editor offers two modes, direction/bays, video picker and safe removal', async () => {
    const { CameraZonesView } = await server.ssrLoadModule('/src/components/views/CameraZonesView.tsx');
    const html = renderToStaticMarkup(createElement(CameraZonesView, { health: [], localOnline: true, canConfigure: true }));
    for (const text of ['LIVE FEED', 'SAMPLE DEMONSTRATION', 'Select a sample video', 'Terminal direction', 'Assigned bays',
        'Remove feed configuration?', 'original video', 'Sample Demonstration feeds', 'AI Detection']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('Existing detection previews'));
    assert.equal((html.match(/id="camera-1"/g) || []).length, 1);
    assert.equal((html.match(/id="camera-2"/g) || []).length, 1);
    assert.ok(html.indexOf('aria-label="Sample Demonstration feeds"') < html.indexOf('id="camera-1"'));
    assert.ok(!html.includes('OPERATIONAL BAY STATE') && !html.includes('SAMPLE ONLY'));
    assert.ok(!html.includes('type="password"'));
});

test('all ten bay labels are visible and saved selections remain direction-compatible', async () => {
    const { BayLabelSelector } = await server.ssrLoadModule('/src/components/views/CameraZonesView.tsx');
    for (const [direction, bays] of [['northbound', [1, 3, 5]], ['southbound', [6, 8, 10]]]) {
        const html = renderToStaticMarkup(createElement(BayLabelSelector, { direction, bays, onChange: () => {} }));
        for (let bay = 1; bay <= 10; bay++) assert.ok(html.includes(`Bay ${bay}</label>`));
        assert.equal((html.match(/type="checkbox"/g) || []).length, 10);
        assert.equal((html.match(/checked=""/g) || []).length, 3);
        assert.equal((html.match(/<fieldset disabled=""/g) || []).length, 1);
    }
});

test('ROI editor preserves legacy associations and provides explicit unmapped playback and registration instructions', async () => {
    const { RoiMappingPicker } = await server.ssrLoadModule('/src/components/ui/RoiMappingPicker.tsx');
    assert.equal(api.emptyFeed('sample').roiId, '');
    assert.equal(Object.hasOwn(api.emptyFeed('live'), 'roiId'), false);
    const fresh = renderToStaticMarkup(createElement(RoiMappingPicker, { draft: api.emptyFeed('sample'), onChange: () => {} }));
    for (const label of ['Parking-bay mapping', 'No mapping', 'video playback only', 'Refresh mapping list',
        'config/roi', 'browser cannot launch', 'does not activate detection']) assert.ok(fresh.includes(label), label);
    assert.ok(!fresh.includes('Keep existing recording association'));
    const { roiId, ...legacy } = api.emptyFeed('sample');
    const existing = renderToStaticMarkup(createElement(RoiMappingPicker, { draft: legacy, onChange: () => {} }));
    assert.ok(existing.includes('Keep existing recording association'));
    const missing = renderToStaticMarkup(createElement(RoiMappingPicker, { draft: { ...legacy, roiId: 'missing.json' }, onChange: () => {} }));
    assert.ok(missing.includes('Saved mapping unavailable: missing.json'));
});

test('ordinary sample players render independently without AI requests or extension gating', async () => {
    const { SamplePlayer } = await server.ssrLoadModule('/src/components/ui/SamplePlayer.tsx');
    const children = ['one.mp4', 'two.avi'].map((filename, i) => createElement(SamplePlayer, { key: filename,
        autoPlay: true, loop: true, video: { id: filename, filename, directory: 'sample-CCTV', url: `/sample-CCTV/${filename}`, preview: i === 0 } }));
    const html = renderToStaticMarkup(createElement('div', {}, ...children));
    assert.equal((html.match(/<video /g) || []).length, 2);
    assert.ok(html.includes('/sample-CCTV/one.mp4') && html.includes('/sample-CCTV/two.avi'));
    assert.ok(html.includes('controls=""') && html.includes('object-contain'));
    for (const attribute of ['autoPlay=""', 'muted=""', 'loop=""', 'playsInline=""']) assert.equal(html.split(attribute).length - 1, 2, attribute);
    assert.ok(!html.includes('/api/sample-ai') && !html.includes('data:image'));
});

test('playback diagnostics separate missing/HTTP/network/codec/decode errors', async t => {
    const { inspectPlayback, playbackProblem } = await server.ssrLoadModule('/src/cameras/playback.ts');
    assert.equal(playbackProblem(4, 404).kind, 'missing');
    assert.equal(playbackProblem(4, 403).kind, 'http');
    assert.equal(playbackProblem(4, 200, 'text/html').kind, 'http');
    assert.equal(playbackProblem(2, 200, 'video/mp4').kind, 'network');
    assert.equal(playbackProblem(3, 200, 'video/mp4').kind, 'decode');
    assert.equal(playbackProblem(4, 200, 'video/mp4').kind, 'format');
    const oldFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = oldFetch; });
    globalThis.fetch = async (url, options) => {
        assert.equal(url, '/sample-CCTV/Bays%202-5.mp4');
        assert.equal(options.method, 'HEAD');
        assert.equal(options.credentials, 'omit');
        return new Response(null, { status: 404 });
    };
    assert.equal((await inspectPlayback('/sample-CCTV/Bays%202-5.mp4', 4, new AbortController().signal)).kind, 'missing');
    globalThis.fetch = () => assert.fail('Do not probe external or traversal URLs');
    await inspectPlayback('https://example.test/video.mp4', 4, new AbortController().signal);
    await inspectPlayback('/sample-CCTV/../secret', 4, new AbortController().signal);
});

test('existing processed previews retain worker URLs and AI-disabled sample fallback', async () => {
    const { ProcessedSampleFeeds } = await server.ssrLoadModule('/src/components/ui/ProcessedSampleFeeds.tsx');
    const live = renderToStaticMarkup(createElement(ProcessedSampleFeeds, { localOnline: true, health: [{ id: 1, state: 'Live' }, { id: 2, state: 'Live' }] }));
    assert.ok(live.includes('/video_feed/northbound_cam1'));
    assert.ok(live.includes('/video_feed/southbound_cam1'));
    assert.ok(live.includes('Fullscreen Northbound Cam 1'));
    const disabled = renderToStaticMarkup(createElement(ProcessedSampleFeeds, { localOnline: true, health: [{ id: 1, state: 'Disabled' }, { id: 2, state: 'Disabled' }] }));
    assert.equal((disabled.match(/<video /g) || []).length, 2);
    assert.ok(disabled.includes('/sample-videos/'));
});

test('hosted camera API cannot read storage or send privileged requests even when called directly', async () => {
    const hosted = await createServer({ mode: 'demo', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, ws: false }, appType: 'custom' });
    const oldFetch = globalThis.fetch, oldStorage = globalThis.sessionStorage;
    try {
        const demoApi = await hosted.ssrLoadModule('/src/cameras/feedApi.ts');
        const { CameraZonesView } = await hosted.ssrLoadModule('/src/components/views/CameraZonesView.tsx');
        globalThis.sessionStorage = { getItem: () => assert.fail('Hosted mode read local token') };
        globalThis.fetch = () => assert.fail('Hosted mode sent configuration request');
        for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) await assert.rejects(demoApi.feedRequest('', method), /only to local administrators/);
        const html = renderToStaticMarkup(createElement(CameraZonesView, { health: [], localOnline: true, canConfigure: true }));
        assert.ok(html.includes('Read-only preview'));
        assert.ok(!html.includes('<dialog') && !html.includes('<video') && !html.includes('<img'));
        assert.ok(html.includes('LIVE FEED') && html.includes('SAMPLE DEMONSTRATION'));
        for (const button of html.matchAll(/<button\b([^>]*)>/g)) assert.ok(button[1].includes('disabled'));
    } finally { globalThis.fetch = oldFetch; globalThis.sessionStorage = oldStorage; await hosted.close(); }
});

test('legacy metadata changes labels only; hiding omits the card without changing worker URLs', async () => {
    const { ProcessedSampleFeeds } = await server.ssrLoadModule('/src/components/ui/ProcessedSampleFeeds.tsx');
    const health = [{ id: 1, state: 'Live' }, { id: 2, state: 'Live' }];
    const displays = [{ id: 1, name: 'Edited title', direction: 'southbound', bays: [8, 10], hidden: false },
        { ...api.defaultLegacyDisplays[1], hidden: true }];
    const html = renderToStaticMarkup(createElement(ProcessedSampleFeeds, { health, localOnline: true, displays, editable: true }));
    assert.ok(html.includes('Edited title') && html.includes('southbound · Bays 8, 10'));
    assert.ok(html.includes('/video_feed/northbound_cam1'));
    assert.ok(!html.includes('/video_feed/southbound_cam1') && !html.includes('id="camera-2"'));
    assert.ok(html.includes('Edit') && html.includes('Remove') && html.includes('Fullscreen Edited title'));
    assert.ok(!html.includes('/api/') && !html.includes('Original worker'));
    const restored = renderToStaticMarkup(createElement(ProcessedSampleFeeds, { health, localOnline: true,
        displays: displays.map(d => ({ ...d, hidden: false })) }));
    assert.ok(restored.includes('/video_feed/southbound_cam1'));
});

test('ROI uses decoded dimensions and centered contain scaling, never fabricated OCR or occupancy', async () => {
    const { scaledRoi } = await server.ssrLoadModule('/src/cameras/roiOverlay.ts');
    const { ParkingRoiOverlay } = await server.ssrLoadModule('/src/components/ui/SamplePlayer.tsx');
    for (const [width, height] of [[1920, 1080], [2304, 1296]]) {
        const roi = { width, height, normalization: 'x/width, y/height', polygons: [
            { id: 'Bay_3', direction: 'northbound', points: [[0.1, 0.2], [0.9, 0.2], [0.9, 0.8], [0.1, 0.8]] }] };
        assert.deepEqual(scaledRoi(roi, width, height)[0].points[0], [width * 0.1, height * 0.2]);
        assert.deepEqual(scaledRoi(roi, width / 2, height / 2), []);
        assert.deepEqual(scaledRoi(roi, 0, 0), []);
        assert.deepEqual(scaledRoi({ ...roi, normalization: 'pixels' }, width, height), []);
        const html = renderToStaticMarkup(createElement(ParkingRoiOverlay, { roi, width, height }));
        assert.ok(html.includes(`viewBox="0 0 ${width} ${height}"`));
        assert.ok(html.includes('preserveAspectRatio="xMidYMid meet"') && html.includes('pointer-events-none'));
        assert.ok(html.includes('Bay 3') && html.includes('vector-effect="non-scaling-stroke"'));
        assert.ok(!html.includes('OCCUPIED') && !html.includes('OCR'));
    }
    assert.equal(renderToStaticMarkup(createElement(ParkingRoiOverlay, { width: 2304, height: 1296 })), '');
});

test('fullscreen targets the common video/overlay viewport and handles leaving fullscreen', async t => {
    const { MediaViewport, toggleMediaFullscreen } = await server.ssrLoadModule('/src/components/ui/MediaViewport.tsx');
    const oldDocument = globalThis.document;
    t.after(() => { globalThis.document = oldDocument; });
    let entered = 0, exited = 0;
    const element = { requestFullscreen: async () => { entered++; } };
    globalThis.document = { fullscreenElement: null, exitFullscreen: async () => { exited++; } };
    await toggleMediaFullscreen(element);
    globalThis.document.fullscreenElement = element;
    await toggleMediaFullscreen(element);
    assert.deepEqual([entered, exited], [1, 1]);
    globalThis.document.fullscreenElement = null;
    await assert.rejects(toggleMediaFullscreen({ requestFullscreen: async () => { throw new Error('unsupported'); } }), /unsupported/);
    const html = renderToStaticMarkup(createElement(MediaViewport, { label: 'CCTV' }, createElement('video'), createElement('svg')));
    assert.ok(html.indexOf('<video') < html.indexOf('<svg'));
    assert.ok(html.includes('[&amp;:fullscreen]:h-screen') && html.includes('Fullscreen CCTV'));
});

test('monitoring guards timestamps, seek generations, camera identity, method and neutral occupancy', async () => {
    const { currentMonitoringFrame, occupancyColor, OVERLAY_COLORS } = await server.ssrLoadModule('/src/cameras/synchronizedPreview.ts');
    const frame = { videoId: 'pilot', epoch: 2, seconds: 5, method: 'ioa' };
    assert.equal(currentMonitoringFrame(frame, 'pilot', 2, 5.2, 'ioa'), true);
    for (const args of [['pilot', 2, 5.3, 'ioa'], ['pilot', 3, 5, 'ioa'], ['other', 2, 5, 'ioa'],
        ['pilot', 2, 0, 'ioa'], ['pilot', 2, 5, 'ground']]) assert.equal(currentMonitoringFrame(frame, ...args), false);
    assert.equal(currentMonitoringFrame(null, 'pilot', 2, 5, 'ioa'), false);
    assert.equal(occupancyColor(), OVERLAY_COLORS.inactive);
    assert.equal(occupancyColor('AVAILABLE'), '#22c55e');
    assert.equal(occupancyColor('OCCUPIED'), '#ef4444');
    assert.equal(occupancyColor('AMBIGUOUS'), '#f59e0b');
});

test('synchronized overlay renders only real confidence/classes and no OCR claims', async () => {
    const { ParkingRoiOverlay, SamplePlayer } = await server.ssrLoadModule('/src/components/ui/SamplePlayer.tsx');
    const { PILOT_VIDEO } = await server.ssrLoadModule('/src/cameras/synchronizedPreview.ts');
    const roi = { width: 100, height: 100, normalization: 'x/width, y/height', polygons: [
        { id: 'Bay_1', points: [[0, 0], [1, 0], [1, 1], [0, 1]] }] };
    const monitoring = { states: { Bay_1: 'OCCUPIED' }, detections: [{ bbox: [1, 2, 50, 80], vehicle_type: 'Bus', confidence: .83 }] };
    const html = renderToStaticMarkup(createElement(ParkingRoiOverlay, { roi, width: 100, height: 100, monitoring }));
    for (const value of ['#ef4444', '#3b82f6', '83%', 'Bus', 'OCCUPIED']) assert.ok(html.includes(value), value);
    assert.ok(!html.includes('OCR') && !html.includes('Davao'));
    const inactive = renderToStaticMarkup(createElement(ParkingRoiOverlay, { roi, width: 100, height: 100 }));
    assert.ok(inactive.includes('#94a3b8') && !inactive.includes('AVAILABLE'));
    const player = renderToStaticMarkup(createElement(SamplePlayer, { roi, canMonitor: true, video: {
        id: PILOT_VIDEO, url: '/sample-CCTV/Bays%201-2.mp4', filename: 'Bays 1-2.mp4', preview: true } }));
    assert.ok(player.includes('Enable AI monitoring') && player.includes('<video'));
});

test('monitoring sends only local bearer auth and a timestamp; hosted calls fail before network', async t => {
    const api = await server.ssrLoadModule('/src/cameras/synchronizedPreview.ts');
    const oldFetch = globalThis.fetch, oldStorage = globalThis.sessionStorage;
    t.after(() => { globalThis.fetch = oldFetch; globalThis.sessionStorage = oldStorage; });
    globalThis.sessionStorage = { getItem: () => null };
    globalThis.fetch = () => assert.fail('unauthorized request');
    await assert.rejects(api.requestMonitoringFrame(api.PILOT_VIDEO, 1, 0, 'ioa', new AbortController().signal), /Sign in/);
    globalThis.sessionStorage = { getItem: () => 'fixture' };
    globalThis.fetch = async (url, options) => {
        assert.equal(url, '/api/sample-monitor/frame');
        assert.equal(options.headers.Authorization, 'Bearer fixture');
        assert.equal(options.cache, 'no-store');
        assert.deepEqual(JSON.parse(options.body), { videoId: api.PILOT_VIDEO, seconds: 1, epoch: 3, method: 'ground' });
        return Response.json({ epoch: 3 });
    };
    await api.requestMonitoringFrame(api.PILOT_VIDEO, 1, 3, 'ground', new AbortController().signal);
    const hosted = await createServer({ mode: 'demo', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, ws: false }, appType: 'custom' });
    try {
        const demo = await hosted.ssrLoadModule('/src/cameras/synchronizedPreview.ts');
        globalThis.fetch = () => assert.fail('hosted network request');
        globalThis.sessionStorage = { getItem: () => assert.fail('hosted storage read') };
        await assert.rejects(demo.requestMonitoringFrame(api.PILOT_VIDEO, 1, 3, 'ioa', new AbortController().signal), /local pilot/);
    } finally { await hosted.close(); }
});
