import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dominion-anthropic-'));
process.env.DOMINION_DATA = data;
process.env.DOMINION_WORKSPACE = path.join(data, 'workspace');
const { toAnthropicMessages, toAnthropicTools, saveProvider, availableModels, streamCompletion } = await import('../server/providers.mjs');

function startServer(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port }));
  });
}
const readBody = request => new Promise(resolve => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => resolve(body));
});

test.after(() => { try { fs.rmSync(data, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); } catch { /* SQLite keeps a handle on Windows */ } });

test('Anthropic translator keeps system text, tool calls and tool results', () => {
  const translated = toAnthropicMessages([
    { role: 'system', content: 'You are a careful agent.' },
    { role: 'user', content: 'Create a file.' },
    {
      role: 'assistant',
      content: 'I will write it.',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'file_write', arguments: '{"path":"C:\\\\tmp\\\\a.txt","content":"ok"}' } }]
    },
    { role: 'tool', tool_call_id: 'call_1', content: '{"written":"a.txt"}' },
    { role: 'user', content: 'Thanks.' }
  ]);

  assert.equal(translated.system, 'You are a careful agent.');
  assert.deepEqual(translated.messages.map(message => message.role), ['user', 'assistant', 'user']);

  const assistant = translated.messages[1];
  assert.equal(assistant.content[0].type, 'text');
  assert.equal(assistant.content[1].type, 'tool_use');
  assert.equal(assistant.content[1].name, 'file_write');
  assert.deepEqual(assistant.content[1].input, { path: 'C:\\tmp\\a.txt', content: 'ok' });

  const followUp = translated.messages[2];
  assert.equal(followUp.content[0].type, 'tool_result');
  assert.equal(followUp.content[0].tool_use_id, 'call_1');
  assert.equal(followUp.content[1].type, 'text');
  assert.equal(followUp.content[1].text, 'Thanks.');
});

test('Anthropic translator merges consecutive user messages', () => {
  const translated = toAnthropicMessages([
    { role: 'user', content: 'first' },
    { role: 'user', content: 'second' }
  ]);
  assert.equal(translated.messages.length, 1);
  assert.deepEqual(translated.messages[0].content, [
    { type: 'text', text: 'first' },
    { type: 'text', text: 'second' }
  ]);
});

test('Anthropic tool schemas use input_schema', () => {
  const tools = toAnthropicTools([{ name: 'file_write', description: 'Write a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }]);
  assert.deepEqual(tools, [{ name: 'file_write', description: 'Write a file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }]);
});

test('Anthropic adapter lists models and streams text with usage', async () => {
  let seen = null;
  const { server, base } = await startServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Claude Test' }] }));
      return;
    }
    seen = JSON.parse(await readBody(request));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n');
    response.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n');
    response.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n');
    response.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    response.write('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n');
    response.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    response.end();
  });
  try {
    const provider = saveProvider({ name: 'Fake Anthropic', baseUrl: base + '/v1', kind: 'anthropic', enabled: true, apiKey: 'test-key' });
    const models = await availableModels(provider.id);
    assert.deepEqual(models, [{ id: 'claude-test', name: 'Claude Test' }]);

    const result = await streamCompletion({ providerId: provider.id, model: 'claude-test', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'hi' }], tools: [] });
    assert.equal(result.content, 'hello');
    assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 });
    assert.equal(seen.system, 'Be brief.');
    assert.equal(seen.messages[0].role, 'user');
  } finally {
    server.close();
  }
});

test('Anthropic adapter maps streamed tool_use blocks to function calls', async () => {
  let seen = null;
  const { server, base } = await startServer(async (request, response) => {
    seen = JSON.parse(await readBody(request));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\n');
    response.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"file_write"}}\n\n');
    response.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.txt\\","}}\n\n');
    response.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"content\\":\\"ok\\"}"}}\n\n');
    response.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    response.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    response.end();
  });
  try {
    const provider = saveProvider({ name: 'Fake Anthropic Tools', baseUrl: base + '/v1', kind: 'anthropic', enabled: true, apiKey: 'test-key' });
    const result = await streamCompletion({
      providerId: provider.id,
      model: 'claude-test',
      messages: [{ role: 'user', content: 'write a file' }],
      tools: [{ name: 'file_write', description: 'Write a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } }]
    });
    assert.equal(result.tool_calls.length, 1);
    assert.equal(result.tool_calls[0].function.name, 'file_write');
    assert.deepEqual(JSON.parse(result.tool_calls[0].function.arguments), { path: 'a.txt', content: 'ok' });
    assert.equal(seen.tools[0].input_schema.properties.path.type, 'string');
  } finally {
    server.close();
  }
});
