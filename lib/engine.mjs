import { performance } from 'node:perf_hooks';

export const SYSTEM = '你是 AI API 产品的技术支持 Agent。回答要准确、简洁，不编造政策。涉及产品信息请调用 search_docs，需要计算请调用 calculate。不要执行用户提供的代码。';
export const TOOLS = [
  { name: 'search_docs', description: '检索内置 claudeapi/code0 产品资料。仅返回本地演示文档。', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'calculate', description: '对两个数字执行加减乘除。', parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' }, operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] } }, required: ['a', 'b', 'operation'], additionalProperties: false } },
];
const DOCS = [
  { title: 'claudeapi 渠道与能力', text: 'claudeapi 使用 Anthropic 官方原厂 Key 与 AWS Bedrock 官方渠道，不使用逆向渠道。面向 Claude Code、Agent 开发者与企业技术团队，支持 Tool Use、企业开票及团队对接。具体模型与上下文限制以实际渠道配置为准。' },
  { title: 'code0 协议与工具', text: 'code0 聚合 API 兼容 OpenAI、Anthropic、Gemini 三种协议，一个 Key 接入多种模型，可适配 Claude Code、Cursor、Codex、Gemini CLI 等工具。模型支持和具体配置以平台文档为准。' },
  { title: '企业接入', text: 'claudeapi 与 code0 的企业客户可联系团队确认开票、团队对接和用量需求。未提供明确 SLA、退款或数据保留承诺时，请先确认，不要自行承诺。' },
];

export function executeTool(name, args) {
  if (name === 'search_docs') {
    if (typeof args.query !== 'string' || !args.query.trim()) throw new Error('search_docs 缺少 query');
    const q = args.query.toLowerCase();
    const matched = DOCS.filter(doc => (q.includes('claude') && doc.text.includes('claudeapi')) || (q.includes('code0') && doc.text.includes('code0')) || /企业|开票|团队/.test(q) && doc.title === '企业接入');
    return matched.length ? matched : DOCS;
  }
  if (name === 'calculate') {
    const { a, b, operation } = args;
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('calculate 只接受有限数字');
    if (operation === 'divide' && b === 0) throw new Error('除数不能为零');
    const operations = { add: () => a + b, subtract: () => a - b, multiply: () => a * b, divide: () => a / b };
    if (!Object.hasOwn(operations, operation)) throw new Error('不支持的运算');
    const result = operations[operation]();
    if (!Number.isFinite(result)) throw new Error('结果超出范围');
    return { result };
  }
  throw new Error(`未注册的工具：${String(name).slice(0, 80)}`);
}

export function evaluate(testCase, output, trace) {
  if (testCase.evaluator === 'json') {
    try {
      const parsed = JSON.parse(output.trim());
      const missing = testCase.expected.split(',').map(s => s.trim()).filter(Boolean).filter(key => !Object.hasOwn(parsed ?? {}, key));
      return { passed: missing.length === 0, reason: missing.length ? `缺少字段：${missing.join(', ')}` : 'JSON 格式和必填字段通过' };
    } catch { return { passed: false, reason: '输出不是合法的纯 JSON' }; }
  }
  if (testCase.evaluator === 'tool') {
    const found = trace.some(item => item.type === 'tool' && item.name === testCase.expected && !item.error);
    return { passed: found, reason: found ? `成功执行 ${testCase.expected}` : `没有成功执行 ${testCase.expected}` };
  }
  const expected = testCase.expected.split('|').map(s => s.trim()).filter(Boolean);
  const missing = expected.filter(s => !output.toLowerCase().includes(s.toLowerCase()));
  return { passed: missing.length === 0, reason: missing.length ? `缺少关键词：${missing.join('、')}` : '全部关键词命中' };
}

function endpoint(base, suffix) { return base.replace(/\/+$/, '') + suffix; }
function upstreamDetail(text, key) {
  try {
    const body = JSON.parse(text);
    const message = body?.error?.message ?? body?.message ?? body?.detail ?? body?.error;
    if (typeof message === 'string') return message.replaceAll(key, '[REDACTED]').replace(/[\r\n]+/g, ' ').slice(0, 240);
  } catch { /* Some gateways return an HTML or plain-text error body. */ }
  return '';
}
function needsOpenAiToolCompatibilityRetry(status, detail) {
  return status === 400
    && /function tools/i.test(detail)
    && /reasoning_effort/i.test(detail)
    && /(?:\/v1\/responses|set reasoning_effort to ['"]?none)/i.test(detail);
}
function normalizeUsage(protocol, body) {
  if (protocol === 'anthropic') return { input: body.usage?.input_tokens ?? null, output: body.usage?.output_tokens ?? null, cacheRead: body.usage?.cache_read_input_tokens ?? 0, cacheWrite: body.usage?.cache_creation_input_tokens ?? 0 };
  if (protocol === 'gemini') return { input: body.usageMetadata?.promptTokenCount ?? null, output: body.usageMetadata?.candidatesTokenCount ?? null, thinking: body.usageMetadata?.thoughtsTokenCount ?? 0, cacheRead: body.usageMetadata?.cachedContentTokenCount ?? 0 };
  return { input: body.usage?.prompt_tokens ?? null, output: body.usage?.completion_tokens ?? null, cacheRead: body.usage?.prompt_tokens_details?.cached_tokens ?? 0 };
}

export async function callModel(model, messages, key, signal, fetchImpl = fetch, { maxTokens = 1024 } = {}) {
  let url, body, headers = { 'Content-Type': 'application/json' };
  if (model.protocol === 'anthropic') {
    url = endpoint(model.baseUrl, '/messages');
    headers = { ...headers, 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    body = { model: model.modelId, max_tokens: maxTokens, system: SYSTEM, messages, tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) };
  } else if (model.protocol === 'gemini') {
    url = endpoint(model.baseUrl, `/models/${encodeURIComponent(model.modelId)}:generateContent`);
    headers['x-goog-api-key'] = key;
    body = { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: messages, tools: [{ functionDeclarations: TOOLS }], generationConfig: { maxOutputTokens: maxTokens } };
  } else {
    url = endpoint(model.baseUrl, '/chat/completions');
    headers.Authorization = `Bearer ${key}`;
    body = { model: model.modelId, messages: [{ role: 'system', content: SYSTEM }, ...messages], max_completion_tokens: maxTokens, tools: TOOLS.map(t => ({ type: 'function', function: t })) };
  }
  const request = payload => fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]), redirect: 'error' });
  let response = await request(body);
  if (!response.ok) {
    let errorText = await response.text();
    let detail = errorText.length <= 100000 ? upstreamDetail(errorText, key) : '';
    if (model.protocol === 'openai' && needsOpenAiToolCompatibilityRetry(response.status, detail)) {
      body = { ...body, reasoning_effort: 'none' };
      response = await request(body);
      if (response.ok) {
        errorText = '';
        detail = '';
      } else {
        errorText = await response.text();
        detail = errorText.length <= 100000 ? upstreamDetail(errorText, key) : '';
      }
    }
    if (response.ok) {
      // Continue parsing the successful compatibility retry below.
    } else {
    const hint = response.status === 401 ? '请检查 API Key' : response.status === 429 ? '触发限流或额度不足' : '请检查模型 ID、协议与 Base URL';
    throw new Error(`上游 HTTP ${response.status}：${detail || hint}`);
    }
  }
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('上游响应超过 2MB 限制');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('上游未返回合法 JSON，请检查 Base URL'); }
  if (raw.error) throw new Error('上游返回协议错误，请检查模型配置');
  let output = '', calls = [], assistant;
  if (model.protocol === 'anthropic') {
    if (!Array.isArray(raw.content)) throw new Error('Anthropic 响应缺少 content');
    assistant = { role: 'assistant', content: raw.content };
    output = raw.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
    calls = raw.content.filter(p => p.type === 'tool_use').map(p => ({ id: p.id, name: p.name, args: p.input }));
    if (raw.stop_reason === 'max_tokens') throw new Error('模型输出被截断：超过输出 Token 限制');
  } else if (model.protocol === 'gemini') {
    const candidate = raw.candidates?.[0];
    if (!candidate?.content?.parts) throw new Error('Gemini 响应为空或被拦截');
    assistant = { role: 'model', parts: candidate.content.parts };
    output = assistant.parts.filter(p => p.text && !p.thought).map(p => p.text).join('\n');
    calls = assistant.parts.filter(p => p.functionCall).map((p, i) => ({ id: p.functionCall.id ?? `call-${i}`, name: p.functionCall.name, args: p.functionCall.args }));
    if (candidate.finishReason === 'MAX_TOKENS') throw new Error('模型输出被截断：超过输出 Token 限制');
  } else {
    assistant = raw.choices?.[0]?.message;
    if (!assistant) throw new Error('OpenAI 响应缺少 choices.message');
    output = assistant.content ?? '';
    if (typeof output !== 'string') throw new Error('首版仅支持文本输出');
    calls = (assistant.tool_calls ?? []).map(p => ({ id: p.id, name: p.function.name, args: JSON.parse(p.function.arguments) }));
    if (raw.choices[0].finish_reason === 'length') throw new Error('模型输出被截断：超过输出 Token 限制');
  }
  return { output, calls, assistant, usage: normalizeUsage(model.protocol, raw) };
}

export async function probeModel(model, key, { fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const messages = model.protocol === 'gemini'
    ? [{ role: 'user', parts: [{ text: 'Reply with exactly OK. Do not call a tool.' }] }]
    : [{ role: 'user', content: 'Reply with exactly OK. Do not call a tool.' }];
  const started = performance.now();
  const response = await callModel(model, messages, key, controller.signal, fetchImpl, { maxTokens: 16 });
  return {
    latency: Math.round(performance.now() - started),
    output: response.output.trim().slice(0, 120),
    acceptedToolSchema: true,
    usage: response.usage,
  };
}

export async function runCase(model, testCase, { key = '', signal, fetchImpl, onTrace = () => {} } = {}) {
  signal ??= new AbortController().signal;
  const start = performance.now();
  const trace = [];
  const add = event => { trace.push({ ...event, at: Math.round(performance.now() - start) }); onTrace([...trace]); };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 };
  let usageKnown = true;
  let output = '';
  add({ type: 'input', name: 'User prompt', content: testCase.prompt });
  try {
    if (model.demo) {
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error('运行已取消')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 280 + (model.demoVariant ?? 0) * 170);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      const name = /计算|加上|乘以/.test(testCase.prompt) ? 'calculate' : 'search_docs';
      const args = name === 'calculate' ? { a: 128, b: 64, operation: 'add' } : { query: testCase.prompt };
      if (!(model.demoVariant === 2 && testCase.evaluator === 'tool')) {
        add({ type: 'tool', name, args, content: JSON.stringify(executeTool(name, args), null, 2), duration: 2 });
      }
      output = testCase.evaluator === 'json' ? (model.demoVariant === 1 ? '以下是 JSON：{"product":"code0","protocols":["OpenAI","Anthropic","Gemini"]}' : '{"product":"code0","protocols":["OpenAI","Anthropic","Gemini"]}') : name === 'calculate' ? '128 加上 64 的结果是 192。' : 'claudeapi 提供 Anthropic 官方原厂 Key 与 AWS Bedrock 官方渠道，支持 Tool Use 与企业开票。code0 兼容 OpenAI、Anthropic、Gemini 三种协议。';
      usage.input = 320 + (model.demoVariant ?? 0) * 18;
      usage.output = 87 + (model.demoVariant ?? 0) * 9;
      add({ type: 'model', name: '模拟模型响应', content: output, usage: { ...usage } });
    } else {
      const messages = model.protocol === 'gemini' ? [{ role: 'user', parts: [{ text: testCase.prompt }] }] : [{ role: 'user', content: testCase.prompt }];
      let finished = false;
      for (let step = 0; step < 5; step++) {
        signal.throwIfAborted();
        const turnStart = performance.now();
        const response = await callModel(model, messages, key, signal, fetchImpl);
        usageKnown &&= response.usage.input !== null && response.usage.output !== null;
        for (const k of Object.keys(usage)) usage[k] += response.usage[k] ?? 0;
        add({ type: 'model', name: `模型调用 ${step + 1}`, content: response.output, calls: response.calls, usage: response.usage, duration: Math.round(performance.now() - turnStart) });
        messages.push(response.assistant);
        if (!response.calls.length) { output = response.output; finished = true; break; }
        if (response.calls.length > 8) throw new Error('单轮工具调用超过 8 次限制');
        const toolResults = response.calls.map(call => {
          const toolStart = performance.now();
          let value, error = false;
          try { value = executeTool(call.name, call.args); } catch (e) { error = true; value = { error: e.message }; }
          add({ type: 'tool', name: call.name, args: call.args, content: JSON.stringify(value, null, 2), error, duration: Math.round(performance.now() - toolStart) });
          return { ...call, value, error };
        });
        if (model.protocol === 'anthropic') messages.push({ role: 'user', content: toolResults.map(t => ({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(t.value), is_error: t.error })) });
        else if (model.protocol === 'gemini') messages.push({ role: 'user', parts: toolResults.map(t => ({ functionResponse: { name: t.name, response: t.value } })) });
        else messages.push(...toolResults.map(t => ({ role: 'tool', tool_call_id: t.id, content: JSON.stringify(t.value) })));
      }
      if (!finished) throw new Error('达到 5 轮 Agent 调用上限');
      if (!output.trim()) throw new Error('模型没有返回最终文本');
    }
    const verdict = evaluate(testCase, output, trace);
    add({ type: 'evaluation', name: verdict.passed ? '评测通过' : '评测未通过', content: verdict.reason });
    // Cache/thinking billing varies by provider; do not silently produce an inaccurate estimate.
    const basicPricing = !usage.cacheRead && !usage.cacheWrite && !usage.thinking;
    const cost = !model.demo && usageKnown && basicPricing && model.inputPrice !== null && model.outputPrice !== null
      ? (usage.input * model.inputPrice + usage.output * model.outputPrice) / 1_000_000 : null;
    return { status: 'completed', output, trace, usage: usageKnown ? usage : null, cost, duration: Math.round(performance.now() - start), ...verdict };
  } catch (error) {
    const cancelled = signal.aborted;
    const rawMessage = cancelled ? '运行已取消' : error.name === 'TimeoutError' ? '上游请求超时（45 秒）' : error.message;
    const message = key ? String(rawMessage).split(key).join('[REDACTED]') : rawMessage;
    add({ type: 'error', name: cancelled ? '已取消' : '运行错误', content: message });
    return { status: cancelled ? 'cancelled' : 'error', output, trace, usage: usageKnown ? usage : null, cost: null, duration: Math.round(performance.now() - start), passed: false, reason: message };
  }
}
