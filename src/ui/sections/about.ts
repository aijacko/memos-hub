/** About tab. */

import { Setting } from 'obsidian';
import { t } from '../../i18n/t';
import { ConfirmModal } from '../modals';
import type { SettingsContext } from '../context';
import { sectionCard } from '../dom';

const REPO_URL = 'https://github.com/aijacko/memos-hub';

function link(parent: HTMLElement, text: string, href: string): void {
  const anchor = parent.createEl('a', { text, href });
  anchor.setAttr('target', '_blank');
  anchor.setAttr('rel', 'noopener');
}

function row(parent: HTMLElement, name: string, desc: string): void {
  new Setting(parent).setName(name).setDesc(desc);
}

export function renderAboutSection(ctx: SettingsContext): void {
  const { host } = ctx;

  const about = sectionCard(ctx.container, t('ABOUT_TITLE'), t('ABOUT_DESC'));
  about.createDiv({ cls: 'memos-hub-about-text', text: t('ABOUT_INTRO') });

  const links = about.createDiv({ cls: 'memos-hub-about-links' });
  link(links, t('LINK_REPO'), REPO_URL);
  link(links, t('LINK_CHANGELOG'), `${REPO_URL}/blob/main/CHANGELOG.md`);
  link(links, t('LINK_ISSUES'), `${REPO_URL}/issues`);
  const author = host.authorUrl ? links.createEl('a', { text: t('LINK_AUTHOR', { name: host.author }), href: host.authorUrl }) : links.createSpan({ text: t('LINK_AUTHOR', { name: host.author }) });
  author.setAttr('target', '_blank');
  about.createDiv({ cls: 'memos-hub-about-text', text: t('ABOUT_VERSION', { version: host.version }) });

  const sync = sectionCard(ctx.container, t('ABOUT_SYNC_TITLE'), t('ABOUT_SYNC_DESC'));
  row(sync, t('ABOUT_SYNC_SMART_NAME'), t('ABOUT_SYNC_SMART_DESC'));
  row(sync, t('ABOUT_SYNC_INCREMENTAL_NAME'), t('ABOUT_SYNC_INCREMENTAL_DESC'));
  row(sync, t('ABOUT_SYNC_FORCE_NAME'), t('ABOUT_SYNC_FORCE_DESC'));

  const send = sectionCard(ctx.container, t('ABOUT_SEND_TITLE'), t('ABOUT_SEND_DESC'));
  row(send, t('ABOUT_CAPTURE_NAME'), t('ABOUT_CAPTURE_DESC'));
  row(send, t('ABOUT_SEND_SELECTION_NAME'), t('ABOUT_SEND_SELECTION_DESC'));
  row(send, t('ABOUT_SEND_NOTE_NAME'), t('ABOUT_SEND_NOTE_DESC'));
  send.createDiv({ cls: 'memos-hub-hint', text: t('ABOUT_SHORTCUT_HINT') });

  const maintenance = sectionCard(ctx.container, t('ABOUT_MAINTENANCE_TITLE'), t('ABOUT_MAINTENANCE_DESC'));
  new Setting(maintenance)
    .setName(t('RESET_SETTINGS_NAME'))
    .setDesc(t('RESET_SETTINGS_DESC'))
    .addButton(button => button
      .setButtonText(t('BTN_RESET_SETTINGS'))
      .setWarning()
      .onClick(() => {
        new ConfirmModal(host.app, t('CONFIRM_RESET'), () => {
          void host.resetSettings();
        }, t('BTN_RESET_SETTINGS')).open();
      }));
}
