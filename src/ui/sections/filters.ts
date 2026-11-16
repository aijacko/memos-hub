/** Filters and automatic sync tab. */

import { t } from '../../i18n/t';
import type { SettingsContext } from '../context';
import { numberField, sectionCard, textField, toggleField } from '../dom';

export function renderFiltersSection(ctx: SettingsContext): void {
  const { host } = ctx;
  const settings = host.settings;

  const filters = sectionCard(ctx.container, t('FILTERS_TITLE'), t('FILTERS_DESC'));

  textField(filters, {
    name: t('ATTACHMENT_FOLDER_NAME'),
    desc: t('ATTACHMENT_FOLDER_DESC'),
    value: settings.attachmentFolderPath,
    placeholder: 'Assets/MemosFiles',
    onChange: value => {
      settings.attachmentFolderPath = value.trim() || 'Assets/MemosFiles';
      void host.saveSettings();
    },
  });

  toggleField(filters, {
    name: t('SKIP_IMAGES_NAME'),
    desc: t('SKIP_IMAGES_DESC'),
    value: settings.skipImages,
    onChange: value => {
      settings.skipImages = value;
      void host.saveSettings();
    },
  });

  toggleField(filters, {
    name: t('SKIP_ARCHIVED_NAME'),
    desc: t('SKIP_ARCHIVED_DESC'),
    value: settings.skipArchivedMemos,
    onChange: value => {
      settings.skipArchivedMemos = value;
      void host.saveSettings().then(() => ctx.rerender());
    },
  });

  toggleField(filters, {
    name: t('KEEP_ARCHIVED_BLOCKS_NAME'),
    desc: t('KEEP_ARCHIVED_BLOCKS_DESC'),
    value: settings.keepArchivedDailyBlocks,
    disabled: !settings.skipArchivedMemos || settings.storageMode !== 'dailyNote',
    onChange: value => {
      settings.keepArchivedDailyBlocks = value;
      void host.saveSettings();
    },
  });

  textField(filters, {
    name: t('INCLUDE_TAGS_NAME'),
    desc: t('INCLUDE_TAGS_DESC'),
    value: settings.includeTags,
    placeholder: t('INCLUDE_TAGS_PLACEHOLDER'),
    onChange: value => {
      settings.includeTags = value;
      void host.saveSettings();
    },
  });

  textField(filters, {
    name: t('EXCLUDE_TAGS_NAME'),
    desc: t('EXCLUDE_TAGS_DESC'),
    value: settings.excludeTags,
    placeholder: t('EXCLUDE_TAGS_PLACEHOLDER'),
    onChange: value => {
      settings.excludeTags = value;
      void host.saveSettings();
    },
  });

  const auto = sectionCard(ctx.container, t('AUTO_SYNC_TITLE'), t('AUTO_SYNC_DESC'));

  toggleField(auto, {
    name: t('AUTO_SYNC_STARTUP_NAME'),
    desc: t('AUTO_SYNC_STARTUP_DESC'),
    value: settings.enableAutoSyncOnStartup,
    onChange: value => {
      settings.enableAutoSyncOnStartup = value;
      void host.saveSettings();
    },
  });

  numberField(auto, {
    name: t('STARTUP_DELAY_NAME'),
    desc: t('STARTUP_DELAY_DESC'),
    value: settings.startupSyncDelay,
    min: 0,
    max: 3600,
    onChange: value => {
      settings.startupSyncDelay = value;
      void host.saveSettings();
    },
  });

  toggleField(auto, {
    name: t('SKIP_IF_SYNCED_NAME'),
    desc: t('SKIP_IF_SYNCED_DESC'),
    value: settings.skipIfSyncedToday,
    onChange: value => {
      settings.skipIfSyncedToday = value;
      void host.saveSettings();
    },
  });

  numberField(auto, {
    name: t('PERIODIC_SYNC_NAME'),
    desc: t('PERIODIC_SYNC_DESC'),
    value: settings.periodicSyncInterval,
    min: 0,
    max: 1440,
    onChange: value => {
      settings.periodicSyncInterval = value;
      void host.saveSettings();
    },
  });
}
