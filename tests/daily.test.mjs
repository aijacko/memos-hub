import test from 'node:test';
import assert from 'node:assert/strict';
import { syncDailyMode } from '../src/features/syncDaily';
import { modifyDailyNote } from '../src/domain/dailyBlocks';
import { renderDailyBlock } from '../src/domain/markdown';
import { normalizeMemo } from '../src/domain/memo';
import { SyncState } from '../src/state/syncState';
import { CancelToken } from '../src/state/cancel';
import { createDefaultSettings } from '../src/state/settings';
import { toDayKey } from '../src/domain/time';

const HEADER = '## 📓 Memos';
const AT = '2026-11-10T04:00:00Z';
const SECONDS = Math.floor(Date.parse(AT) / 1000);
const DAY = toDayKey(SECONDS);

class MemoryNotes {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files));
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
    this.files.set(path, content);
  }

  async modify(path, content) {
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

  async listMarkdown() {
    return [...this.files.keys()];
  }

  mtime() {
    return 0;
  }

  async trash(path) {
    this.files.delete(path);
  }
}

class FakeDailies {
  constructor(notes, filesByDay = {}) {
    this.notes = notes;
    this.byDay = new Map(Object.entries(filesByDay));
  }

  find(day) {
    return this.byDay.get(day) ?? null;
  }

  async create(day) {
    const path = `Journal/${day}.md`;
    this.byDay.set(day, path);
    this.notes.files.set(path, `${HEADER}\n`);
    return path;
  }

  async read(path) {
    return this.notes.read(path);
  }

  async write(path, content) {
    this.notes.files.set(path, content);
  }
}

function rawMemo(uid, content, extra = {}) {
  return { name: `memos/${uid}`, createTime: AT, content, ...extra };
}

function makeProfile() {
  return {
    id: 'p_jacko',
    name: 'Jacko',
    apiUrl: 'http://localhost:5230',
    apiToken: 'secret-token',
    dailyMemoHeader: HEADER,
    syncDaysLimit: 0,
    enabled: true,
    memosApiMode: 'auto',
  };
}

function setup({ files = {}, dailies = {}, memos = [], mode = 'smart', multiAccount = false, settings } = {}) {
  const config = settings ?? createDefaultSettings();
  const profile = makeProfile();
  config.profiles = [profile];
  config.storageMode = 'dailyNote';
  const notes = new MemoryNotes(files);
  const state = new SyncState(config, async () => {});
  const ctx = {
    profile,
    settings: config,
    mode,
    multiAccount,
    api: {
      listMemos: async () => ({ memos, nextPageToken: '' }),
      createMemo: async () => {},
      getPrefix: () => '/api',
    },
    dailies: new FakeDailies(notes, dailies),
    notes,
    attachments: { ensure: async () => null },
    ai: { clean: async content => content },
    state,
    reporter: { status() {}, progress() {} },
    cancel: new CancelToken(),
  };
  return { config, profile, notes, state, ctx };
}

function block(uid, content, extra = {}) {
  return renderDailyBlock(normalizeMemo(rawMemo(uid, content, extra)), {
    useCalloutFormat: false,
    useListCalloutFormat: false,
    skipImages: false,
  });
}

test('case 16: a daily note without the header is skipped', async () => {
  const path = `Journal/${DAY}.md`;
  const { notes, ctx } = setup({
    files: { [path]: '没有标题的日记\n' },
    dailies: { [DAY]: path },
    memos: [rawMemo('aaa', '内容')],
  });
  const outcome = await syncDailyMode(ctx);
  assert.equal(outcome.missingHeaders, 1);
  assert.equal(outcome.written, 0);
  assert.equal(await notes.read(path), '没有标题的日记\n');
});

test('case 17: incremental sync keeps extra local lines', async () => {
  const path = `Journal/${DAY}.md`;
  const local = ['- 🌙 00:00 本地多出的行 #memos-hub ^9999999999'].join('\n');
  const existing = `${HEADER}\n\n${local}\n`;
  const { notes, state, profile, ctx } = setup({
    files: { [path]: existing },
    dailies: { [DAY]: path },
    memos: [rawMemo('aaa', '远端内容')],
  });
  state.setCursor('dailyNote', profile.id, SECONDS - 100);
  await syncDailyMode(ctx);
  const content = await notes.read(path);
  assert.match(content, /本地多出的行/);
  assert.match(content, /远端内容/);
});

test('case 18: a full sync removes blocks deleted on the server', async () => {
  const path = `Journal/${DAY}.md`;
  const stale = '- 🌙 00:00 已被远端删除 #memos-hub ^1111111111';
  const { notes, ctx } = setup({
    files: { [path]: `${HEADER}\n\n${stale}\n` },
    dailies: { [DAY]: path },
    memos: [rawMemo('aaa', '仍在的内容')],
    mode: 'force',
  });
  await syncDailyMode(ctx);
  const content = await notes.read(path);
  assert.doesNotMatch(content, /已被远端删除/);
  assert.match(content, /仍在的内容/);
});

test('case 19: a local checkbox state wins over the server state', async () => {
  const path = `Journal/${DAY}.md`;
  const remote = block('aaa', '- [ ] 待办任务');
  const localLine = remote.content.replace('- [ ]', '- [x]').trim();
  const { notes, ctx } = setup({
    files: { [path]: `${HEADER}\n\n${localLine}\n` },
    dailies: { [DAY]: path },
    memos: [rawMemo('aaa', '- [ ] 待办任务')],
    mode: 'force',
  });
  await syncDailyMode(ctx);
  const content = await notes.read(path);
  assert.match(content, /- \[x\]/);
  assert.doesNotMatch(content, /- \[ \]/);
});

test('case 21: a remote change backs up the local block before overwriting', async () => {
  const path = `Journal/${DAY}.md`;
  const old = block('aaa', '旧的内容').content.trim();
  const { notes, ctx } = setup({
    files: { [path]: `${HEADER}\n\n${old}\n` },
    dailies: { [DAY]: path },
    memos: [rawMemo('aaa', '新的内容')],
  });
  const outcome = await syncDailyMode(ctx);
  assert.equal(outcome.conflicts, 1);
  const backups = [...notes.files.keys()].filter(item => item.includes('/_冲突/'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^Memos\/_冲突\/日记冲突 Jacko \d+\.md$/);
  assert.match(await notes.read(path), /新的内容/);
});

test('case 24: a missing daily note is created and then written', async () => {
  const { notes, ctx } = setup({ memos: [rawMemo('aaa', '内容')] });
  const outcome = await syncDailyMode(ctx);
  assert.equal(outcome.failures, 0);
  const path = `Journal/${DAY}.md`;
  assert.ok(notes.exists(path));
  assert.match(await notes.read(path), /内容/);
});

test('case 20: an unchanged remote memo preserves the local text', () => {
  const remote = block('aaa', '远端旧文案').content;
  const local = remote.replace('远端旧文案', '本地修改后的文案');
  const result = modifyDailyNote(
    `${HEADER}\n\n${local}\n`,
    HEADER,
    { [String(SECONDS)]: remote },
    {
      isIncrementalSync: true,
      lastSyncTime: Math.floor(Date.now() / 1000),
      remoteUpdatedAt: { [String(SECONDS)]: SECONDS },
    },
  );
  assert.ok(result);
  assert.equal(result.preservedLocal.length, 1);
  assert.equal(result.conflicts.length, 0);
});

test('case 22: shared daily sections only delete the current account blocks', () => {
  const render = (uid, content, label, time = AT) => renderDailyBlock(
    normalizeMemo({ name: `memos/${uid}`, createTime: time, content }),
    { useCalloutFormat: false, useListCalloutFormat: false, skipImages: false, accountLabel: label },
  ).content.trim();
  const jacko = render('aaa', 'Jacko 的内容', 'Jacko');
  const bob = render('bbb', 'Bob 的内容', 'Bob', '2026-11-10T05:00:00Z');
  const origin = `${HEADER}\n\n${jacko}\n${bob}\n`;
  const result = modifyDailyNote(origin, HEADER, {}, {
    isIncrementalSync: false,
    deletionAccountLabel: 'Jacko',
  });
  assert.ok(result);
  assert.doesNotMatch(result.content, /Jacko 的内容/);
  assert.match(result.content, /Bob 的内容/);
});

test('case 40: a day without the header pins the cursor only once', async () => {
  const path = `Journal/${DAY}.md`;
  const { state, profile, ctx } = setup({
    files: { [path]: '没有标题的日记\n' },
    dailies: { [DAY]: path },
    memos: [rawMemo('aaa', '内容')],
  });

  await syncDailyMode(ctx);
  assert.equal(state.getCursor('dailyNote', profile.id), SECONDS - 1);
  assert.deepEqual(state.getHeaderMiss(profile.id), [DAY]);

  // Second run still skips the day, but must not pin the cursor forever.
  const second = await syncDailyMode(ctx);
  assert.equal(second.missingHeaders, 1);
  assert.equal(state.getCursor('dailyNote', profile.id), SECONDS);
});

test('case 41: archived daily blocks are kept on a force sync when enabled', async () => {
  const path = `Journal/${DAY}.md`;
  const archivedAt = '2026-11-10T06:00:00Z';
  const archived = block('arch', '归档内容', { state: 'ARCHIVED', createTime: archivedAt }).content.trim();
  const makeSettings = () => {
    const config = createDefaultSettings();
    config.skipArchivedMemos = true;
    config.keepArchivedDailyBlocks = true;
    return config;
  };
  const { notes, ctx } = setup({
    files: { [path]: `${HEADER}\n\n${archived}\n` },
    dailies: { [DAY]: path },
    memos: [rawMemo('aaa', '仍在的内容'), rawMemo('arch', '归档内容', { state: 'ARCHIVED', createTime: archivedAt })],
    mode: 'force',
    settings: makeSettings(),
  });

  await syncDailyMode(ctx);
  const content = await notes.read(path);
  assert.match(content, /归档内容/);
  assert.match(content, /仍在的内容/);
});
