import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMemo } from '../src/features/sender';
import { AIService } from '../src/adapters/ai';
import { createDefaultSettings, createDefaultAISettings } from '../src/state/settings';
import { buildDefaultPrompt, isDefaultPrompt } from '../src/domain/prompt';

function profile() {
  return {
    id: 'p_jacko',
    name: 'Jacko',
    apiUrl: 'http://192.168.31.10:5230',
    apiToken: 'secret-token',
    dailyMemoHeader: '## 📓 Memos',
    syncDaysLimit: 0,
    enabled: true,
    memosApiMode: 'auto',
  };
}

function aiSettings(overrides = {}) {
  return {
    ...createDefaultAISettings(),
    enabled: true,
    provider: 'custom',
    apiBaseUrl: 'http://localhost:1234/v1',
    apiKey: 'ai-key',
    modelName: 'local-model',
    ...overrides,
  };
}

test('case 33: sending a memo posts content and visibility to the account', async () => {
  const calls = [];
  globalThis.__memosRequestUrl = async params => {
    calls.push(params);
    return { status: 200, text: '{}', json: {} };
  };
  try {
    const settings = createDefaultSettings();
    await sendMemo(profile(), settings, '发送的内容', 'PROTECTED');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://192.168.31.10:5230/api/memos');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers.Authorization, 'Bearer secret-token');
    const body = JSON.parse(calls[0].body);
    assert.deepEqual(body, { content: '发送的内容', visibility: 'PROTECTED' });
  } finally {
    delete globalThis.__memosRequestUrl;
  }
});

test('case 34: AI cleans a memo body and falls back to the original on failure', async () => {
  globalThis.__memosRequestUrl = async params => {
    const body = JSON.parse(params.body);
    assert.equal(body.model, 'local-model');
    return {
      status: 200,
      text: '{}',
      json: { choices: [{ message: { content: '整理后的内容' } }] },
    };
  };
  try {
    const service = new AIService(() => aiSettings());
    assert.equal(await service.clean('这是一段足够长的测试内容，用来触发整理逻辑。'), '整理后的内容');
  } finally {
    delete globalThis.__memosRequestUrl;
  }

  globalThis.__memosRequestUrl = async () => ({ status: 500, text: 'boom', json: {} });
  try {
    const service = new AIService(() => aiSettings());
    const original = '这是一段足够长的测试内容，用来触发整理逻辑。';
    assert.equal(await service.clean(original), original);
  } finally {
    delete globalThis.__memosRequestUrl;
  }
});

test('case 34b: a disabled AI service is a no-op and the default prompt is preserved', async () => {
  const service = new AIService(() => aiSettings({ enabled: false }));
  const original = '关闭 AI 时正文必须逐字保留，不做任何改写。';
  assert.equal(await service.clean(original), original);

  const zhPrompt = buildDefaultPrompt(true, false, 'zh');
  assert.equal(isDefaultPrompt(zhPrompt), true);
  assert.equal(isDefaultPrompt(''), true);
  assert.ok(zhPrompt.trim().length > 20);
});

test('case 42: the built-in prompt follows the interface language', () => {
  const zh = buildDefaultPrompt(true, true, 'zh');
  const en = buildDefaultPrompt(true, true, 'en');
  assert.notEqual(zh, en);
  assert.match(zh, /笔记整理助手/);
  assert.match(en, /Markdown note editor/);
  assert.match(en, /#tag/);
  assert.equal(isDefaultPrompt(en), true);
  assert.equal(isDefaultPrompt(zh), true);
  assert.equal(isDefaultPrompt('自定义提示词：整理后输出。'), false);
});

test('case 34c: the model list is fetched from the OpenAI-compatible endpoint', async () => {
  const calls = [];
  globalThis.__memosRequestUrl = async params => {
    calls.push(params.url);
    return { status: 200, text: '{}', json: { data: [{ id: 'model-a' }, { id: 'model-b' }] } };
  };
  try {
    const service = new AIService(() => aiSettings());
    const result = await service.listModels();
    assert.equal(result.success, true);
    assert.deepEqual(result.models, ['model-a', 'model-b']);
    assert.match(calls[0], /\/v1\/models$/);
  } finally {
    delete globalThis.__memosRequestUrl;
  }
});
