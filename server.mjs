import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './lib/store.mjs';
import { probeModel, runCase, SYSTEM, TOOLS } from './lib/engine.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const id = () => randomUUID();
const now = () => new Date().toISOString();
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, label, limit = 12000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(`${label}不能为空，且不超过 ${limit} 字符`);
  return value.trim();
};
function price(value) {
  if (value === '' || value === null || value === undefined) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 100000) fail('单价必须是有效的非负数');
  return result;
}

function seed(store) {
  if (store.list('project').length) return;
  const projectId = id();
  store.put('project', { id: projectId, name: 'API 客服 Agent', description: '验证产品知识、结构化输出与 Tool Use', createdAt: now() });
  [
    { name: '产品知识 · 官方渠道', prompt: 'claudeapi 使用什么渠道？是否支持 Tool Use？请先检索产品文档再回答。', evaluator: 'contains', expected: 'Anthropic|Bedrock|Tool Use', tag: '产品知识' },
    { name: '协议识别 · JSON 输出', prompt: '检索 code0 的资料。仅输出一个 JSON 对象，包含 product 和 protocols 字段，说明产品名称和支持的协议，不要 Markdown。', evaluator: 'json', expected: 'product,protocols', tag: '结构化输出' },
    { name: '工具执行 · 数字计算', prompt: '请使用 calculate 工具计算 128 加上 64，并告诉我结果。', evaluator: 'tool', expected: 'calculate', tag: 'Tool Use' },
  ].forEach(c => store.put('case', { ...c, id: id(), projectId }));
  ['Anthropic', 'OpenAI', 'Gemini'].forEach((name, i) => store.put('model', { id: id(), name: `${name} · Demo`, protocol: ['anthropic', 'openai', 'gemini'][i], modelId: `demo-${name.toLowerCase()}`, baseUrl: '', demo: true, demoVariant: i, inputPrice: null, outputPrice: null, createdAt: now() }));
}

export function createApp({ dataDir = process.env.TRACEGARDEN_DATA_DIR || join(root, 'data'), fetchImpl } = {}) {
  const store = new Store(dataDir);
  seed(store);
  const controllers = new Map();
  // Recover persisted jobs explicitly rather than leaving an infinite loading state.
  for (const run of store.list('run').filter(r => r.status === 'running')) {
    for (const result of store.list('result').filter(r => r.runId === run.id && ['queued', 'running'].includes(r.status)))
      store.put('result', { ...result, status: 'error', passed: false, reason: '服务重启导致运行中断', cost: null });
    store.put('run', { ...run, status: 'interrupted', finishedAt: now() });
  }
  const publicModels = () => store.list('model').map(m => ({ ...m, hasKey: store.hasSecret(m.id) }));
  const summarizeResults = results => {
    const completed = results.filter(r => r.status === 'completed');
    const errors = results.filter(r => r.status === 'error');
    const pass = completed.filter(r => r.passed).length;
    const timed = results.filter(r => Number.isFinite(r.duration));
    const priced = results.filter(r => Number.isFinite(r.cost));
    return {
      completed: completed.length,
      passed: pass,
      failed: completed.length - pass,
      errors: errors.length,
      rate: completed.length ? Math.round(pass / completed.length * 100) : null,
      duration: timed.length ? Math.round(timed.reduce((sum, r) => sum + r.duration, 0) / timed.length) : null,
      cost: priced.length ? priced.reduce((sum, r) => sum + r.cost, 0) : null,
    };
  };
  const publicRuns = () => store.list('run').reverse().map(run => ({ ...run, summary: summarizeResults(store.list('result').filter(r => r.runId === run.id)) }));
  const getRun = runId => {
    const run = store.get('run', runId);
    if (!run) fail('运行记录不存在', 404);
    const results = store.list('result').filter(r => r.runId === runId);
    return { ...run, summary: summarizeResults(results), results };
  };
  async function launch(run, models, cases) {
    const controller = new AbortController();
    controllers.set(run.id, controller);
    const jobs = cases.flatMap(c => models.map(m => ({ c, m, resultId: id() })));
    for (const { c, m, resultId } of jobs) store.put('result', { id: resultId, runId: run.id, projectId: run.projectId, caseId: c.id, caseName: c.name, modelId: m.id, modelName: m.name, demo: m.demo, status: 'queued', passed: null, rating: null, note: '', trace: [], output: '', cost: null, usage: null });
    let cursor = 0;
    async function worker() {
      while (cursor < jobs.length) {
        const { c, m, resultId } = jobs[cursor++];
        const initial = store.get('result', resultId);
        if (controller.signal.aborted) { store.put('result', { ...initial, status: 'cancelled', passed: false, reason: '运行已取消' }); continue; }
        store.put('result', { ...initial, status: 'running' });
        const outcome = await runCase(m, c, { key: store.getSecret(m.id), signal: controller.signal, fetchImpl,
          onTrace: trace => store.put('result', { ...store.get('result', resultId), trace }),
        });
        store.put('result', { ...store.get('result', resultId), ...outcome });
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
      store.put('run', { ...run, status: controller.signal.aborted ? 'cancelled' : 'completed', finishedAt: now() });
    } catch {
      for (const result of store.list('result').filter(r => r.runId === run.id && ['queued', 'running'].includes(r.status)))
        store.put('result', { ...result, status: 'error', passed: false, reason: '内部执行失败，请重试' });
      store.put('run', { ...run, status: 'interrupted', finishedAt: now() });
    } finally { controllers.delete(run.id); }
  }

  async function api(method, path, body) {
    if (method === 'GET' && path === '/api/workspace') return { projects: store.list('project'), cases: store.list('case'), models: publicModels(), runs: publicRuns(), system: SYSTEM, tools: TOOLS };
    if (method === 'POST' && path === '/api/projects') {
      if (store.list('project').length >= 100) fail('项目数量已达上限');
      return store.put('project', { id: id(), name: text(body.name, '项目名', 80), description: typeof body.description === 'string' ? body.description.slice(0, 200) : '', createdAt: now() });
    }
    if (method === 'POST' && path === '/api/cases') {
      if (!store.get('project', body.projectId)) fail('项目不存在');
      const existing = body.id ? store.get('case', body.id) : null;
      if (body.id && (!existing || existing.projectId !== body.projectId)) fail('测试用例不存在', 404);
      if (!['contains', 'json', 'tool'].includes(body.evaluator)) fail('不支持的评测方式');
      const expected = text(body.expected, '预期结果', 2000);
      if (body.evaluator === 'tool' && !TOOLS.some(t => t.name === expected)) fail('请选择已注册的工具');
      if (store.list('case', body.projectId).length >= 100 && !existing) fail('每个项目最多 100 条用例');
      return store.put('case', { id: existing?.id ?? id(), projectId: body.projectId, name: text(body.name, '用例名称', 100), prompt: text(body.prompt, 'Prompt'), evaluator: body.evaluator, expected, tag: typeof body.tag === 'string' ? body.tag.slice(0, 40) : '自定义' });
    }
    if (method === 'POST' && path === '/api/models') {
      const existing = body.id ? store.get('model', body.id) : null;
      if (body.id && !existing) fail('模型连接不存在', 404);
      if (existing?.demo) fail('演示连接不可修改，请新建真实连接');
      if (!['anthropic', 'openai', 'gemini'].includes(body.protocol)) fail('不支持的协议');
      let url;
      try { url = new URL(body.baseUrl); } catch { fail('Base URL 无效'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('Base URL 必须为 HTTPS，且不能包含凭证、查询参数或 #');
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if ((!existing && !apiKey) || apiKey.length > 2000 || /[\r\n]/.test(apiKey)) fail('请填写有效的 API Key');
      if (store.list('model').length >= 50 && !existing) fail('最多保存 50 个模型连接');
      const model = { id: existing?.id ?? id(), name: text(body.name, '连接名称', 80), protocol: body.protocol, modelId: text(body.modelId, '模型 ID', 160), baseUrl: url.toString().replace(/\/+$/, ''), demo: false, inputPrice: price(body.inputPrice), outputPrice: price(body.outputPrice), health: existing?.health ?? null, createdAt: existing?.createdAt ?? now() };
      if (apiKey) store.setSecret(model.id, apiKey);
      store.put('model', model);
      return { ...model, hasKey: true };
    }
    const modelTestMatch = path.match(/^\/api\/models\/([\w-]+)\/test$/);
    if (method === 'POST' && modelTestMatch) {
      const model = store.get('model', modelTestMatch[1]);
      if (!model || model.demo) fail('真实模型连接不存在', 404);
      if (!store.hasSecret(model.id)) fail('模型连接缺少 API Key');
      let health;
      try {
        const probe = await probeModel(model, store.getSecret(model.id), { fetchImpl });
        health = { status: 'ok', checkedAt: now(), latency: probe.latency, message: probe.output || '连接成功，模型接受当前 Agent 请求结构', acceptedToolSchema: probe.acceptedToolSchema };
      } catch (error) {
        health = { status: 'error', checkedAt: now(), latency: null, message: String(error.message || '连接测试失败').slice(0, 300), acceptedToolSchema: false };
      }
      const updated = store.put('model', { ...model, health });
      return { ...updated, hasKey: true };
    }
    const deleteMatch = path.match(/^\/api\/(cases|models)\/([\w-]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const kind = deleteMatch[1] === 'cases' ? 'case' : 'model';
      if (!store.get(kind, deleteMatch[2])) fail('记录不存在', 404);
      if (controllers.size) fail('请等待当前评测结束后再删除', 409);
      store.delete(kind, deleteMatch[2]);
      if (kind === 'model') store.deleteSecret(deleteMatch[2]);
      return { ok: true };
    }
    if (method === 'POST' && path === '/api/runs') {
      if (!store.get('project', body.projectId)) fail('项目不存在');
      if (controllers.size) fail('已有评测正在运行，请等待完成或取消', 409);
      if (!Array.isArray(body.modelIds) || !body.modelIds.length || new Set(body.modelIds).size !== body.modelIds.length) fail('请选择模型连接');
      const models = body.modelIds.map(modelId => store.get('model', modelId));
      if (models.some(m => !m || !m.demo && !store.hasSecret(m.id))) fail('模型配置不存在或缺少 API Key');
      if (new Set(models.map(m => m.demo)).size !== 1) fail('演示模型和真实模型需分开评测');
      const allCases = store.list('case', body.projectId);
      if (body.caseIds && (!Array.isArray(body.caseIds) || new Set(body.caseIds).size !== body.caseIds.length)) fail('测试用例参数无效');
      const cases = body.caseIds ? body.caseIds.map(caseId => allCases.find(c => c.id === caseId)) : allCases;
      if (!cases.length || cases.some(c => !c)) fail('请选择有效的测试用例');
      if (models.length * cases.length > 100) fail('单次评测最多 100 项');
      const run = store.put('run', { id: id(), projectId: body.projectId, name: text(body.name || '新评测', '评测名称', 100), createdAt: now(), status: 'running', demo: models[0].demo, models, cases, system: SYSTEM, total: models.length * cases.length });
      void launch(run, models, cases);
      return getRun(run.id);
    }
    const runMatch = path.match(/^\/api\/runs\/([\w-]+)(\/cancel|\/export)?$/);
    if (runMatch) {
      if (method === 'GET') return getRun(runMatch[1]);
      if (method === 'POST' && runMatch[2] === '/cancel') {
        getRun(runMatch[1]);
        controllers.get(runMatch[1])?.abort();
        return { ok: true };
      }
    }
    const resultMatch = path.match(/^\/api\/results\/([\w-]+)$/);
    if (method === 'PATCH' && resultMatch) {
      const result = store.get('result', resultMatch[1]);
      if (!result) fail('结果不存在', 404);
      if (body.rating !== null && (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5)) fail('评分应为 1～5');
      return store.put('result', { ...result, rating: body.rating, note: typeof body.note === 'string' ? body.note.slice(0, 2000) : '' });
    }
    fail('接口不存在', 404);
  }

  const server = createServer(async (req, res) => {
    const port = server.address()?.port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (!allowedHosts.includes(req.headers.host)) fail('非法 Host', 403);
      if (req.headers.origin && !allowedHosts.some(h => req.headers.origin === `http://${h}`)) fail('仅允许本地同源访问', 403);
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
          if (!String(req.headers['content-type']).startsWith('application/json')) fail('请求必须为 application/json', 415);
          const chunks = [];
          let bytes = 0;
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 100000) fail('请求内容过大', 413); chunks.push(chunk); }
          if (bytes) { try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail('JSON 格式无效'); } }
          if (!body || Array.isArray(body) || typeof body !== 'object') fail('JSON 必须是对象');
        }
        const value = await api(req.method, url.pathname, body);
        if (url.pathname.endsWith('/export')) res.setHeader('Content-Disposition', `attachment; filename="tracegarden-${value.id}.json"`);
        json(200, value);
      } else {
        if (req.method !== 'GET') fail('请求方式不支持', 405);
        const routes = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
        const file = routes[url.pathname];
        if (!file) fail('页面不存在', 404);
        res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` });
        res.end(await readFile(join(root, 'public', file[0])));
      }
    } catch (error) { if (!res.headersSent) json(error.status ?? 500, { error: error.status ? error.message : '服务内部错误' }); else res.end(); }
  });
  return { server, store, close: async () => {
    for (const controller of controllers.values()) controller.abort();
    while (controllers.size) await new Promise(resolve => setTimeout(resolve, 20));
    await new Promise(resolve => server.close(resolve));
    store.close();
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4318);
  const app = createApp();
  app.server.listen(port, '127.0.0.1', () => console.log(`Tracegarden is ready: http://127.0.0.1:${port}`));
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, async () => { await app.close(); process.exit(0); });
}
