import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CustomerGPT, CustomerGPTError, VERSION} from '@customergpt/sdk';

function mockFetch(responses) {
  const seen = [];
  const fetch = async (url, options) => {
    seen.push({url, options, body: options.body && JSON.parse(options.body)});
    const next = typeof responses === 'function' ? responses(seen.at(-1)) : responses.shift();
    return {ok: (next.status ?? 200) < 400, status: next.status ?? 200, json: async () => next.body};
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
