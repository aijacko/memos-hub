/** Accounts tab. */

import type { MemosProfile } from '../../types';
import { formatDate } from '../../domain/time';
import { t } from '../../i18n/t';
import { isOnlyAccount, isProfileConfigured } from '../../state/settings';
import { ConfirmModal } from '../modals';
import type { SettingsContext } from '../context';
import {
  dropdownField,
  numberField,
  passwordField,
  sectionCard,
  textField,
  toggleField,
} from '../dom';

function lastSyncLabel(host: SettingsContext['host'], profile: MemosProfile): string {
  const raw = host.settings.lastSyncByProfile[host.settings.storageMode]?.[profile.id];
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value) || value <= 0) return t('PROFILE_NEVER_SYNCED');
  return t('PROFILE_LAST_SYNC', { time: formatDate(value, 'YYYY-MM-DD HH:mm') });
}

function badge(parent: HTMLElement, text: string, cls: string): void {
  parent.createSpan({ cls: `memos-hub-badge ${cls}`, text });
}

function renderProfile(ctx: SettingsContext, profile: MemosProfile): void {
  const { host } = ctx;
  const card = ctx.container.createDiv({ cls: 'memos-hub-profile-card' });

  const header = card.createDiv({ cls: 'memos-hub-profile-header' });
  const title = header.createEl('h4', { text: profile.name.trim() || t('UNNAMED_PROFILE') });
  badge(header, profile.enabled ? t('BADGE_ENABLED') : t('BADGE_DISABLED'), profile.enabled ? 'is-on' : 'is-off');
  if (host.settings.defaultProfileId === profile.id) badge(header, t('BADGE_DEFAULT'), 'is-default');

  card.createDiv({ cls: 'memos-hub-profile-meta', text: lastSyncLabel(host, profile) });

  const nameSetting = textField(card, {
    name: t('PROFILE_NAME_LABEL'),
    desc: t('PROFILE_NAME_DESC'),
    value: profile.name,
    cls: 'memos-hub-account-name',
    onChange: value => {
      profile.name = value;
      title.setText(value.trim() || t('UNNAMED_PROFILE'));
      void host.saveSettings();
    },
  });
  nameSetting.settingEl.addClass('memos-hub-account-name-row');

  toggleField(card, {
    name: t('PROFILE_ENABLED_LABEL'),
    desc: t('PROFILE_ENABLED_DESC'),
    value: profile.enabled,
    onChange: value => {
      profile.enabled = value;
      void host.saveSettings().then(() => ctx.rerender());
    },
  });

  toggleField(card, {
    name: t('PROFILE_DEFAULT_NAME'),
    desc: t('PROFILE_DEFAULT_DESC'),
    value: host.settings.defaultProfileId === profile.id,
    disabled: !profile.enabled || isOnlyAccount(host.settings, profile.id),
    onChange: value => {
      host.settings.defaultProfileId = value ? profile.id : '';
      void host.saveSettings().then(() => ctx.rerender());
    },
  });

  textField(card, {
    name: t('API_URL_NAME'),
    desc: t('API_URL_DESC'),
    value: profile.apiUrl,
    placeholder: 'http://localhost:5230',
    cls: 'memos-hub-account-input',
    onChange: value => {
      profile.apiUrl = value.trim();
      void host.saveSettings();
    },
  });

  passwordField(card, {
    name: t('API_TOKEN_NAME'),
    desc: t('API_TOKEN_DESC'),
    value: profile.apiToken,
    placeholder: 'memos_pat_…',
    cls: 'memos-hub-account-input',
    tooltip: t('TOGGLE_TOKEN_VISIBILITY'),
    onChange: value => {
      profile.apiToken = value.trim();
      void host.saveSettings();
    },
  });

  dropdownField(card, {
    name: t('API_MODE_NAME'),
    desc: t('API_MODE_DESC'),
    value: profile.memosApiMode ?? host.settings.memosApiMode,
    cls: 'memos-hub-short-control',
    options: [
      { value: 'auto', label: t('API_MODE_AUTO') },
      { value: 'api', label: t('API_MODE_NEW') },
      { value: 'api-v1', label: t('API_MODE_LEGACY') },
    ],
    onChange: value => {
      profile.memosApiMode = value as MemosProfile['memosApiMode'];
      void host.saveSettings();
    },
  });

  numberField(card, {
    name: t('SYNC_DAYS_LIMIT_NAME'),
    desc: t('SYNC_DAYS_LIMIT_DESC'),
    value: profile.syncDaysLimit,
    min: 0,
    max: 36500,
    cls: 'memos-hub-account-days',
    onChange: value => {
      profile.syncDaysLimit = value;
      void host.saveSettings();
    },
  });

  const actions = card.createDiv({ cls: 'setting-item memos-hub-profile-actions' });
  const control = actions.createDiv({ cls: 'setting-item-control' });
  const status = control.createSpan({ cls: 'memos-hub-profile-meta', text: '' });

  const testButton = control.createEl('button', { text: t('BTN_TEST_CONNECTION') });
  testButton.addEventListener('click', () => {
    if (!isProfileConfigured(profile)) {
      status.setText(t('TEST_MISSING'));
      return;
    }
    testButton.disabled = true;
    testButton.setText(t('BTN_TESTING'));
    status.setText('');
    void host.testProfile(profile).then(result => {
      testButton.disabled = false;
      testButton.setText(t('BTN_TEST_CONNECTION'));
      status.setText(result.message);
      status.toggleClass('mod-warning', !result.success);
    });
  });

  const removeButton = control.createEl('button', { text: t('REMOVE_PROFILE'), cls: 'mod-warning' });
  removeButton.addEventListener('click', () => {
    new ConfirmModal(host.app, t('REMOVE_PROFILE_CONFIRM'), () => {
      void host.removeProfile(profile.id);
    }, t('REMOVE_PROFILE')).open();
  });
}

export function renderAccountsSection(ctx: SettingsContext): void {
  const { host, container } = ctx;
  const body = sectionCard(container, t('PROFILES_TITLE'), t('PROFILES_DESC'));

  if (host.settings.profiles.length === 0) {
    body.createDiv({ cls: 'memos-hub-hint', text: t('NO_PROFILES_HINT') });
  }

  for (const profile of host.settings.profiles) renderProfile(ctx, profile);

  const footer = body.createDiv({ cls: 'setting-item' });
  const control = footer.createDiv({ cls: 'setting-item-control' });
  const addButton = control.createEl('button', { text: t('ADD_PROFILE'), cls: 'mod-cta' });
  addButton.addEventListener('click', () => {
    void host.addProfile();
  });
}
