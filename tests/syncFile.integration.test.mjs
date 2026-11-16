import test from 'node:test';
import assert from 'node:assert/strict';
import { syncFileMode } from '../src/features/syncFile';
import { syncDailyMode } from '../src/features/syncDaily';
import { runSync, syncedToday } from '../src/features/syncEngine';
import { SyncState } from '../src/state/syncState';
import { CancelToken } from '../src/state/cancel';
import { createDefaultSettings } from '../src/state/settings';
import { normalizeMemo } from '../src/domain/memo';
import { formatLocalIso } from '../src/domain/time';
import { MemosHttpApi } from '../src/adapters/memosHttp';
import { t } from '../src/i18n/t';

const ISO = '2026-11-10T00:24:11Z';
const SECONDS = Math.floor(Date.parse(ISO) / 1000);

class MemoryNotes {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files));
    this.failOn = null;
  }

  exists(path) {
    return this.files.has(path);
  }

  async read(path) {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`missing: ${path}`);
    return value;
  }

  async create(path, content) {
    if (this.failOn && content.includes(this.failOn)) throw new Error('write failed');
    this.files.set(path, content);
  }

  async modify(path, content) {
    if (this.failOn && content.includes(this.failOn)) throw new Error('write failed');
    this.files.set(path, content);
  }

  async copy(from, to) {
    this.files.set(to, this.files.get(from) ?? '');
  }

  async rename(from, to) {
    this.files.set(to, this.files.get(from) ?? '');
    this.files.delete(from);
  }

  async ensureFolder() {}

  async listMarkdown(root, _depth, skip) {
    return [...this.files.keys()].filter(path => path.startsWith(`${root}/`)
      && !skip.some(name => path.split('/').includes(name)));
  }

  mtime() {
    return 0;
  }

  async trash(path) {
    this.files.delete(path);
  }

  paths() {
    return [...this.files.keys()];
  }
}

function rawMemo(uid, content, created = ISO, extra = {}) {
  return { name: `memos/${uid}`, createTime: created, content, ...extra };
}

function fakeApi(memos) {
  return {
    listMemos: async () => ({ memos, nextPageToken: '' }),
    createMemo: async () => {},
    getPrefix: () => '/api',
  };
}

function makeProfile(name, id = 'p_' + name) {
  return {
    id,
    name,
    apiUrl: 'http://localhost:5230',
    apiToken: 'secret-token',
    dailyMemoHeader: '## 📓 Memos',
    syncDaysLimit: 0,
    enabled: true,
    memosApiMode: 'auto',
  };
}

function note(uid, body, extra = '') {
  return ['---', `memo_id: ${uid}`, `account: Jacko`, `created: ${formatLocalIso(SECONDS)}`, '---', '', body, extra].join('\n');
}

function setup({ files = {}, memos = [], mode = 'smart', multiAccount = false } = {}) {
  const settings = createDefaultSettings();
  const profile = makeProfile('Jacko');
  settings.profiles = multiAccount ? [profile, makeProfile('Bob')] : [profile];
  const notes = new MemoryNotes(files);
  const state = new SyncState(settings, async () => {});
  const ctx = {
    profile,
    settings,
    mode,
    multiAccount,
    api: fakeApi(memos),
    notes,
    attachments: { ensure: async () => null },
    ai: { clean: async content => content },
    state,
    reporter: { status() {}, progress() {} },
    cancel: new CancelToken(),
  };
  return { settings, profile, notes, state, ctx };
}

test('case 10: a locally edited note is backed up before being overwritten', async () => {
  const { notes, ctx } = setup({
    files: { 'Memos/2026-11-10 00-24-11.md': note('aaa', '用户改过的内容') },
    memos: [rawMemo('aaa', '远端内容')],
  });
  const outcome = await syncFileMode(ctx);
  assert.equal(outcome.conflicts, 1);
  const backups = notes.paths().filter(path => path.includes('/_冲突/'));
  assert.equal(backups.length, 1);
  assert.match(await notes.read(backups[0]), /用户改过的内容/);
  assert.match(await notes.read('Memos/2026-11-10 00-24-11.md'), /远端内容/);
});

test('case 11: local note without a hash but with the same body is not backed up', async () => {
  const { notes, ctx } = setup({
    files: { 'Memos/2026-11-10 00-24-11.md': note('aaa', '正文') },
    memos: [rawMemo('aaa', '正文')],
  });
  const outcome = await syncFileMode(ctx);
  assert.equal(outcome.conflicts, 0);
  assert.equal(notes.paths().filter(path => path.includes('_冲突')).length, 0);
});

test('case 12: forcing a sync moves deleted memos into _已删除, and leaves them when disabled', async () => {
  const seeded = { 'Memos/2026-11-01 00-00-00.md': note('old', '旧内容') };
  const first = setup({ files: seeded, memos: [rawMemo('aaa', '新内容')], mode: 'force' });
  await syncFileMode(first.ctx);
  assert.ok(!first.notes.exists('Memos/2026-11-01 00-00-00.md'));
  assert.ok(first.notes.paths().some(path => path.startsWith('Memos/_已删除/')));

  const second = setup({ files: seeded, memos: [rawMemo('aaa', '新内容')], mode: 'force' });
  second.settings.handleDeletedMemos = false;
  await syncFileMode(second.ctx);
  assert.ok(second.notes.exists('Memos/2026-11-01 00-00-00.md'));
});

test('case 13: a note deleted locally is not recreated', async () => {
  const { notes, state, profile, ctx } = setup({ memos: [rawMemo('aaa', '远端内容')] });
  state.setKnown(profile.id, ['aaa']);
  const outcome = await syncFileMode(ctx);
  assert.equal(outcome.deletedLocally, 1);
  assert.ok(!notes.paths().some(path => path.startsWith('Memos/2026-11-10')));
  assert.deepEqual(state.getIgnored(profile.id), ['aaa']);
});

test('case 13b: a deleted note is still ignored after an incremental run', async () => {
  const later = '2026-11-11T00:00:00Z';
  const first = setup({ files: { 'Memos/2026-11-10 00-24-11.md': note('aaa', '正文') }, memos: [rawMemo('aaa', '正文')] });
  await syncFileMode(first.ctx);

  first.notes.files.delete('Memos/2026-11-10 00-24-11.md');
  first.ctx.mode = 'smart';
  first.ctx.api = fakeApi([rawMemo('aaa', '正文'), rawMemo('bbb', '另一个', later)]);
  await syncFileMode(first.ctx);
  assert.ok(!first.notes.paths().some(path => path.startsWith('Memos/2026-11-10')));

  // A later force sync must not resurrect the deleted note either.
  first.ctx.mode = 'force';
  await syncFileMode(first.ctx);
  assert.ok(!first.notes.paths().some(path => path.startsWith('Memos/2026-11-10')));
  assert.ok(first.state.getIgnored(first.profile.id).includes('aaa'));
});

test('case 14: multi-account sync prefixes new file names', async () => {
  const { notes, ctx } = setup({ memos: [rawMemo('aaa', '内容')], multiAccount: true });
  await syncFileMode(ctx);
  const created = notes.paths().find(path => path.startsWith('Memos/'));
  assert.match(created, /^Memos\/Jacko-/);

  const single = setup({ memos: [rawMemo('aaa', '内容')] });
  await syncFileMode(single.ctx);
  const plain = single.notes.paths().find(path => path.startsWith('Memos/'));
  assert.doesNotMatch(plain, /^Memos\/Jacko-/);
});

test('case 25: a failed write stops the cursor before that memo', async () => {
  const later = '2026-11-10T02:00:00Z';
  const { notes, settings, profile, ctx } = setup({
    memos: [rawMemo('aaa', '正常内容'), rawMemo('bbb', 'FAIL 内容', later)],
  });
  notes.failOn = 'FAIL 内容';
  const outcome = await syncFileMode(ctx);
  assert.equal(outcome.failures, 1);
  const laterSeconds = Math.floor(Date.parse(later) / 1000);
  assert.equal(settings.lastSyncByProfile.file[profile.id], String(laterSeconds - 1));
});

test('case 26: cancelling leaves the cursor untouched', async () => {
  const { settings, profile, ctx } = setup({ memos: [rawMemo('aaa', '内容')] });
  ctx.cancel.cancel();
  const outcome = await syncFileMode(ctx);
  assert.equal(outcome.cancelled, true);
  assert.equal(settings.lastSyncByProfile.file[profile.id], undefined);
});

test('case 28: auto mode falls back to the legacy prefix and remembers it', async () => {
  const calls = [];
  globalThis.__memosRequestUrl = async params => {
    calls.push(params.url);
    if (params.url.includes('/api/memos')) return { status: 404, text: 'not found', json: null };
    return { status: 200, text: '{}', json: { memos: [], nextPageToken: '' } };
  };
  try {
    const api = new MemosHttpApi('http://localhost:5230', 'token', 'auto');
    const page = await api.listMemos({ pageSize: 1 });
    assert.deepEqual(page.memos, []);
    assert.equal(api.getPrefix(), '/api/v1');
    assert.equal(calls.length, 2);
    await api.listMemos({ pageSize: 1 });
    assert.equal(calls.length, 3);
    assert.match(calls[2], /\/api\/v1\/memos/);
  } finally {
    delete globalThis.__memosRequestUrl;
  }
});

test('case 31: notes in nested folders are updated in place', async () => {
  const existing = 'Memos/2026/11/sub/自定义名字.md';
  const { notes, ctx } = setup({
    files: { [existing]: note('aaa', '旧正文') },
    memos: [rawMemo('aaa', '新正文')],
  });
  await syncFileMode(ctx);
  assert.ok(notes.exists(existing));
  assert.match(await notes.read(existing), /新正文/);
  const copies = notes.paths().filter(path => path.startsWith('Memos/') && !path.includes('_'));
  assert.equal(copies.length, 1);
});

test('case 32: one account ignore list does not hide another account memo', async () => {
  const bobNote = 'Memos/Bob-2026-11-09 00-00-00.md';
  const { settings, notes, state, ctx } = setup({
    files: { [bobNote]: note('b1', '旧正文') },
    memos: [rawMemo('a1', '内容')],
    multiAccount: true,
  });
  state.setKnown('p_Jacko', ['a1']);
  await syncFileMode(ctx);
  assert.ok(state.getIgnored('p_Jacko').includes('a1'));
  assert.ok(!notes.paths().some(path => path.startsWith('Memos/Jacko-')));
  assert.ok(notes.exists(bobNote));

  const bob = { ...ctx, profile: settings.profiles[1], api: fakeApi([rawMemo('b1', '新正文', '2026-11-09T00:00:00Z')]) };
  await syncFileMode(bob);
  assert.ok(notes.exists(bobNote));
  assert.match(await notes.read(bobNote), /新正文/);
  assert.deepEqual(state.getIgnored('p_Bob'), []);
});

test('case 27: a 401 on one account does not stop the others and hides the token', async () => {
  const settings = createDefaultSettings();
  const bad = makeProfile('Bad', 'p_bad');
  const good = makeProfile('Good', 'p_good');
  settings.profiles = [bad, good];
  settings.defaultProfileId = 'p_good';
  const notes = new MemoryNotes();
  const state = new SyncState(settings, async () => {});
  const result = await runSync({
    settings,
    state,
    notes,
    dailies: {},
    attachments: { ensure: async () => null },
    ai: { clean: async content => content },
    reporter: { status() {}, progress() {} },
    apiFor: profile => (profile.id === 'p_bad'
      ? { listMemos: async () => { throw new Error(t('API_TOKEN_INVALID')); }, createMemo: async () => {}, getPrefix: () => '/api' }
      : fakeApi([rawMemo('aaa', '内容')])),
  }, 'smart', new CancelToken());

  assert.equal(result.attempted, 2);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].profileId, 'p_bad');
  assert.ok(!result.failures[0].message.includes('secret-token'));
  assert.equal(settings.lastSyncFailures.length, 1);
  assert.ok(notes.paths().some(path => path.startsWith('Memos/Good-')));
});

function makeDailies(files = {}) {
  const map = new Map(Object.entries(files));
  return {
    find: date => (map.has(`${date}.md`) ? `${date}.md` : null),
    create: async date => {
      map.set(`${date}.md`, '## 📓 Memos\n');
      return `${date}.md`;
    },
    read: async path => map.get(path) ?? '',
    write: async (path, content) => {
      map.set(path, content);
    },
    content: path => map.get(path),
  };
}

function dailySetup({ files = {}, memos = [], mode = 'smart' } = {}) {
  const settings = createDefaultSettings();
  settings.storageMode = 'dailyNote';
  const profile = makeProfile('Jacko');
  settings.profiles = [profile];
  const state = new SyncState(settings, async () => {});
  const dailies = makeDailies(files);
  const ctx = {
    profile,
    settings,
    mode,
    multiAccount: false,
    api: fakeApi(memos),
    dailies,
    notes: new MemoryNotes(),
    attachments: { ensure: async () => null },
    ai: { clean: async content => content },
    state,
    reporter: { status() {}, progress() {} },
    cancel: new CancelToken(),
  };
  return { settings, profile, dailies, ctx };
}

test('case 35: a daily note without the header keeps the cursor before that day', async () => {
  const dayOne = '2026-11-09T00:00:00Z';
  const { settings, profile, dailies, ctx } = dailySetup({
    files: {
      '2026-11-09.md': '# 日记\n\n缺少 Memos 标题\n',
      '2026-11-10.md': '## 📓 Memos\n',
    },
    memos: [rawMemo('a1', '昨天的内容', dayOne), rawMemo('b1', '今天的内容')],
  });

  const outcome = await syncDailyMode(ctx);
  assert.equal(outcome.missingHeaders, 1);
  const dayOneSeconds = Math.floor(Date.parse(dayOne) / 1000);
  assert.equal(settings.lastSyncByProfile.dailyNote[profile.id], String(dayOneSeconds - 1));
  assert.match(dailies.content('2026-11-10.md'), /今天的内容/);
});

test('case 36: an account with write failures is not marked as synced today', async () => {
  const settings = createDefaultSettings();
  settings.storageMode = 'dailyNote';
  const profile = makeProfile('Jacko');
  settings.profiles = [profile];
  const state = new SyncState(settings, async () => {});

  const result = await runSync({
    settings,
    state,
    notes: new MemoryNotes(),
    dailies: {
      find: () => '2026-11-10.md',
      create: async () => '2026-11-10.md',
      read: async () => '## 📓 Memos\n',
      write: async () => { throw new Error('write failed'); },
    },
    attachments: { ensure: async () => null },
    ai: { clean: async content => content },
    reporter: { status() {}, progress() {} },
    apiFor: () => fakeApi([rawMemo('aaa', '内容')]),
  }, 'smart', new CancelToken());

  assert.equal(result.failures.length, 1);
  assert.equal(result.succeeded, 0);
  assert.equal(settings.lastSyncDateByProfile[profile.id], undefined);
  assert.equal(syncedToday(settings), false);
});

test('case 37: a full sync keeps blocks whose memos are filtered out by tags', async () => {
  const settings = createDefaultSettings();
  settings.storageMode = 'dailyNote';
  const profile = makeProfile('Jacko');
  settings.profiles = [profile];
  const state = new SyncState(settings, async () => {});
  const dailies = makeDailies({ '2026-11-10.md': '## 📓 Memos\n' });
  const ctx = {
    profile,
    settings,
    mode: 'force',
    multiAccount: false,
    api: fakeApi([rawMemo('keep1', '保留 #keep'), rawMemo('drop1', '不要 #drop', '2026-11-10T00:24:12Z')]),
    dailies,
    notes: new MemoryNotes(),
    attachments: { ensure: async () => null },
    ai: { clean: async content => content },
    state,
    reporter: { status() {}, progress() {} },
    cancel: new CancelToken(),
  };
  await syncDailyMode(ctx);
  assert.match(dailies.content('2026-11-10.md'), /不要/);

  settings.includeTags = 'keep';
  await syncDailyMode(ctx);
  const content = dailies.content('2026-11-10.md');
  assert.match(content, /保留/);
  assert.match(content, /不要/);

  // A memo that really disappeared from the server is still removed.
  ctx.api = fakeApi([rawMemo('keep1', '保留 #keep')]);
  await syncDailyMode(ctx);
  assert.doesNotMatch(dailies.content('2026-11-10.md'), /不要/);
});

test('case 38: stale daily blocks are only removed by a force sync', async () => {
  const { dailies, ctx } = dailySetup({
    files: { '2026-11-10.md': '## 📓 Memos\n\n- 🌙 00:00 旧内容 #memos-hub ^1\n' },
    memos: [rawMemo('aaa', '内容')],
    mode: 'smart',
  });
  await syncDailyMode(ctx);
  assert.match(dailies.content('2026-11-10.md'), /旧内容/);

  ctx.mode = 'force';
  await syncDailyMode(ctx);
  assert.doesNotMatch(dailies.content('2026-11-10.md'), /旧内容/);
});

test('case 39: edits made while a sync runs are not overwritten', async () => {
  const { dailies, ctx } = dailySetup({
    files: { '2026-11-10.md': '## 📓 Memos\n' },
    memos: [rawMemo('aaa', '远端内容')],
  });
  const read = dailies.read.bind(dailies);
  const write = dailies.write.bind(dailies);
  let reads = 0;
  dailies.read = async (path) => {
    const content = await read(path);
    reads++;
    if (reads !== 2) return content;
    // Second read is the pre-write check: simulate a user edit in between.
    const edited = `${content}\n本地编辑`;
    await write(path, edited);
    return edited;
  };

  const outcome = await syncDailyMode(ctx);
  assert.equal(outcome.written, 0);
  assert.match(dailies.content('2026-11-10.md'), /本地编辑/);
  assert.doesNotMatch(dailies.content('2026-11-10.md'), /远端内容/);
});
