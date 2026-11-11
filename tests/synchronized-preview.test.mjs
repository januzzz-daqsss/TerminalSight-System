import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

test('real monitoring hook drops seek/pause/loop results, bounds requests and cleans up', async t => {
    // Execute the actual hook with deterministic media/events/clocks, without a DOM package.
    const names = ['fetch', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', '__monitorHooks'];
    const original = Object.fromEntries(names.map(name => [name, globalThis[name]]));
    t.after(() => { for (const name of names) globalThis[name] = original[name]; });
    let cleanup, animation, cancelled = false, stateIndex = 0, nextTimer = 0;
    const states = [], timers = new Map(), pending = [];
    globalThis.__monitorHooks = {
        useRef: value => ({ current: value }),
        useState: value => { const index = stateIndex++; states[index] = value; return [value, next => { states[index] = next; }]; },
        useEffect: callback => { cleanup = callback(); },
    };
    globalThis.requestAnimationFrame = callback => { animation = callback; return 1; };
    globalThis.cancelAnimationFrame = () => { cancelled = true; };
    globalThis.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    globalThis.sessionStorage = { getItem: () => 'fixture' };
    globalThis.fetch = (url, options) => new Promise(resolve => { pending.push({ options, resolve, body: JSON.parse(options.body) }); });
    const source = await readFile(new URL('../src/cameras/synchronizedPreview.ts', import.meta.url), 'utf8');
    let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    code = code.replace(/import\s+\{[^}]*\}\s+from\s+['"]react['"];?/g, 'const {useEffect, useRef, useState} = globalThis.__monitorHooks;')
        .replace(/import\s+\{\s*DEMO_MODE\s*\}\s+from\s+['"]\.\.\/demo['"];?/g, 'const DEMO_MODE = false;');
    const { useSynchronizedPreview, PILOT_VIDEO } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const media = new EventTarget();
    Object.assign(media, { currentTime: 5, paused: false, readyState: 2, seeking: false, error: null });
    useSynchronizedPreview({ current: media }, PILOT_VIDEO, true, 'ioa');
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const reply = async index => { const p = pending[index]; p.resolve(Response.json({ videoId: PILOT_VIDEO, seconds: p.body.seconds, epoch: p.body.epoch, method: 'ioa' })); await flush(); };
    const poll = async () => { const entry = [...timers.entries()].find(([, value]) => value.delay === 500); assert.ok(entry, 'next bounded poll'); timers.delete(entry[0]); entry[1].callback(); await flush(); };
    assert.equal(pending.length, 1);
    animation(); animation();
    assert.equal(pending.length, 1, 'display ticks do not launch parallel inference');
    await reply(0); animation(); assert.equal(states[0].seconds, 5);
    media.currentTime = 6; animation(); assert.equal(states[0], null, 'old time hidden');
    media.dispatchEvent(new Event('seeking')); media.dispatchEvent(new Event('seeked'));
    await poll(); assert.equal(pending.length, 2);
    media.paused = true; media.dispatchEvent(new Event('pause'));
    await reply(1); animation(); assert.equal(states[0], null, 'pre-pause in-flight result discarded');
    await poll(); await reply(2); animation(); assert.equal(states[0].seconds, 6);
    await poll(); assert.equal(pending.length, 3, 'paused matching frame does not re-run inference');
    media.currentTime = 0; animation(); assert.equal(states[0], null, 'loop resets generation');
    await poll(); assert.equal(pending.length, 4);
    cleanup();
    assert.equal(pending[3].options.signal.aborted, true);
    await reply(3);
    assert.equal(cancelled, true);
    assert.equal(states[0], null, 'late response after unmount cannot restore overlay');
    assert.equal(timers.size, 0);
});
