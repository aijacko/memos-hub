/** Settings tab with the five sections. */

import { Plugin, PluginSettingTab } from 'obsidian';
import type { SettingsUiHost } from './context';
import type { TranslationKey } from '../i18n/types';
import { t } from '../i18n/t';
import { renderAccountsSection } from './sections/accounts';
import { renderSyncSection } from './sections/sync';
import { renderFiltersSection } from './sections/filters';
import { renderAISection } from './sections/ai';
import { renderAboutSection } from './sections/about';

type TabId = 'accounts' | 'sync' | 'filters' | 'ai' | 'about';

const TABS: Array<{ id: TabId; key: TranslationKey }> = [
  { id: 'accounts', key: 'TAB_ACCOUNTS' },
  { id: 'sync', key: 'TAB_SYNC' },
  { id: 'filters', key: 'TAB_FILTERS' },
  { id: 'ai', key: 'TAB_AI' },
  { id: 'about', key: 'TAB_ABOUT' },
];

export class MemosHubSettingTab extends PluginSettingTab {
  private activeTab: TabId = 'sync';

  constructor(private readonly host: SettingsUiHost & Plugin) {
    super(host.app, host);
  }

  display(): void {
    const { containerEl } = this;
    const scroll = containerEl.scrollTop;
    containerEl.empty();
    containerEl.addClass('memos-hub-settings');

    const tabs = containerEl.createDiv({ cls: 'memos-hub-tabs' });
    for (const tab of TABS) {
      const button = tabs.createEl('button', {
        cls: `memos-hub-tab${this.activeTab === tab.id ? ' is-active' : ''}`,
        text: t(tab.key),
      });
      button.addEventListener('click', () => {
        if (this.activeTab === tab.id) return;
        this.activeTab = tab.id;
        this.display();
        containerEl.scrollTop = 0;
      });
    }

    const content = containerEl.createDiv();
    const ctx = {
      host: this.host,
      container: content,
      rerender: () => this.rerender(),
    };

    switch (this.activeTab) {
      case 'accounts':
        renderAccountsSection(ctx);
        break;
      case 'filters':
        renderFiltersSection(ctx);
        break;
      case 'ai':
        renderAISection(ctx);
        break;
      case 'about':
        renderAboutSection(ctx);
        break;
      case 'sync':
      default:
        renderSyncSection(ctx);
        break;
    }

    containerEl.scrollTop = scroll;
  }

  private rerender(): void {
    this.display();
  }
}
