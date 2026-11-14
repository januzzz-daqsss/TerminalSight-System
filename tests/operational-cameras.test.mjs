import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function client(demo = false) {
    const source = await readFile(new URL('../src/cameras/operationalCamera.ts', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
        .replace(/import.*DEMO_MODE.*from.*;/, `const DEMO_MODE = ${demo};`)
        .replace(/import.*JpegParts.*from.*;/, 'class JpegParts {}');
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('operational API rejects hosted visitors and missing local credentials before fetching', async t => {
    const storage = globalThis.sessionStorage, fetch = globalThis.fetch;
    t.after(() => { globalThis.sessionStorage = storage; globalThis.fetch = fetch; });
    globalThis.fetch = () => assert.fail('Must not access local services');
    globalThis.sessionStorage = { getItem: () => assert.fail('Hosted must not access local tokens') };
    const hosted = await client(true);
    assert.throws(() => hosted.operationalClient(), /local-only/);
    globalThis.sessionStorage = { getItem: () => null };
    const local = await client();
    assert.throws(() => local.operationalClient(), /Sign in locally/);
});

test('status and explicit camera controls use local headers without URL credentials', async t => {
    const storage = globalThis.sessionStorage, fetch = globalThis.fetch;
    t.after(() => { globalThis.sessionStorage = storage; globalThis.fetch = fetch; });
    globalThis.sessionStorage = { getItem: () => 'fixture-local-token' };
    const calls = [];
    globalThis.fetch = async (url, options) => {
        assert.ok(!url.includes('fixture-local-token'));
        assert.equal(options.headers.Authorization, 'Bearer fixture-local-token');
        assert.equal(options.credentials, 'omit');
        calls.push([url, options.method, options.body]);
        return Response.json({ feeds: [] });
    };
    const { operationalClient } = await client();
    const api = operationalClient();
    await api.status(); await api.control('saved-camera', 'stop'); await api.control('saved-camera', 'restart');
    assert.deepEqual(calls.map(c => c[1]), ['GET', 'POST', 'POST']);
    assert.equal(JSON.parse(calls[1][2]).action, 'stop');
    assert.equal(JSON.parse(calls[2][2]).action, 'restart');
});

test('operational card has no media playback controls; unmount aborts viewing, not monitoring', async () => {
    const source = await readFile(new URL('../src/components/ui/OperationalCameraPreview.tsx', import.meta.url), 'utf8');
    assert.ok(!/<video|type="range"|>Pause<|>Seek<|>Resume</.test(source));
    assert.match(source, /controller\.abort\(\)/);
    assert.match(source, /URL\.revokeObjectURL/);
    const cleanup = source.match(/return \(\) => \{ controller\.abort\(\);[^\n]+/)[0];
    assert.ok(!cleanup.includes("control("));
    const page = await readFile(new URL('../src/components/views/CameraZonesView.tsx', import.meta.url), 'utf8');
    assert.match(page, /camera && editable \? <OperationalCameraPreview/);
    assert.match(page, /Open diagnostic preview/);
    assert.match(page, /Valid mapped recordings are monitored automatically/);
    assert.ok(!page.includes('Detection and terminal operations were not changed'));
    const picker = await readFile(new URL('../src/components/ui/RoiMappingPicker.tsx', import.meta.url), 'utf8');
    assert.match(picker, /Saving a valid mapped feed enables local operational monitoring/);
});

test('mount and unmount only open and cancel viewing; no camera lifecycle request', async t => {
    const prior = { hooks: globalThis.__opHooks, api: globalThis.__opApi, jsx: globalThis.__opJsx };
    t.after(() => { globalThis.__opHooks = prior.hooks; globalThis.__opApi = prior.api; globalThis.__opJsx = prior.jsx; });
    let effect, signal, opened = 0;
    globalThis.__opHooks = { useState: v => [v, () => {}], useEffect: fn => { effect = fn; } };
    globalThis.__opJsx = () => null;
    globalThis.__opApi = () => ({ control: () => assert.fail('Viewing must not control the worker'),
        stream: async (id, input) => { opened++; assert.equal(id, 'camera'); signal = input; await new Promise(resolve => input.addEventListener('abort', resolve)); } });
    const source = await readFile(new URL('../src/components/ui/OperationalCameraPreview.tsx', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
        .replace(/import.*from "react\/jsx-runtime";/, 'const _jsx = globalThis.__opJsx, _jsxs = _jsx;')
        .replace(/import.*from 'react';/, 'const {useState, useEffect} = globalThis.__opHooks;')
        .replace(/import.*from '..\/..\/cameras\/operationalCamera';/, 'const operationalClient = globalThis.__opApi;')
        .replace(/import.*from '.\/MediaViewport';/, 'const MediaViewport = () => null;');
    const { OperationalCameraPreview } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    OperationalCameraPreview({ feed: { id: 'camera', name: 'Fixture', state: 'Live', healthy: true, inferenceFps: 2 } });
    const cleanup = effect();
    assert.equal(opened, 1); assert.equal(signal.aborted, false);
    cleanup(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(signal.aborted, true);
});
