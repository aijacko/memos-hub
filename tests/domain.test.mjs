import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMemo } from '../src/domain/memo';
import { extractMemoTags, isValidTag } from '../src/domain/tags';
import { yamlValue, buildFrontmatter, extractCustomFrontmatterLines } from '../src/domain/frontmatter';
import { renderDailyBlock } from '../src/domain/markdown';
import { modifyDailyNote } from '../src/domain/dailyBlocks';
import { formatDate, toDayKey } from '../src/domain/time';

const ISO = '2026-11-10T00:24:11Z';
const SECONDS = Math.floor(Date.parse(ISO) / 1000);

function makeMemo(content, extra = {}) {
  return normalizeMemo({ name: 'memos/abc123', createTime: ISO, content, ...extra });
}

test('case 1: memo without a usable creation time is skipped', () => {
  assert.equal(normalizeMemo({ name: 'memos/abc', content: 'x' }), null);
  assert.equal(normalizeMemo({ name: 'memos/abc', createTime: 'not-a-date', content: 'x' }), null);
  const memo = makeMemo('正文');
  assert.equal(memo.uid, 'abc123');
  assert.equal(memo.createdAt, SECONDS);
});

test('case 1b: Windows line endings in memo content are normalized', () => {
  const memo = makeMemo('第一行\r\n第二行\r第三行');
  assert.equal(memo.content, '第一行\n第二行\n第三行');
});

test('case 2: attachment size is compared as a number', () => {
  const memo = makeMemo('图片', {
    attachments: [{ name: 'attachments/r1', filename: 'a.jpg', type: 'image/jpeg', size: '78323' }],
  });
  assert.equal(memo.resources.length, 1);
  assert.equal(memo.resources[0].size, 78323);
  assert.equal(typeof memo.resources[0].size, 'number');
});

test('case 3: hashtags inside code are not collected', () => {
  const content = ['```', '#notatag', '```', '正文 #real', '内联 `/api/#inline`'].join('\n');
  assert.deepEqual(extractMemoTags({ tags: [], content }), ['real']);
});

test('case 4: numeric-only tags are dropped', () => {
  assert.equal(isValidTag('123'), false);
  assert.equal(isValidTag('a1'), true);
  assert.deepEqual(extractMemoTags({ tags: ['123', 'ok'], content: '#456 #tag' }), ['ok', 'tag']);
});

test('case 5: yaml special scalars are quoted', () => {
  assert.equal(yamlValue('true'), '"true"');
  assert.equal(yamlValue('010'), '"010"');
  assert.equal(yamlValue('null'), '"null"');
  assert.equal(yamlValue('memo_id'), 'memo_id');
  assert.equal(yamlValue('中文标签'), '中文标签');
});

test('case 6: table / heading / quote / code stay inside the list item', () => {
  const content = [
    '开头一行',
    '',
    '## 二级标题',
    '',
    '| 项目 | 状态 |',
    '| --- | --- |',
    '| a | b |',
    '',
    '> 引用内容',
    '',
    '```js',
    'const a = 1;',
    '```',
  ].join('\n');
  const block = renderDailyBlock(makeMemo(content), {
    useCalloutFormat: false,
    useListCalloutFormat: false,
    skipImages: false,
  });
  const lines = block.content.split('\n');
  assert.match(lines[0], /^- .*开头一行 #memos-hub \^\d+$/);
  assert.ok(lines.includes('  ## 二级标题'));
  assert.ok(lines.includes('  | 项目 | 状态 |'));
  assert.ok(lines.includes('  > 引用内容'));
  assert.ok(lines.includes('  ```js'));
  assert.ok(lines.includes('  const a = 1;'));
  assert.match(block.content, /\n\n {2}## 二级标题/);
  assert.match(block.content, /\n\n {2}\| 项目 \| 状态 \|/);
  assert.match(block.content, /\n\n {2}> 引用内容/);
});

test('case 6b: a leading thematic break gets its own indented line', () => {
  const block = renderDailyBlock(makeMemo('---\ntitle: 测试\ntags: [a]\n---'), {
    useCalloutFormat: false,
    useListCalloutFormat: false,
    skipImages: false,
  });
  const lines = block.content.split('\n');
  assert.match(lines[0], /^- .*#memos-hub \^\d+$/);
  assert.ok(!lines[0].includes('---'));
  assert.deepEqual(lines.slice(1, 3), ['', '  ---']);
  assert.ok(lines.includes('  title: 测试'));
});

test('case 6c: task syntax is only recognised at the start of the first line', () => {
  const render = content => renderDailyBlock(makeMemo(content), {
    useCalloutFormat: false,
    useListCalloutFormat: false,
    skipImages: false,
  }).content.split('\n')[0];
  const plain = render('说明 - [ ] 这不是任务');
  assert.ok(plain.includes('说明 - [ ] 这不是任务'));
  assert.ok(!plain.startsWith('- [ ]'));
  assert.match(render('- [ ] 买牛奶'), /^- \[ \] .*买牛奶/);
});

test('case 23: consecutive callouts are separated by a blank line', () => {
  const first = renderDailyBlock(makeMemo('第一条'), {
    useCalloutFormat: true,
    useListCalloutFormat: false,
    skipImages: false,
  });
  const second = renderDailyBlock(
    normalizeMemo({ name: 'memos/def456', createTime: '2026-11-10T01:00:00Z', content: '第二条' }),
    { useCalloutFormat: true, useListCalloutFormat: false, skipImages: false },
  );
  const result = modifyDailyNote(
    '## 📓 Memos\n',
    '## 📓 Memos',
    { [first.timestamp]: first.content, [second.timestamp]: second.content },
    { isIncrementalSync: true },
  );
  assert.ok(result);
  assert.match(result.content, /\n\n+> \[!/);
  assert.ok(result.content.indexOf('第一条') < result.content.indexOf('第二条'));
});

test('user frontmatter keys survive a rewrite', () => {
  const note = ['---', 'memo_id: abc123', 'status: done', 'rating: 5', '---', '', '正文'].join('\n');
  const custom = extractCustomFrontmatterLines(note);
  assert.deepEqual(custom, ['status: done', 'rating: 5']);

  const memo = makeMemo('正文');
  const frontmatter = buildFrontmatter(memo, 'Jacko', ['tag'], 'hash', custom);
  assert.match(frontmatter, /^status: done$/m);
  assert.match(frontmatter, /^rating: 5$/m);
});

test('date helpers keep local formatting stable', () => {
  assert.equal(toDayKey(SECONDS), formatDate(SECONDS, 'YYYY-MM-DD'));
});
