import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

for (const mode of ['production', 'demo']) {
    test(`sample AI API and initial UI isolation: ${mode}`, async () => {
        const server = await createServer({ mode, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, ws: false }, appType: 'custom' });
        const oldFetch = globalThis.fetch, oldStorage = globalThis.sessionStorage;
        try {
            const { createSampleAiClient } = await server.ssrLoadModule('/src/cameras/sampleAi.ts');
            const { SampleAiPreview } = await server.ssrLoadModule('/src/components/ui/SampleAiPreview.tsx');
            globalThis.fetch = () => assert.fail('Initial UI must not start processing');
            globalThis.sessionStorage = { getItem: () => assert.fail('Initial UI must not read token') };
            const props = { videoId: 'fixture', mapping: { videoId: 'fixture', bays: ['Bay_1'], direction: 'northbound' }, allowed: true };
            const html = renderToStaticMarkup(createElement(SampleAiPreview, props, 'ordinary video'));
            assert.ok(html.includes('ordinary video'));
            if (mode === 'demo') {
                assert.throws(createSampleAiClient, /only on the local/);
                assert.ok(!html.includes('Enable AI Preview'));
                return;
            }
            assert.ok(html.includes('Enable AI Preview'));
            assert.ok(html.includes('OCR is not enabled'));
            globalThis.sessionStorage = { getItem: () => null };
            assert.throws(createSampleAiClient, /Sign in locally/);
            globalThis.sessionStorage = { getItem: () => 'local-test-token' };
            const client = createSampleAiClient();
            const calls = [];
            globalThis.fetch = async (url, options) => {
                assert.ok(!url.includes('local-test-token'));
                assert.equal(options.headers.Authorization, 'Bearer local-test-token');
                assert.equal(options.credentials, 'omit');
                assert.equal(options.cache, 'no-store');
                calls.push([url, options.method, options.body]);
                return Response.json({ id: 'fixture', mappings: [] });
            };
            await client.mappings();
            await client.start('fixture', 'ioa');
            await client.frame('fixture', false, new AbortController().signal);
            // Cleanup retains the captured login token even after browser storage clears.
            globalThis.sessionStorage = { getItem: () => null };
            await client.stop('fixture');
            assert.equal(calls[2][2], JSON.stringify({ advance: false }));
            assert.equal(calls[3][1], 'DELETE');
            globalThis.fetch = async () => Response.json({ message: 'Denied' }, { status: 401 });
            await assert.rejects(client.mappings(), /Denied/);
        } finally {
            globalThis.fetch = oldFetch; globalThis.sessionStorage = oldStorage;
            await server.close();
        }
    });
}
