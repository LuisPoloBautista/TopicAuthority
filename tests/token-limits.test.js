import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

test('input token limits and single-attempt OpenAI requests', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'topic-tokens-'));
  const calls = [];
  let countedTokens = 1000;
  let failure = null;
  const mock = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const stage = req.url === '/v1/responses/input_tokens' ? 'count' : 'generate';
    calls.push({ stage, request });
    if (failure?.stage === stage) {
      if (failure.kind === 'disconnect') return req.socket.destroy();
      if (failure.kind === 'timeout') return; // Client must abort, never retry.
      res.statusCode = failure.status || 200;
      if (failure.kind === 'redirect') res.setHeader('Location', '/redirect-target');
      return res.end(failure.body ?? 'not JSON');
    }
    res.setHeader('Content-Type', 'application/json');
    if (stage === 'count') return res.end(JSON.stringify({ input_tokens: typeof countedTokens === 'function' ? countedTokens(request) : countedTokens }));
    const isMarc = request.input[0].content[0].text.includes('UN solo');
    res.end(JSON.stringify({ output_text: JSON.stringify(Array.from({ length: isMarc ? 1 : 5 }, () => ({ main: 'Educación', subdivisions: [] }))) }));
  }).listen(0, '127.0.0.1');
  await once(mock, 'listening');
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    env: { ...process.env, PORT: '0', OPENAI_API_KEY: 'test-only', OPENAI_MODEL: 'gpt-5.5', OPENAI_TIMEOUT_MS: '500',
      OPENAI_RESPONSES_URL: `http://127.0.0.1:${mock.address().port}/v1/responses`, HEADING_STORE_PATH: path.join(dir, 'history.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.resume();
  t.after(async () => {
    server.kill();
    if (server.exitCode === null) await once(server, 'exit');
    mock.closeAllConnections();
    await new Promise(resolve => mock.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
  let sequence = 0;
  const payload = mode => ({ mode, text: `Educación en México: ñ, 漢字, 📚 ${sequence++}`, existingMain: 'Educación' });
  const post = data => fetch(url + '/api/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

  for (const [mode, limit, output] of [['marc', 2000, 1200], ['pdf', 12000, 2500]]) {
    for (const tokens of [limit - 1, limit, limit + 1]) {
      await t.test(`${mode}: ${tokens} input tokens`, async () => {
        countedTokens = tokens;
        calls.length = 0;
        const input = payload(mode);
        if (tokens > limit) countedTokens = request => tokens - Array.from(input.text).length + Array.from(request.input[0].content[0].text.split('Contenido a analizar:\n')[1]).length;
        const response = await post(input);
        const result = await response.json();
        if (tokens > limit) {
          assert.equal(response.status, 200);
          assert.equal(result.headings.length, mode === 'marc' ? 1 : 5);
          assert.equal(result.error, undefined);
          const generated = calls.filter(c => c.stage === 'generate');
          assert.equal(generated.length, 1);
          assert.ok(countedTokens(generated[0].request) <= limit);
          const prefix = generated[0].request.input[0].content[0].text.split('Contenido a analizar:\n')[1];
          assert.ok(input.text.startsWith(prefix));
          assert.ok(prefix.length > 0 && prefix.length < input.text.length);
        } else {
          assert.equal(response.status, 200);
          assert.equal(result.headings.length, mode === 'marc' ? 1 : 5);
          assert.deepEqual(calls.map(c => c.stage), ['count', 'generate']);
          assert.deepEqual(calls[0].request.input, calls[1].request.input);
          assert.equal(calls[0].request.model, calls[1].request.model);
          assert.equal(calls[1].request.max_output_tokens, output);
          const prompt = calls[0].request.input[0].content[0].text;
          assert.ok(prompt.endsWith(input.text));
          assert.match(prompt, /Eres un catalogador bibliotecario/);
          if (mode === 'marc') assert.match(prompt, /Conserva literalmente este 650\$a/);
          else assert.doesNotMatch(prompt, /Conserva literalmente/);
        }
      });
    }
  }

  for (const [mode, limit] of [['marc', 2000], ['pdf', 12000]]) {
    await t.test(`${mode}: long Unicode content is silently trimmed and instructions preserved`, async () => {
      const input = { ...payload(mode), text: 'México 📚 漢字 '.repeat(2000) };
      countedTokens = request => 500 + Array.from(request.input[0].content[0].text.split('Contenido a analizar:\n')[1]).length;
      calls.length = 0;
      const response = await post(input);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).error, undefined);
      const generated = calls.filter(c => c.stage === 'generate');
      assert.equal(generated.length, 1);
      const prompt = generated[0].request.input[0].content[0].text;
      assert.equal(countedTokens(generated[0].request), limit);
      const [instructions, prefix] = prompt.split('Contenido a analizar:\n');
      assert.equal(instructions, calls[0].request.input[0].content[0].text.split('Contenido a analizar:\n')[0]);
      assert.ok(input.text.startsWith(prefix));
      assert.doesNotMatch(prefix, /[\uD800-\uDBFF]$/);
      assert.ok(calls.filter(c => c.stage === 'count').some(c => JSON.stringify(c.request.input) === JSON.stringify(generated[0].request.input)));
    });
  }

  await t.test('failure while counting a trimmed prefix stops without retry or generation', async () => {
    calls.length = 0;
    countedTokens = () => {
      failure = { stage: 'count', status: 429 };
      return 2001;
    };
    assert.equal((await post(payload('marc'))).status, 502);
    assert.deepEqual(calls.map(c => c.stage), ['count', 'count']);
    assert.notDeepEqual(calls[0].request.input, calls[1].request.input);
    failure = null;
  });

  for (const value of [null, '100', -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await t.test(`invalid count ${JSON.stringify(value)} blocks generation`, async () => {
      countedTokens = value;
      calls.length = 0;
      assert.equal((await post(payload('marc'))).status, 502);
      assert.deepEqual(calls.map(c => c.stage), ['count']);
    });
  }

  for (const stage of ['count', 'generate']) {
    for (const scenario of [
      { kind: 'http', status: 429 }, { kind: 'http', status: 500 },
      { kind: 'invalid-json' }, { kind: 'disconnect' }, { kind: 'timeout' },
      { kind: 'redirect', status: 307 },
      { kind: 'invalid-result', body: JSON.stringify({ output_text: '[]' }) },
    ]) {
      await t.test(`${stage} ${scenario.kind} ${scenario.status || ''}: no retry`, async () => {
        countedTokens = 1000;
        failure = { stage, ...scenario };
        calls.length = 0;
        const response = await post(payload('marc'));
        assert.equal(response.status, stage === 'count' ? 502 : 500);
        assert.deepEqual(calls.map(c => c.stage), stage === 'count' ? ['count'] : ['count', 'generate']);
        failure = null;
      });
    }
  }

  await t.test('simultaneous requests and successful cache hits do not repeat API calls', async () => {
    countedTokens = 1000;
    calls.length = 0;
    const input = payload('marc');
    const responses = await Promise.all([post(input), post(input)]);
    for (const response of responses) assert.equal(response.status, 200);
    assert.equal((await post(input)).status, 200);
    assert.deepEqual(calls.map(c => c.stage), ['count', 'generate']);
  });
});
