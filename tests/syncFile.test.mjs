import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, resolveTargetPath } from '../src/features/syncFile';
import { normalizeMemo } from '../src/domain/memo';
import { createDefaultSettings } from '../src/state/settings';
import { formatLocalIso } from '../src/domain/time';

const ISO = '2026-11-10T00:24:11Z';
const SECONDS = Math.floor(Date.parse(ISO) / 1000);

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
}

function note(uid, created, extra = '') {
  return ['---', `memo_id: ${uid}`, 'account: Jacko', `created: ${created}`, '---', '', '正文', extra].join('\n');
}

function makeCtx(notes, settings, profile) {
  return {
    profile,
    settings,
    mode: 'smart',
    multiAccount: settings.profiles.filter(item => item.enabled).length > 1,
    api: {},
    notes,
    attachments: {},
    ai: { clean: async content => content },
    state: {},
    reporter: { status() {}, progress() {} },
    cancel: { isCancelled: false },
  };
}

function makeProfile(name = 'Jacko') {
  return {
    id: 'p_test',
    name,
    apiUrl: 'http://localhost:5230',
    apiToken: 'token',
    dailyMemoHeader: '## 📓 Memos',
    syncDaysLimit: 0,
    enabled: true,
    memosApiMode: 'auto',
  };
}

test('case 7: two memos in the same second get distinct files', async () => {
  const settings = createDefaultSettings();
  const profile = makeProfile();
  settings.profiles = [profile];
  const notes = new MemoryNotes();
  const ctx = makeCtx(notes, settings, profile);

  const first = normalizeMemo({ name: 'memos/aaa', createTime: ISO, content: '第一条' });
  const second = normalizeMemo({ name: 'memos/bbb', createTime: ISO, content: '第二条' });

  const firstTarget = await resolveTargetPath(ctx, await buildIndex(ctx, 'Memos'), 'Memos', first, 'Jacko');
  assert.match(firstTarget.path, /^Memos\/\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.md$/);
  await notes.create(firstTarget.path, note(first.uid, formatLocalIso(first.createdAt)));

  const index = await buildIndex(ctx, 'Memos');
  const secondTarget = await resolveTargetPath(ctx, index, 'Memos', second, 'Jacko');
  assert.notEqual(secondTarget.path, firstTarget.path);
  assert.match(secondTarget.path, /-2\.md$/);
});

test('case 8: changing format and folder depth keeps the existing file', async () => {
  const settings = createDefaultSettings();
  const profile = makeProfile();
  settings.profiles = [profile];
  const existing = 'Memos/2026-11-10 00-24-11.md';
  const notes = new MemoryNotes({ [existing]: note('aaa', formatLocalIso(SECONDS)) });
  const ctx = makeCtx(notes, settings, profile);

  settings.fileNameFormat = 'YYYYMMDD-HHmmss';
  settings.folderDepth = 'yearMonth';

  const index = await buildIndex(ctx, 'Memos');
  assert.equal(index.byUid.get('aaa'), existing);

  const memo = normalizeMemo({ name: 'memos/aaa', createTime: ISO, content: '正文' });
  const target = await resolveTargetPath(ctx, index, 'Memos', memo, 'Jacko');
  assert.equal(target.path, existing);
  assert.equal(target.exists, true);
});

test('case 9: a user frontmatter key does not move the file', async () => {
  const settings = createDefaultSettings();
  const profile = makeProfile();
  settings.profiles = [profile];
  const existing = 'Memos/2026-11-10 00-24-11.md';
  const notes = new MemoryNotes({ [existing]: note('aaa', formatLocalIso(SECONDS), 'status: done') });
  const ctx = makeCtx(notes, settings, profile);

  const index = await buildIndex(ctx, 'Memos');
  const memo = normalizeMemo({ name: 'memos/aaa', createTime: ISO, content: '正文' });
  const target = await resolveTargetPath(ctx, index, 'Memos', memo, 'Jacko');
  assert.equal(target.path, existing);
});

test('case 15: folderDepth=yearMonth writes into YYYY/MM', async () => {
  const settings = createDefaultSettings();
  settings.folderDepth = 'yearMonth';
  const profile = makeProfile();
  settings.profiles = [profile];
  const notes = new MemoryNotes();
  const ctx = makeCtx(notes, settings, profile);

  const memo = normalizeMemo({ name: 'memos/aaa', createTime: ISO, content: '正文' });
  const target = await resolveTargetPath(ctx, await buildIndex(ctx, 'Memos'), 'Memos', memo, 'Jacko');
  assert.match(target.path, /^Memos\/\d{4}\/\d{2}\//);
  assert.equal(target.exists, false);
});
