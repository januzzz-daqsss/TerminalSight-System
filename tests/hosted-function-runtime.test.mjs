import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('compiled serverless entry loads as JavaScript without source helpers or a TS loader', async () => {
    const parent = resolve(root, 'tmp');
    await mkdir(parent, { recursive: true });
    const artifact = await mkdtemp(join(parent, 'hosted-function-'));
    try {
        const source = await readFile(join(root, 'api/auth/authorize.ts'), 'utf8');
        // Emit the actual function entry, preserving ESM imports just as a non-bundling
        // compiler does. Deliberately do not copy any server/*.ts source into the artifact.
        const compiled = ts.transpileModule(source, {
            fileName: 'authorize.ts', reportDiagnostics: true,
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        });
        assert.equal(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
        const directory = join(artifact, 'api', 'auth');
        await mkdir(directory, { recursive: true });
        await writeFile(join(artifact, 'package.json'), '{"type":"module"}');
        const entry = join(directory, 'authorize.js');
        await writeFile(entry, compiled.outputText);
        // A clean Node process must resolve the real installed production dependencies.
        // Stub only Supabase HTTP; execute the compiled default Vercel handler itself.
        const check = `
            import assert from 'node:assert/strict';
            let calls = 0;
            globalThis.fetch = async (input, init) => {
                calls++;
                assert.equal(String(input), 'https://auth.example.test/auth/v1/user');
                const token = new Headers(init.headers).get('authorization');
                if (token === 'Bearer invalid') return Response.json({ code: 'bad_jwt', msg: 'Invalid token' }, { status: 401 });
                assert.ok(['Bearer viewer', 'Bearer admin'].includes(token));
                return Response.json({ id: 'test-user', app_metadata: { role: token === 'Bearer admin' ? 'admin' : 'viewer' }, user_metadata: { role: 'admin' } });
            };
            const { default: endpoint } = await import(${JSON.stringify(pathToFileURL(entry).href)});
            for (const [token, status] of [[null, 401], ['invalid', 401], ['viewer', 403], ['admin', 200]]) {
                const headers = token ? { Authorization: 'Bearer ' + token, 'X-Role': 'admin' } : {};
                const response = await endpoint.fetch(new Request('https://preview.example.test/api/auth/authorize?role=admin', { headers }));
                assert.equal(response.status, status);
                assert.equal(response.headers.get('cache-control'), 'no-store');
                const body = await response.json();
                assert.equal(body.authorized, status === 200);
                if (status === 200) assert.deepEqual(body, { authorized: true, user: { id: 'test-user' } });
            }
            assert.equal(calls, 3);
        `;
        const { stdout, stderr } = await execute(process.execPath,
            ['--no-experimental-strip-types', '--input-type=module', '--eval', check], {
                cwd: artifact, timeout: 20000,
                env: { ...process.env, NODE_OPTIONS: '', SUPABASE_URL: 'https://auth.example.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only' },
            });
        assert.equal(stdout, '');
        assert.equal(stderr, '');
        assert.ok(!/from\s+['"][^'"]+\.ts['"]/.test(compiled.outputText));
    } finally {
        // Delete only this test's generated artifact, after checking the absolute target.
        assert.ok(resolve(artifact).startsWith(parent + sep));
        await rm(artifact, { recursive: true, force: true });
    }
});
