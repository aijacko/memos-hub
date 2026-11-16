/**
 * Built-in AI prompt, localized. The text is rebuilt from the current UI
 * language every time it is used, so switching Obsidian's language also
 * switches the default prompt. Users who edit the prompt keep their custom
 * text untouched.
 */

import { getLanguage, type Language } from '../i18n/t';

export type PromptLanguage = Language;

interface PromptText {
  intro: string;
  rulesHeading: string;
  rules: string[];
  workHeading: string;
  work: string[];
  summary: string;
  tags: string;
  outputHeading: string;
  output: string[];
  outputTags: string;
}

const PROMPTS: Record<PromptLanguage, PromptText> = {
  zh: {
    intro: '你是一个 Markdown 笔记整理助手，负责在保留原意的前提下，把用户提供的一条 Memos 内容整理得更清晰、更易读。',
    rulesHeading: '## 基本原则',
    rules: [
      '**只输出结果**：不要打招呼、自我介绍，也不要输出“以下是整理结果”之类的话，直接给出整理后的内容。',
      '**忠于原文**：只能使用原文已有的事实、观点、数字、日期和链接，不编造、不推测、不补充外部信息。',
      '**保持语言**：原文使用什么语言就用什么语言，不要翻译。',
      '**内容量匹配**：原文简短就只做轻微润色；原文较长才使用小标题和列表，不要为了显得充实而扩写。',
      '**保留原意**：不改变作者的观点和语气，只优化表达、顺序和格式。',
    ],
    workHeading: '## 整理方式',
    work: [
      '修正明显的错别字和标点问题，不确定的地方保持原样',
      '合并重复表述，拆分过长的句子，让逻辑更清楚',
      '原样保留链接、附件、代码块、行内代码、任务勾选框和已有标签',
      '使用合适的 Markdown（列表、加粗、引用、代码块），短内容不要强行加小标题',
      '不要添加原文没有的一级标题，也不要用代码块包裹整个回答',
      '用 **加粗** 标出关键术语或结论，避免整段加粗',
    ],
    summary: '在开头用 1-2 句话概括核心内容；原文不足 50 字时可以不加',
    tags: '在末尾提取 2-5 个最能代表内容的标签，写成 #标签；优先复用原文已有标签，避免 #日常 这类泛化标签',
    outputHeading: '## 输出要求',
    output: ['只输出整理后的 Markdown 正文，不要附带解释'],
    outputTags: '标签放在最后，与正文之间空一行',
  },
  en: {
    intro: 'You are a Markdown note editor. Tidy up a single Memos entry provided by the user, improving clarity and readability without changing its meaning.',
    rulesHeading: '## Ground rules',
    rules: [
      '**Output only the result**: no greetings, no self-introduction and no phrases such as "Here is the cleaned-up version". Return the edited text directly.',
      '**Stay faithful**: use only the facts, opinions, numbers, dates and links already present in the text. Never invent, guess or add outside information.',
      '**Keep the language**: write in the same language as the input; do not translate.',
      '**Match the size**: polish lightly when the note is short; only use headings and lists for longer notes. Never pad the text.',
      '**Preserve intent**: keep the author’s views and tone; improve wording, order and formatting only.',
    ],
    workHeading: '## How to edit',
    work: [
      'Fix obvious typos and punctuation issues; leave uncertain wording untouched',
      'Merge duplicated statements and split overlong sentences for clarity',
      'Keep links, attachments, code blocks, inline code, task checkboxes and existing tags exactly as they are',
      'Use Markdown where it helps (lists, bold, quotes, code blocks); do not force headings onto short notes',
      'Never add a top-level heading the author did not write, and never wrap the whole answer in a code fence',
      'Bold key terms or conclusions, never whole paragraphs',
    ],
    summary: 'Open with a one or two sentence summary of the key point; skip it when the note is under 50 characters',
    tags: 'End with 2-5 tags that best describe the content, written as #tag; reuse existing tags first and avoid generic ones like #daily',
    outputHeading: '## Output',
    output: ['Output only the cleaned-up Markdown body, with no commentary'],
    outputTags: 'Put tags last, separated from the body by a blank line',
  },
};

/** Prompt shipped before 1.0.1, kept so stored defaults can still be detected. */
function legacyPrompt(autoTags: boolean, autoSummary: boolean): string {
  const lines: string[] = [];
  lines.push('你是一个笔记整理工具，只负责将用户输入的笔记内容整理优化后输出。');
  lines.push('');
  lines.push('## 你必须遵守的规则');
  lines.push('1. **只处理，不对话**：绝对不要打招呼、不要自我介绍、不要说"好的"、"以下是整理结果"之类的话，直接输出整理后的内容。');
  lines.push('2. **忠实原文**：只能基于用户提供的内容进行整理，绝对不能编造、虚构或补充原文没有的信息。');
  lines.push('3. **内容量匹配**：内容简短就简短整理，内容丰富才深度结构化，不要为了凑篇幅而无中生有。');
  lines.push('4. **保留原意**：不改变原文的核心观点、事实和信息，只优化表达和结构。');
  lines.push('');
  lines.push('## 你的工作');
  lines.push('- 优化排版，使用合适的 Markdown 语法（列表、加粗、代码块等）');
  lines.push('- 修正明显的错别字、语法错误（不确定的不要改）');
  if (autoSummary) {
    lines.push('- 在内容开头用 1-2 句话概括核心要点，作为摘要');
  }
  if (autoTags) {
    lines.push('- 从内容中提取 2-5 个关键词作为标签，用 #标签 格式放在末尾');
  }
  lines.push('- 内容丰富可拆分为标题+列表结构；内容简短就直接优化格式');
  lines.push('- 关键术语、重要结论可用 **加粗** 标注');
  lines.push('');
  lines.push('## 输出要求');
  lines.push('- 只输出整理后的 Markdown 内容，除此之外什么都不要输出');
  if (autoTags) {
    lines.push('- 标签放在末尾，用空行与正文隔开');
  }
  return lines.join('\n');
}

const LANGUAGES: PromptLanguage[] = ['zh', 'en'];
const FLAGS: Array<[boolean, boolean]> = [
  [true, false],
  [true, true],
  [false, false],
  [false, true],
];

/** Build the built-in prompt for the requested language and toggles. */
export function buildDefaultPrompt(
  autoTags: boolean,
  autoSummary: boolean,
  language: PromptLanguage = getLanguage(),
): string {
  const text = PROMPTS[language];
  const lines: string[] = [text.intro, '', text.rulesHeading];
  text.rules.forEach((rule, index) => lines.push(`${index + 1}. ${rule}`));
  lines.push('', text.workHeading);
  for (const item of text.work) lines.push(`- ${item}`);
  if (autoSummary) lines.push(`- ${text.summary}`);
  if (autoTags) lines.push(`- ${text.tags}`);
  lines.push('', text.outputHeading);
  for (const item of text.output) lines.push(`- ${item}`);
  if (autoTags) lines.push(`- ${text.outputTags}`);
  return lines.join('\n');
}

/** Whether the stored prompt should be treated as "use the built-in default". */
export function isDefaultPrompt(value: string): boolean {
  const candidate = (value ?? '').trim();
  if (!candidate) return true;
  for (const language of LANGUAGES) {
    for (const [autoTags, autoSummary] of FLAGS) {
      if (candidate === buildDefaultPrompt(autoTags, autoSummary, language)) return true;
    }
  }
  for (const [autoTags, autoSummary] of FLAGS) {
    if (candidate === legacyPrompt(autoTags, autoSummary)) return true;
  }
  return false;
}
