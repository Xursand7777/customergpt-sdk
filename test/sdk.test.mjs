import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CustomerGPT, CustomerGPTError, VERSION} from '@customergpt/sdk';

function mockFetch(responses) {
  const seen = [];
  const fetch = async (url, options) => {
    seen.push({url, options, body: options.body && JSON.parse(options.body)});
    const next = typeof responses === 'function' ? responses(seen.at(-1)) : responses.shift();
    const headers = new Headers(next.headers);
    return {ok: (next.status ?? 200) < 400, status: next.status ?? 200, headers, json: async () => next.body};
  };
  return {fetch, seen};
}

test('VERSION matches package.json', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('sends API key and returns unwrapped data', async () => {
  const {fetch, seen} = mockFetch([{body: {ok: true, data: {items: []}}}]);
  const client = new CustomerGPT({apiKey: 'cgpt_test', baseUrl: 'https://backend.example', fetch});
  assert.deepEqual(await client.chatbots.list({limit: 5}), {items: []});
  assert.equal(seen[0].url, 'https://backend.example/api/v1/agents/actions/chatbots_list');
  assert.equal(seen[0].options.method, 'POST');
  assert.equal(seen[0].options.headers['X-Api-Key'], 'cgpt_test');
  assert.deepEqual(seen[0].body, {limit: 5});
});

test('mutations confirm by default and dryRun never confirms', async () => {
  const {fetch, seen} = mockFetch(() => ({body: {ok: true, data: {}}}));
  const client = new CustomerGPT({apiKey: 'k', fetch});
  await client.chatbots.create({name: 'Bot', websiteUrl: 'https://example.com'});
  await client.knowledge.addWebsite('c1', 'https://docs.example.com/start', {}, {dryRun: true});
  assert.deepEqual(seen[0].body, {name: 'Bot', websiteUrl: 'https://example.com', confirm: true});
  assert.deepEqual(seen[1].body, {chatbotId: 'c1', url: 'https://docs.example.com/start', name: 'docs.example.com', dryRun: true, confirm: false});
});

test('anonymous calls send no credential', async () => {
  const {fetch, seen} = mockFetch([{body: {ok: true, data: {id: 'j', status: 'pending', token: 't'}}}]);
  const client = new CustomerGPT({apiKey: '', fetch});
  await client.onboarding.start('https://example.com');
  assert.equal(seen[0].options.headers['X-Api-Key'], undefined);
});

test('server errors become CustomerGPTError with code and status', async () => {
  const {fetch} = mockFetch([{status: 401, body: {ok: false, error: {code: 'UNAUTHORIZED', message: 'API key required'}}}]);
  const client = new CustomerGPT({fetch});
  await assert.rejects(client.account.usage(), error => error instanceof CustomerGPTError && error.code === 'UNAUTHORIZED' && error.status === 401 && Boolean(error.hint));
});

test('errors carry the request ID from the envelope, falling back to the header', async () => {
  const {fetch} = mockFetch([
    {status: 404, headers: {'X-Request-Id': 'from-header-1'}, body: {ok: false, error: {code: 'HTTP_404', message: 'Not found'}, meta: {requestId: 'from-meta-1'}}},
    {status: 500, headers: {'X-Request-Id': 'from-header-2'}, body: {ok: false, error: {code: 'INTERNAL_ERROR', message: 'Failed'}}},
    {status: 502, headers: {'X-Request-Id': 'from-header-3'}, body: undefined},
    {status: 500, body: {ok: false, error: {code: 'INTERNAL_ERROR', message: 'Failed'}}},
  ]);
  const client = new CustomerGPT({apiKey: 'k', fetch});
  await assert.rejects(client.account.usage(), {code: 'HTTP_404', requestId: 'from-meta-1'});
  await assert.rejects(client.account.usage(), {code: 'INTERNAL_ERROR', requestId: 'from-header-2'});
  await assert.rejects(client.account.usage(), {code: 'HTTP_502', requestId: 'from-header-3'});
  await assert.rejects(client.account.usage(), error => error.code === 'INTERNAL_ERROR' && !('requestId' in error));
});

test('jobs.wait polls with the draft token until ready', async () => {
  const {fetch, seen} = mockFetch([
    {body: {ok: true, data: {id: 'j', status: 'running'}}},
    {body: {ok: true, data: {id: 'j', status: 'ready', previewUrl: 'https://p'}}},
  ]);
  const client = new CustomerGPT({fetch});
  const progress = [];
  const job = await client.jobs.wait({id: 'j', status: 'pending', token: 'secret'}, {intervalMs: 1, onProgress: j => progress.push(j.status)});
  assert.equal(job.status, 'ready');
  assert.equal(job.token, 'secret');
  assert.deepEqual(progress, ['running', 'ready']);
  assert.deepEqual(seen[0].body, {jobId: 'j', token: 'secret'});
});

test('jobs.wait reports failed training', async () => {
  const {fetch} = mockFetch([{body: {ok: true, data: {id: 'j', status: 'failed', error: 'Crawl blocked'}}}]);
  const client = new CustomerGPT({fetch});
  await assert.rejects(client.jobs.wait({id: 'j', status: 'running'}, {intervalMs: 1}), {code: 'TRAINING_FAILED', message: 'Crawl blocked'});
});

test('rejects unsafe base URLs and action names', async () => {
  assert.throws(() => new CustomerGPT({baseUrl: 'http://evil.example', fetch() {}}), {code: 'INVALID_BASE_URL'});
  assert.throws(() => new CustomerGPT({baseUrl: 'https://api.example/api', fetch() {}}), {code: 'INVALID_BASE_URL'});
  assert.equal(new CustomerGPT({baseUrl: 'http://localhost:3000', fetch() {}}).baseUrl, 'http://localhost:3000');
  await assert.rejects(new CustomerGPT({fetch() {}}).call('../admin'), {code: 'INVALID_ACTION'});
});

test('chatbots.delete confirms by default and supports a dry run', async () => {
  const {fetch, seen} = mockFetch(() => ({body: {ok: true, data: {chatbotId: 'c1', name: 'Bot', sources: 1, conversations: 2}}}));
  const client = new CustomerGPT({apiKey: 'k', fetch});
  await client.chatbots.delete('c1', {dryRun: true});
  await client.chatbots.delete('c1');
  assert.equal(seen[0].url.endsWith('/chatbots_delete'), true);
  assert.deepEqual(seen[0].body, {chatbotId: 'c1', dryRun: true, confirm: false});
  assert.deepEqual(seen[1].body, {chatbotId: 'c1', confirm: true});
});

test('knowledge.addLinks and addSitemap send their inputs with default names', async () => {
  const {fetch, seen} = mockFetch(() => ({body: {ok: true, data: {id: 'j', status: 'pending'}}}));
  const client = new CustomerGPT({apiKey: 'k', fetch});
  await client.knowledge.addLinks('c1', ['https://docs.example.com/a', 'https://docs.example.com/b']);
  await client.knowledge.addSitemap('c1', 'https://example.com/sitemap.xml', {maxPages: 20}, {dryRun: true});
  assert.deepEqual(seen[0].body, {chatbotId: 'c1', urls: ['https://docs.example.com/a', 'https://docs.example.com/b'], name: 'docs.example.com links', confirm: true});
  assert.deepEqual(seen[1].body, {chatbotId: 'c1', sitemapUrl: 'https://example.com/sitemap.xml', name: 'example.com sitemap', maxPages: 20, dryRun: true, confirm: false});
});

test('knowledge.addFile sends base64 from bytes, Blob or a base64 string', async () => {
  const {fetch, seen} = mockFetch(() => ({body: {ok: true, data: {id: 'j', status: 'pending'}}}));
  const client = new CustomerGPT({apiKey: 'k', fetch});
  const bytes = new TextEncoder().encode('# FAQ\nOpen 9-18');
  const base64 = Buffer.from(bytes).toString('base64');
  await client.knowledge.addFile('c1', {name: 'faq.md', data: bytes});
  await client.knowledge.addFile('c1', {name: 'faq.md', data: new Blob([bytes])}, {name: 'FAQ'});
  await client.knowledge.addFile('c1', {name: 'faq.md', data: base64}, {}, {dryRun: true});
  assert.deepEqual(seen[0].body, {chatbotId: 'c1', name: 'faq.md', file: {name: 'faq.md', data: base64}, confirm: true});
  assert.equal(seen[1].body.name, 'FAQ');
  assert.equal(seen[1].body.file.data, base64);
  assert.deepEqual(seen[2].body.file, {name: 'faq.md', data: base64});
  assert.equal(seen[2].body.dryRun, true);
});

test('base64 encoding works without Buffer (browsers, edge runtimes)', async () => {
  const {fetch, seen} = mockFetch(() => ({body: {ok: true, data: {}}}));
  const client = new CustomerGPT({apiKey: 'k', fetch});
  const bytes = new Uint8Array(70000).map((_, i) => i % 256);
  const expected = Buffer.from(bytes).toString('base64');
  const saved = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    await client.knowledge.addFile('c1', {name: 'data.csv', data: bytes.buffer});
  } finally { globalThis.Buffer = saved; }
  assert.equal(seen[0].body.file.data, expected);
});

test('knowledge.wait polls training_status until idle and reports what trained', async () => {
  const t0 = '2026-10-05T00:00:00.000Z';
  const replies = [
    {chatbotId: 'c1', idle: false, active: [{jobId: 'j1', sourceId: 's1', name: 'Docs', status: 'running'}], failed: [{jobId: 'old', sourceId: 's0', name: 'Old', error: 'x', failedAt: '2026-10-01T00:00:00.000Z'}], checkedAt: t0},
    {chatbotId: 'c1', idle: true, active: [], failed: [{jobId: 'old', sourceId: 's0', name: 'Old', error: 'x', failedAt: '2026-10-01T00:00:00.000Z'}], checkedAt: t0},
  ];
  const {fetch, seen} = mockFetch(() => ({body: {ok: true, data: replies.shift()}}));
  const client = new CustomerGPT({apiKey: 'k', fetch});
  const progress = [];
  const result = await client.knowledge.wait('c1', {intervalMs: 1, onProgress: s => progress.push(s.idle)});
  assert.equal(seen[0].url.endsWith('/training_status'), true);
  assert.deepEqual(seen[0].body, {chatbotId: 'c1'});
  assert.deepEqual(progress, [false, true]);
  assert.deepEqual(result.trained, [{jobId: 'j1', sourceId: 's1', name: 'Docs'}]);
  assert.deepEqual(result.failed, [], 'failures from before the wait do not count');
});

test('knowledge.wait throws TRAINING_FAILED for training that failed during the wait', async () => {
  const replies = [
    {chatbotId: 'c1', idle: false, active: [{jobId: 'j1', sourceId: 's1', name: 'Docs'}], failed: [], checkedAt: '2026-10-05T00:00:00.000Z'},
    {chatbotId: 'c1', idle: true, active: [], failed: [{jobId: 'j1', sourceId: 's1', name: 'Docs', error: 'Crawl blocked', failedAt: '2026-10-05T00:00:05.000Z'}], checkedAt: '2026-10-05T00:00:06.000Z'},
  ];
  const {fetch} = mockFetch(() => ({body: {ok: true, data: replies.shift()}}));
  const client = new CustomerGPT({apiKey: 'k', fetch});
  await assert.rejects(client.knowledge.wait('c1', {intervalMs: 1}), error => error.code === 'TRAINING_FAILED' && error.training.failed[0].name === 'Docs');
});

test('knowledge.wait times out with what is still training', async () => {
  const {fetch} = mockFetch(() => ({body: {ok: true, data: {chatbotId: 'c1', idle: false, active: [{jobId: 'j1', sourceId: 's1', name: 'Docs'}], failed: [], checkedAt: '2026-10-05T00:00:00.000Z'}}}));
  const client = new CustomerGPT({apiKey: 'k', fetch});
  await assert.rejects(client.knowledge.wait('c1', {timeoutMs: 5, intervalMs: 1}), error => error.code === 'WAIT_TIMEOUT' && error.training.active[0].name === 'Docs');
});
