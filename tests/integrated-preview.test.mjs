import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadClient(demo = false) {
    const source = await readFile(new URL('../src/cameras/integratedPreview.ts', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
        .replace(/import.*DEMO_MODE.*from.*;/, `const DEMO_MODE = ${demo};`);
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('MJPEG parser handles split headers, binary chunks, multiple parts and bounded malformed input', async () => {
    const { JpegParts } = await loadClient();
    const wire = Buffer.concat([0, 1, 2].map(g => Buffer.concat([
        Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 4\r\nX-Generation: ${g}\r\n\r\n`),
        Buffer.from([255, 216, 255, 217]), Buffer.from('\r\n')])));
    for (const size of [1, 5, 63, wire.length]) {
        const parser = new JpegParts(), frames = [];
        for (let i = 0; i < wire.length; i += size) frames.push(...parser.push(wire.subarray(i, i + size)));
        assert.deepEqual(frames.map(f => f.generation), [0, 1, 2]);
        assert.deepEqual([...frames[0].jpeg], [255, 216, 255, 217]);
    }
    assert.throws(() => new JpegParts().push(new Uint8Array(4_194_305)), /size limit/);
    assert.throws(() => new JpegParts().push(Buffer.from('--frame\r\nContent-Length: 9999999\r\nX-Generation: 1\r\n\r\n')), /Invalid/);
});

test('local bearer headers protect every request; hosted and signed-out calls never reach the network', async t => {
    const fetchBefore = globalThis.fetch, storageBefore = globalThis.sessionStorage;
    t.after(() => { globalThis.fetch = fetchBefore; globalThis.sessionStorage = storageBefore; });
    const local = await loadClient();
    globalThis.sessionStorage = { getItem: () => null };
    assert.throws(() => local.createIntegratedClient(), /Sign in locally/);
    const hosted = await loadClient(true);
    globalThis.sessionStorage = { getItem: () => assert.fail('Hosted must not read local credentials') };
    assert.throws(() => hosted.createIntegratedClient(), /local-only/);
    globalThis.sessionStorage = { getItem: key => { assert.equal(key, 'terminalsight-export-token'); return 'fixture-token'; } };
    const calls = [];
    globalThis.fetch = async (url, options) => {
        assert.ok(!url.includes('fixture-token'));
        assert.equal(options.headers.Authorization, 'Bearer fixture-token');
        assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
        calls.push([url, options.method || 'GET']);
        if (url.endsWith('/stream')) return new Response(Buffer.from('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 2\r\nX-Generation: 3\r\n\r\nab\r\n'), { headers: { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' } });
        return Response.json({ id: 'session' });
    };
    const client = local.createIntegratedClient();
    await client.start('saved-feed'); await client.status('session'); await client.control('session', { action: 'pause' });
    const frames = [];
    await client.stream('session', new AbortController().signal, (bytes, generation) => frames.push(generation));
    await client.stop('session');
    assert.deepEqual(frames, [3]);
    assert.deepEqual(calls.map(c => c[1]), ['POST', 'GET', 'PATCH', 'GET', 'DELETE']);
});

test('card automatically starts one session, drops old generations and releases late starts on unmount', async t => {
    const original = { hooks: globalThis.__previewHooks, client: globalThis.__previewClient, jsx: globalThis.__previewJsx,
        create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    t.after(() => { globalThis.__previewHooks = original.hooks; globalThis.__previewClient = original.client; globalThis.__previewJsx = original.jsx;
        URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; });
    let cleanup, effect, stateIndex = 0, starts = 0, callback, finishStream, resolveStart;
    const values = [], revoked = [], stops = [];
    globalThis.__previewHooks = {
        useRef: value => ({ current: value }),
        useState: value => { const index = stateIndex++; values[index] = value; return [value, next => { values[index] = next; }]; },
        useEffect: fn => { effect = fn; },
    };
    globalThis.__previewJsx = () => null;
    const state = { id: 'one', generation: 2, seconds: 0, duration: 10, sourceFps: 15, stopped: false };
    globalThis.__previewClient = () => ({
        start: () => { starts++; return new Promise(resolve => { resolveStart = resolve; }); },
        status: async () => state,
        stream: async (id, signal, fn) => { callback = fn; return new Promise(resolve => { finishStream = resolve; signal.addEventListener('abort', resolve); }); },
        stop: async id => { stops.push(id); },
    });
    let serial = 0;
    URL.createObjectURL = () => `blob:fixture-${++serial}`;
    URL.revokeObjectURL = value => revoked.push(value);
    const source = await readFile(new URL('../src/components/ui/IntegratedSamplePreview.tsx', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
        .replace(/import.*from "react\/jsx-runtime";/, 'const _jsx = globalThis.__previewJsx, _jsxs = _jsx;')
        .replace(/import.*from 'react';/, 'const {useEffect, useRef, useState} = globalThis.__previewHooks;')
        .replace(/import.*from '..\/..\/cameras\/integratedPreview';/, 'const createIntegratedClient = globalThis.__previewClient;')
        .replace(/import.*from '.\/MediaViewport';/, 'const MediaViewport = () => null;');
    const { IntegratedSamplePreview } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const flush = () => new Promise(resolve => setImmediate(resolve));
    IntegratedSamplePreview({ feedId: 'pilot', name: 'Test', onStop: () => {} }); cleanup = effect();
    assert.equal(starts, 1);
    resolveStart(state); await flush();
    callback(new Uint8Array([1]), 1); assert.equal(serial, 0, 'older generation never paints');
    callback(new Uint8Array([1]), 2); assert.equal(values[1], 'blob:fixture-1');
    callback(new Uint8Array([2]), 3); assert.ok(revoked.includes('blob:fixture-1'));
    cleanup(); await flush(); assert.ok(stops.includes('one')); assert.ok(revoked.includes('blob:fixture-2'));
    callback(new Uint8Array([3]), 3); assert.equal(serial, 2, 'unmounted card cannot paint');
    finishStream();
    stateIndex = 0;
    IntegratedSamplePreview({ feedId: 'pilot', name: 'Test', onStop: () => {} }); cleanup = effect();
    cleanup(); resolveStart({ ...state, id: 'late' }); await flush();
    assert.ok(stops.includes('late'), 'start completing after unmount is stopped');
});
