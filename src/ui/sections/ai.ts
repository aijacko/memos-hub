/** AI settings tab. */

import { Notice, Setting } from 'obsidian';
import type { AIProvider } from '../../types';
import { buildDefaultPrompt, isDefaultPrompt } from '../../domain/prompt';
import { getLanguage, t } from '../../i18n/t';
import type { SettingsContext } from '../context';
import { dropdownField, passwordField, sectionCard, textField, toggleField } from '../dom';

const PROVIDER_DEFAULT_URL: Record<AIProvider, string> = {
  lmstudio: 'http://localhost:1234',
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com',
  custom: '',
};

let fetchedModels: string[] = [];

function apiKeyDescription(provider: AIProvider): string {
  if (provider === 'deepseek') return t('AI_DEEPSEEK_KEY_DESC');
  if (provider === 'openai') return t('AI_OPENAI_KEY_DESC');
  if (provider === 'custom') return t('AI_CUSTOM_KEY_DESC');
  return t('AI_PROVIDER_LMSTUDIO');
}

export function renderAISection(ctx: SettingsContext): void {
  const { host } = ctx;
  const settings = host.settings;
  const ai = settings.ai;
  const body = sectionCard(ctx.container, t('AI_TITLE'), t('AI_DESC'));

  toggleField(body, {
    name: t('AI_ENABLED_NAME'),
    desc: t('AI_ENABLED_DESC'),
    value: ai.enabled,
    onChange: value => {
      ai.enabled = value;
      void host.saveSettings().then(() => ctx.rerender());
    },
  });

  if (!ai.enabled) return;

  dropdownField(body, {
    name: t('AI_PROVIDER_NAME'),
    desc: t('AI_PROVIDER_DESC'),
    value: ai.provider,
    cls: 'memos-hub-ai-provider',
    options: [
      { value: 'lmstudio', label: t('AI_PROVIDER_LMSTUDIO') },
      { value: 'deepseek', label: t('AI_PROVIDER_DEEPSEEK') },
      { value: 'openai', label: t('AI_PROVIDER_OPENAI') },
      { value: 'custom', label: t('AI_PROVIDER_CUSTOM') },
    ],
    onChange: value => {
      const provider = value as AIProvider;
      const previousDefault = PROVIDER_DEFAULT_URL[ai.provider];
      ai.provider = provider;
      if (!ai.apiBaseUrl.trim() || ai.apiBaseUrl.trim() === previousDefault) {
        ai.apiBaseUrl = PROVIDER_DEFAULT_URL[provider];
      }
      void host.saveSettings().then(() => ctx.rerender());
    },
  });

  if (ai.provider === 'lmstudio') {
    textField(body, {
      name: t('AI_SERVER_URL_NAME'),
      desc: t('AI_SERVER_URL_DESC'),
      value: ai.apiBaseUrl || 'http://localhost:1234',
      cls: 'memos-hub-ai-wide-input',
      onChange: value => {
        ai.apiBaseUrl = value.trim();
        void host.saveSettings();
      },
    });
  }

  if (ai.provider === 'custom') {
    textField(body, {
      name: t('AI_CUSTOM_URL_NAME'),
      desc: t('AI_CUSTOM_URL_DESC'),
      value: ai.apiBaseUrl,
      cls: 'memos-hub-ai-wide-input',
      onChange: value => {
        ai.apiBaseUrl = value.trim();
        void host.saveSettings();
      },
    });
  }

  passwordField(body, {
    name: t('AI_API_KEY_NAME'),
    desc: apiKeyDescription(ai.provider),
    value: ai.apiKey,
    cls: 'memos-hub-ai-key',
    tooltip: t('TOGGLE_KEY_VISIBILITY'),
    onChange: value => {
      ai.apiKey = value;
      void host.saveSettings();
    },
  });

  const modelSetting = new Setting(body)
    .setName(t('AI_MODEL_NAME'))
    .setDesc(t('AI_MODEL_DESC'))
    .setClass('memos-hub-ai-model');

  modelSetting.addButton(button => button
    .setButtonText(t('BTN_FETCH_MODELS'))
    .setClass('memos-hub-inline-btn')
    .onClick(() => {
      button.setDisabled(true);
      button.setButtonText(t('BTN_FETCHING'));
      void host.fetchModels().then(result => {
        button.setDisabled(false);
        button.setButtonText(t('BTN_FETCH_MODELS'));
        if (result.success) {
          fetchedModels = result.models;
          new Notice(t('FETCH_MODELS_SUCCESS', { n: result.models.length }));
          ctx.rerender();
        } else {
          new Notice(t('FETCH_MODELS_FAILED', { message: result.message ?? '' }));
        }
      });
    }));

  modelSetting.addText(text => {
    const listId = 'memos-hub-ai-model-options';
    text.setValue(ai.modelName);
    text.inputEl.addClass('memos-hub-ai-model-input');
    text.inputEl.setAttr('list', listId);
    text.onChange(value => {
      ai.modelName = value.trim();
      void host.saveSettings();
    });
    const datalist = modelSetting.controlEl.createEl('datalist', { attr: { id: listId } });
    for (const model of fetchedModels) datalist.createEl('option', { attr: { value: model } });
  });

  const testSetting = new Setting(body)
    .setName(t('BTN_TEST_AI'))
    .setDesc(t('AI_TEST_DESC'))
    .addButton(button => button
      .setButtonText(t('BTN_TEST_AI'))
      .onClick(() => {
        button.setDisabled(true);
        button.setButtonText(t('BTN_TESTING'));
        void host.testAI().then(result => {
          button.setDisabled(false);
          button.setButtonText(t('BTN_TEST_AI'));
          new Notice(result.success ? t('AI_TEST_SUCCESS') : t('AI_TEST_FAILED', { message: result.message }));
        });
      }));
  testSetting.settingEl.addClass('memos-hub-ai-test');

  let refreshPromptText = (): void => {};

  toggleField(body, {
    name: t('AI_AUTO_TAGS_NAME'),
    desc: t('AI_AUTO_TAGS_DESC'),
    value: ai.autoTags,
    onChange: value => {
      ai.autoTags = value;
      refreshPromptText();
      void host.saveSettings();
    },
  });

  toggleField(body, {
    name: t('AI_AUTO_SUMMARY_NAME'),
    desc: t('AI_AUTO_SUMMARY_DESC'),
    value: ai.autoSummary,
    onChange: value => {
      ai.autoSummary = value;
      refreshPromptText();
      void host.saveSettings();
    },
  });

  const wrapper = body.createDiv({ cls: 'setting-item memos-hub-ai-prompt-item' });
  const info = wrapper.createDiv({ cls: 'setting-item-info' });
  const header = info.createDiv({ cls: 'memos-hub-prompt-header' });
  const nameBlock = header.createDiv();
  nameBlock.createDiv({ cls: 'setting-item-name', text: t('AI_PROMPT_NAME') });
  nameBlock.createDiv({ cls: 'setting-item-description', text: t('AI_PROMPT_DESC') });
  const defaultPromptText = (): string => buildDefaultPrompt(ai.autoTags, ai.autoSummary, getLanguage());

  const reset = header.createEl('button', { cls: 'memos-hub-prompt-reset-btn', text: t('BTN_RESET_PROMPT') });
  reset.addEventListener('click', () => {
    ai.promptTemplate = '';
    textarea.value = defaultPromptText();
    void host.saveSettings();
    new Notice(t('PROMPT_RESET'));
  });

  const control = wrapper.createDiv({ cls: 'setting-item-control memos-hub-prompt-control' });
  const textarea = control.createEl('textarea', { cls: 'memos-hub-prompt-textarea' });
  textarea.value = isDefaultPrompt(ai.promptTemplate) ? defaultPromptText() : ai.promptTemplate;
  refreshPromptText = () => {
    if (isDefaultPrompt(ai.promptTemplate)) textarea.value = defaultPromptText();
  };
  textarea.addEventListener('change', () => {
    const value = textarea.value.trim();
    ai.promptTemplate = isDefaultPrompt(value) ? '' : value;
    void host.saveSettings();
  });
}
