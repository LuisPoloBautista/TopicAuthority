import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

test('API generates typed headings and counts confirmed records only', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'topic-api-'));
  const h = { main: 'Educación', subdivisions: [{ code: 'z', value: 'México' }] };
  let prompt = '';
  const mock = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    prompt = JSON.parse(body).input[0].content[0].text;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ output_text: JSON.stringify(Array.from({ length: 5 }, () => h)) }));
  }).listen(0, '127.0.0.1');
  await once(mock, 'listening');
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    env: { ...process.env, PORT: '0', OPENAI_API_KEY: 'test-only', OPENAI_RESPONSES_URL: `http://127.0.0.1:${mock.address().port}`, HEADING_STORE_PATH: path.join(dir, 'history.json') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    server.kill();
    if (server.exitCode === null) await once(server, 'exit');
    mock.closeAllConnections();
    await new Promise(resolve => mock.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    server.once('error', reject);
    server.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
  const post = (endpoint, data) => fetch(url + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const generated = await post('/api/topics', { text: '=245 $a Educación en México', existingMain: 'Educación' });
  assert.equal(generated.status, 200);
  assert.equal((await generated.json()).headings.length, 5);
  assert.match(prompt, /Conserva literalmente/);
  assert.deepEqual((await (await fetch(url + '/api/headings?q=educacion')).json()).headings, []);
  assert.equal((await post('/api/heading-usage', { recordId: 'koha:1', headings: [h] })).status, 400);
  for (let i = 0; i < 2; i++) assert.equal((await post('/api/heading-usage', { confirmed: true, recordId: 'koha:1', headings: [h] })).status, 200);
  assert.equal((await (await fetch(url + '/api/headings?q=educacion')).json()).headings[0].uses, 1);
  const js = await (await fetch(url + '/api/used-headings.js')).text();
  assert.match(js, /^export default /);
  assert.ok(!js.includes('koha:1'));
  assert.equal((await fetch(url + '/data/used-headings.json')).status, 404);
  assert.equal((await fetch(url + '/server.js')).status, 404);
});
