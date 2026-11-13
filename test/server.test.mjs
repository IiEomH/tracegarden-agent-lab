import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { Store } from '../lib/store.mjs';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'tracegarden-test-'));
  const app = createApp({ dataDir, ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { ...app, base, dataDir, request };
}

test('workspace → persisted demo run → rating → snapshot export without secrets', async t => {
  const { request, store } = await fixture(t);
  const workspace = (await request('/api/workspace')).body;
  const projectId = workspace.projects[0].id;
  const started = await request('/api/runs', 'POST', { projectId, modelIds: workspace.models.map(m => m.id), name: 'Reproducible demo' });
  assert.equal(started.status, 200); assert.equal(started.body.total, 9);
  let report;
  for (let i = 0; i < 80; i++) {
    report = (await request(`/api/runs/${started.body.id}`)).body;
    if (report.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(report.status, 'completed'); assert.equal(report.results.length, 9);
  assert.equal(report.results.filter(r => r.passed).length, 7);
  assert.equal(report.summary.rate, 78); assert.equal(report.summary.errors, 0);
  const result = report.results[0];
  assert.equal((await request(`/api/results/${result.id}`, 'PATCH', { rating: 4, note: 'Human review' })).body.rating, 4);
  const snapshot = report.cases[0].prompt;
  await request('/api/cases', 'POST', { ...workspace.cases[0], prompt: 'Changed prompt' });
  const exported = (await request(`/api/runs/${report.id}/export`)).body;
  assert.equal(exported.cases[0].prompt, snapshot); assert.equal(exported.results[0].note, 'Human review');
  assert.equal((await request('/api/workspace')).body.runs[0].summary.rate, 78);
  assert.equal(store.get('run', report.id).name, 'Reproducible demo');
  assert.ok(exported.results.every(r => r.demo && r.cost === null));
});
test('connection test stores health without exposing the API key', async t => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1 } }), { status: 200 });
  const { request } = await fixture(t, { fetchImpl });
  const created = (await request('/api/models', 'POST', { name: 'Probe', protocol: 'openai', baseUrl: 'https://example.com/v1', modelId: 'test-model', apiKey: 'private-test-key' })).body;
  const tested = (await request(`/api/models/${created.id}/test`, 'POST', {})).body;
  assert.equal(tested.health.status, 'ok'); assert.equal(tested.health.acceptedToolSchema, true);
  assert.ok(Number.isFinite(tested.health.latency)); assert.ok(!JSON.stringify(tested).includes('private-test-key'));
  const workspace = (await request('/api/workspace')).body;
  assert.equal(workspace.models.find(m => m.id === created.id).health.status, 'ok');
  assert.ok(!JSON.stringify(workspace).includes('private-test-key'));
});
test('a run can target a dataset subset', async t => {
  const { request } = await fixture(t);
  const workspace = (await request('/api/workspace')).body;
  const started = (await request('/api/runs', 'POST', { projectId: workspace.projects[0].id, modelIds: [workspace.models[0].id], caseIds: [workspace.cases[0].id], name: 'Subset' })).body;
  assert.equal(started.total, 1); assert.equal(started.cases.length, 1);
  let report;
  for (let i = 0; i < 40; i++) {
    report = (await request(`/api/runs/${started.id}`)).body;
    if (report.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.equal(report.status, 'completed'); assert.equal(report.results.length, 1); assert.equal(report.summary.completed, 1);
});
test('encrypted credentials are not returned in config or stored as plaintext', async t => {
  const { request, store, dataDir } = await fixture(t);
  const secret = 'test-secret-very-private';
  const model = await request('/api/models', 'POST', { name: 'Real connection', protocol: 'openai', baseUrl: 'https://example.com/v1', modelId: 'example-model', apiKey: secret });
  assert.equal(model.status, 200); assert.equal(model.body.hasKey, true); assert.ok(!JSON.stringify(model.body).includes(secret));
  assert.equal(store.getSecret(model.body.id), secret);
  const workspace = (await request('/api/workspace')).body;
  assert.ok(!JSON.stringify(workspace).includes(secret));
  const encrypted = store.db.prepare('SELECT value FROM secrets WHERE id=?').get(model.body.id).value;
  assert.ok(!encrypted.includes(secret));
  const updated = await request('/api/models', 'POST', { ...model.body, name: 'Renamed', apiKey: '' });
  assert.equal(updated.status, 200); assert.equal(store.getSecret(model.body.id), secret);
  const projectId = workspace.projects[0].id;
  assert.equal((await request('/api/runs', 'POST', { projectId, modelIds: [model.body.id, workspace.models[0].id] })).status, 400);
  assert.equal((await request(`/api/models/${model.body.id}`, 'DELETE', {})).status, 200);
  assert.equal(store.hasSecret(model.body.id), false);
  assert.equal((await readFile(join(dataDir, 'vault.key'))).length, 32);
});
test('cross-origin writes, malformed config and duplicate run tasks are rejected', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/projects', 'POST', { name: 'Bad' }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await request('/api/projects', 'POST', { name: 'Bad' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request('/api/models', 'POST', { name: 'Bad', protocol: 'openai', baseUrl: 'http://example.com', modelId: 'x', apiKey: 'x' })).status, 400);
  assert.equal((await request('/api/models', 'POST', { name: 'Bad', protocol: 'openai', baseUrl: 'https://example.com?key=secret', modelId: 'x', apiKey: 'x' })).status, 400);
  const workspace = (await request('/api/workspace')).body;
  assert.equal((await request('/api/runs', 'POST', { projectId: workspace.projects[0].id, modelIds: [workspace.models[0].id, workspace.models[0].id] })).status, 400);
});
test('cancellation retains a complete set of task statuses', async t => {
  const { request } = await fixture(t);
  const w = (await request('/api/workspace')).body;
  const r = (await request('/api/runs', 'POST', { projectId: w.projects[0].id, modelIds: w.models.map(m => m.id) })).body;
  await request(`/api/runs/${r.id}/cancel`, 'POST', {});
  let report;
  for (let i = 0; i < 30; i++) {
    report = (await request(`/api/runs/${r.id}`)).body;
    if (report.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(report.status, 'cancelled'); assert.equal(report.results.length, 9);
  assert.ok(report.results.every(r => !['running', 'queued'].includes(r.status)));
});
test('restart marks abandoned runs interrupted and preserves vault contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tracegarden-recovery-'));
  const first = new Store(dir);
  first.setSecret('model', 'persistent-key');
  first.put('run', { id: 'abandoned', status: 'running' });
  first.put('result', { id: 'result', runId: 'abandoned', status: 'queued' });
  first.close();
  const app = createApp({ dataDir: dir });
  try {
    assert.equal(app.store.get('run', 'abandoned').status, 'interrupted');
    assert.equal(app.store.get('result', 'result').status, 'error');
    assert.equal(app.store.getSecret('model'), 'persistent-key');
  } finally { await app.close(); await rm(dir, { recursive: true }); }
});
