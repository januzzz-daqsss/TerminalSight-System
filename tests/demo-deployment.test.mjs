import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, resolveConfig } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

let server, demo, App;
before(async () => {
    globalThis.window = { location: { pathname: '/', href: 'https://example.test/' } };
    globalThis.localStorage = { getItem: () => { throw new Error('Demo must not read operational storage'); }, setItem: () => { throw new Error('Demo must not write storage'); } };
    globalThis.sessionStorage = globalThis.localStorage;
    server = await createServer({ mode: 'demo', server: { middlewareMode: true, ws: false }, appType: 'custom' });
    demo = await server.ssrLoadModule('/src/demo.ts');
    App = (await server.ssrLoadModule('/src/App.tsx')).default;
});
after(async () => {
    await server?.close();
    delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
});

test('hosted entry offers Explore Demo without an administrator form', () => {
    window.location.pathname = '/';
    const html = renderToStaticMarkup(createElement(App));
    assert.ok(demo.DEMO_MODE);
    assert.ok(html.includes('Explore Demo'));
    assert.ok(html.includes('read-only preview'));
    assert.ok(html.includes('Local terminal administration remains available on the local system'));
    assert.ok(!html.includes('<form') && !html.includes('<input'));
    assert.ok(!html.includes('2D Spatial Terminal Map'));
});

test('public displays render labeled snapshots independently of login', () => {
    for (const path of ['/public-view', '/signage']) {
        window.location.pathname = path;
        const html = renderToStaticMarkup(createElement(App));
        assert.ok(html.includes('Hosted demonstration.'), path);
        assert.ok(html.includes('Timers are fixed examples'), path);
        assert.ok(html.includes('Davao'), path);
        assert.ok(!html.includes('Administrator ID'), path);
    }
});

test('demo dashboard and navigation retain the terminal map and all destinations', async () => {
    const { DashboardView } = await server.ssrLoadModule('/src/components/views/DashboardView.tsx');
    const { Sidebar } = await server.ssrLoadModule('/src/components/layout/Sidebar.tsx');
    const { initialSystem } = await server.ssrLoadModule('/src/notifications/model.ts');
    const dashboard = renderToStaticMarkup(createElement(DashboardView, { bays: demo.demoBays }));
    assert.equal(demo.demoBays.length, 10);
    assert.ok(dashboard.includes('2D Spatial Terminal Map'));
    assert.ok(dashboard.includes('Hosted demonstration.'));
    const sidebar = renderToStaticMarkup(createElement(Sidebar, { activeTab: 'dashboard', setActiveTab() {}, onLogout() {}, onSystemDetails() {}, system: initialSystem }));
    for (const text of ['Dashboard', 'Camera Zones', 'Violation Logs', 'Analytics', 'Settings', 'Launch Public View', 'Launch Public Display', 'Exit Demo', 'Demo visitor']) assert.ok(sidebar.includes(text), text);
});

test('camera page has no stream and no enabled terminal configuration', async () => {
    const { CameraZonesView } = await server.ssrLoadModule('/src/components/views/CameraZonesView.tsx');
    const html = renderToStaticMarkup(createElement(CameraZonesView, { health: [], localOnline: false }));
    assert.ok(html.includes('AI detection requires the local system'));
    assert.ok(html.includes('Not connected in hosted demo'));
    assert.ok(!html.includes('<video') && !html.includes('<img'));
    for (const button of html.matchAll(/<button\b([^>]*)>/g)) assert.ok(button[1].includes('disabled'));
});

test('analytics, violation examples and read-only settings render', async () => {
    for (const name of ['AnalyticsView', 'ViolationLogsView', 'SettingsView']) {
        const module = await server.ssrLoadModule(`/src/components/views/${name}.tsx`);
        const content = createElement(module[name]);
        const html = renderToStaticMarkup(name === 'SettingsView' ? createElement('fieldset', { disabled: true }, content) : content);
        assert.ok(html.length > 1000);
        if (name === 'SettingsView') assert.ok(html.includes('<fieldset disabled=""'));
        if (name === 'AnalyticsView') assert.match(html, /<button[^>]*disabled[^>]*>[\s\S]*?Export Saved Occupancy Records/);
    }
});

test('demo excludes public assets; normal builds retain local mode; SPA routes configured', async () => {
    const config = await resolveConfig({ mode: 'demo' }, 'build');
    assert.equal(config.publicDir, '');
    assert.equal(config.server.proxy, undefined);
    assert.equal(config.preview.proxy, undefined);
    const local = await resolveConfig({ mode: 'production' }, 'build');
    assert.notEqual(local.env.VITE_DEMO_MODE, 'true');
    assert.ok(local.publicDir.endsWith('public'));
    const apiProxy = '^/api/(?!auth(?:/|$))';
    assert.equal(local.server.proxy[apiProxy], 'http://127.0.0.1:5000');
    assert.equal(local.preview.proxy[apiProxy], 'http://127.0.0.1:5000');
    assert.ok(new RegExp(apiProxy).test('/api/login'));
    assert.ok(new RegExp(apiProxy).test('/api/bays'));
    assert.ok(!new RegExp(apiProxy).test('/api/auth/authorize'));
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    assert.equal(vercel.framework, 'vite');
    assert.equal(vercel.outputDirectory, 'dist');
    assert.equal(vercel.buildCommand, 'npm run build:demo');
    assert.deepEqual(vercel.rewrites, [{ source: '/((?!api(?:/|$)).*)', destination: '/index.html' }]);
    const spaRoute = new RegExp(`^${vercel.rewrites[0].source}$`);
    for (const path of ['/', '/public-view', '/signage', '/admin', '/auth/callback']) assert.ok(spaRoute.test(path));
    for (const path of ['/api', '/api/auth/authorize', '/api/login']) assert.ok(!spaRoute.test(path));
});

test('normal local build retains administrator login without demo access', async () => {
    const localServer = await createServer({ mode: 'production', server: { middlewareMode: true, ws: false }, appType: 'custom' });
    try {
        const { AdminLogin } = await localServer.ssrLoadModule('/src/components/views/AdminLogin.tsx');
        const html = renderToStaticMarkup(createElement(AdminLogin, { onLogin() {} }));
        assert.ok(html.includes('Administrator ID'));
        assert.ok(html.includes('Log In'));
        assert.ok(html.includes('Forgot password?'));
        assert.ok(!html.includes('Explore Demo'));
    } finally { await localServer.close(); }
});


test('hosted administrator routes require authorization while demo remains anonymous', () => {
    for (const pathname of ['/admin', '/admin/settings', '/auth/callback']) {
        window.location.pathname = pathname;
        window.location.href = `https://example.test${pathname}`;
        const html = renderToStaticMarkup(createElement(App));
        assert.ok(!html.includes('2D Spatial Terminal Map'));
        assert.ok(html.includes('Explore Demo'));
        assert.ok(!html.includes('terminalsight-export-token'));
    }
    window.location.pathname = '/';
    window.location.href = 'https://example.test/';
    const html = renderToStaticMarkup(createElement(App));
    assert.ok(html.includes('href="/admin"'));
    assert.ok(html.includes('No account is needed'));
});

test('interrupted setup has a credential-free recovery restart route', () => {
    window.location.pathname = '/admin';
    window.location.href = 'https://example.test/admin?recovery=restart';
    const html = renderToStaticMarkup(createElement(App));
    assert.ok(html.includes('Reset your password'));
    assert.ok(!html.includes('2D Spatial Terminal Map'));
});
