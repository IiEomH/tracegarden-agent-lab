import test from 'node:test';
import assert from 'node:assert/strict';
import { runCase, evaluate, executeTool } from '../lib/engine.mjs';

const model = protocol => ({ name: 'Test', protocol, modelId: 'test-model', baseUrl: 'https://provider.test/v1', demo: false, inputPrice: 1, outputPrice: 2 });
const c = { prompt: 'Calculate 2 + 3 using calculate.', evaluator: 'tool', expected: 'calculate' };
const json = body => new Response(JSON.stringify(body), { status: 200 });

for (const protocol of ['openai', 'anthropic', 'gemini']) {
  test(`${protocol}: executes a tool, returns its output in the correct protocol, accumulates usage`, async () => {
    const requests = [];
    const fetchImpl = async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body, headers: options.headers });
      const first = requests.length === 1;
      if (protocol === 'openai') return json({ choices: [{ message: first ? { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'calculate', arguments: '{"a":2,"b":3,"operation":"add"}' } }] } : { role: 'assistant', content: '5' }, finish_reason: first ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
      if (protocol === 'anthropic') return json({ content: first ? [{ type: 'tool_use', id: 'tc1', name: 'calculate', input: { a: 2, b: 3, operation: 'add' } }] : [{ type: 'text', text: '5' }], stop_reason: first ? 'tool_use' : 'end_turn', usage: { input_tokens: 100, output_tokens: 10 } });
      return json({ candidates: [{ content: { parts: first ? [{ functionCall: { name: 'calculate', args: { a: 2, b: 3, operation: 'add' } }, thoughtSignature: 'signature-must-survive' }] : [{ text: '5' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } });
    };
    const result = await runCase(model(protocol), c, { fetchImpl, key: 'test-key' });
    assert.equal(result.status, 'completed'); assert.equal(result.passed, true); assert.equal(result.output, '5');
    assert.equal(requests.length, 2); assert.equal(result.usage.input, 200); assert.equal(result.usage.output, 20);
    assert.equal(result.cost, 0.00024);
    const last = protocol === 'gemini' ? requests[1].body.contents.at(-1) : requests[1].body.messages.at(-1);
    if (protocol === 'openai') { assert.equal(last.tool_call_id, 'tc1'); assert.equal(last.content, '{"result":5}'); assert.equal(requests[0].headers.Authorization, 'Bearer test-key'); }
    if (protocol === 'anthropic') { assert.equal(last.content[0].tool_use_id, 'tc1'); assert.equal(last.content[0].content, '{"result":5}'); assert.equal(requests[0].headers['x-api-key'], 'test-key'); }
    if (protocol === 'gemini') { assert.equal(last.parts[0].functionResponse.response.result, 5); assert.equal(requests[1].body.contents[1].parts[0].thoughtSignature, 'signature-must-survive'); assert.equal(requests[0].headers['x-goog-api-key'], 'test-key'); assert.ok(!requests[0].url.includes('test-key')); }
  });
}
test('evaluation distinguishes pure JSON, required keys, keyword AND and successful tools', () => {
  assert.equal(evaluate({ evaluator: 'json', expected: 'a,b' }, '{"a":1,"b":2}', []).passed, true);
  assert.equal(evaluate({ evaluator: 'json', expected: 'a,b' }, '```json\n{"a":1,"b":2}\n```', []).passed, false);
  assert.equal(evaluate({ evaluator: 'json', expected: 'a,b' }, '{"a":1}', []).passed, false);
  assert.equal(evaluate({ evaluator: 'contains', expected: 'Claude|Bedrock' }, 'CLAUDE on bedrock', []).passed, true);
  assert.equal(evaluate({ evaluator: 'contains', expected: 'Claude|Bedrock' }, 'Claude', []).passed, false);
  assert.equal(evaluate(c, '5', [{ type: 'tool', name: 'calculate', error: true }]).passed, false);
});
test('calculator rejects arbitrary code, invalid operations and nonfinite results', () => {
  assert.throws(() => executeTool('calculate', { a: 'process.exit()', b: 1, operation: 'add' }));
  assert.throws(() => executeTool('calculate', { a: 1, b: 0, operation: 'divide' }));
  assert.throws(() => executeTool('calculate', { a: 1, b: 1, operation: 'constructor' }));
  assert.throws(() => executeTool('shell', {}));
});
test('provider errors are not interpreted as model output and do not expose upstream bodies', async () => {
  const result = await runCase(model('openai'), c, { key: 'secret-key', fetchImpl: async () => new Response('sensitive upstream content secret-key', { status: 401 }) });
  assert.equal(result.status, 'error'); assert.match(result.reason, /401/); assert.ok(!JSON.stringify(result).includes('secret-key'));
});
test('openai retries function tools with reasoning_effort none when the gateway requires it', async () => {
  const requests = [];
  const result = await runCase(model('openai'), c, { key: 'test-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: { message: "Function tools with reasoning_effort are not supported for gpt-5.6-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'." } }), { status: 400 });
    }
    const firstSuccessfulTurn = requests.length === 2;
    return json({ choices: [{ message: firstSuccessfulTurn ? { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'calculate', arguments: '{"a":2,"b":3,"operation":"add"}' } }] } : { role: 'assistant', content: '5' }, finish_reason: firstSuccessfulTurn ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
  } });
  assert.equal(result.status, 'completed');
  assert.equal(result.passed, true);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].reasoning_effort, undefined);
  assert.equal(requests[1].reasoning_effort, 'none');
  assert.equal(requests[2].reasoning_effort, undefined);
});
test('missing usage yields unknown cost and special cache usage is not billed using the basic rate', async () => {
  for (const usage of [undefined, { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 80 } }]) {
    const result = await runCase(model('openai'), { prompt: 'Hi', evaluator: 'contains', expected: 'Hi' }, { fetchImpl: async () => json({ choices: [{ message: { role: 'assistant', content: 'Hi' } }], usage }) });
    assert.equal(result.status, 'completed'); assert.equal(result.cost, null);
    if (!usage) assert.equal(result.usage, null);
  }
});
test('repeated tool calls stop at the Agent loop bound', async () => {
  let calls = 0;
  const result = await runCase(model('openai'), c, { fetchImpl: async () => {
    calls++;
    return json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: `tc${calls}`, type: 'function', function: { name: 'calculate', arguments: '{"a":2,"b":3,"operation":"add"}' } }] } }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
  } });
  assert.equal(calls, 5); assert.equal(result.status, 'error'); assert.match(result.reason, /5 轮/);
});
test('already-cancelled jobs do not make upstream requests', async () => {
  const controller = new AbortController(); controller.abort();
  let called = false;
  const result = await runCase(model('openai'), c, { signal: controller.signal, fetchImpl: async () => { called = true; } });
  assert.equal(result.status, 'cancelled'); assert.equal(called, false);
});
test('timeout and invalid JSON are recorded as errors rather than successful evaluations', async () => {
  const timed = await runCase(model('openai'), c, { fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError'); } });
  assert.equal(timed.status, 'error'); assert.match(timed.reason, /45 秒/);
  const malformed = await runCase(model('openai'), c, { fetchImpl: async () => new Response('<html>wrong endpoint</html>') });
  assert.equal(malformed.status, 'error'); assert.match(malformed.reason, /合法 JSON/);
});
