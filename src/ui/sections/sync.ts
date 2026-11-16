/** Sync tab: actions, sync settings and maintenance. */

import { Notice } from 'obsidian';
import { formatDate } from '../../domain/time';
import { t } from '../../i18n/t';
import type { SettingsContext } from '../context';
import { ConfirmModal } from '../modals';
import {
  buttonField,
  dropdownField,
  hint,
  hintWithBold,
  numberField,
  sectionCard,
  textField,
  toggleField,
} from '../dom';

function lastSuccessTime(ctx: SettingsContext): number {
  const map = ctx.host.settings.lastSyncByProfile[ctx.host.settings.storageMode] ?? {};
  const values = Object.values(map).map(value => Number(value)).filter(value => Number.isFinite(value) && value > 0);
  return values.length > 0 ? Math.max(...values) : 0;
}

function renderActions(ctx: SettingsContext): void {
  const { host } = ctx;
  const body = sectionCard(ctx.container, t('SYNC_ACTION_NAME'), '');
  body.parentElement?.addClass('memos-hub-action-card');

  const last = lastSuccessTime(ctx);
  const description = last > 0
    ? t('SYNC_LAST_SUCCESS', { time: formatDate(last, 'YYYY-MM-DD HH:mm') })
    : t('SYNC_NEVER');

  const header = body.createDiv({ cls: 'setting-item' });
  const info = header.createDiv({ cls: 'setting-item-info' });
  info.createDiv({ cls: 'setting-item-name', text: t('SYNC_ACTION_NAME') });
  info.createDiv({ cls: 'setting-item-description', text: description });
  const control = header.createDiv({ cls: 'setting-item-control' });

  if (host.isSyncing()) {
    const cancel = control.createEl('button', {
      text: host.isCancelling() ? t('BTN_CANCELING') : t('BTN_CANCEL_SYNC'),
      cls: 'mod-warning',
    });
    if (host.isCancelling()) cancel.disabled = true;
    cancel.addEventListener('click', () => {
      cancel.disabled = true;
      cancel.setText(t('BTN_CANCELING'));
      host.cancelSync();
    });
  } else {
    const smart = control.createEl('button', { text: t('BTN_SMART_SYNC'), cls: 'mod-cta' });
    smart.addEventListener('click', () => host.startSync('smart'));
    const incremental = control.createEl('button', { text: t('BTN_INCREMENTAL_SYNC') });
    incremental.addEventListener('click', () => host.startSync('incremental'));
    const force = control.createEl('button', { text: t('BTN_FORCE_SYNC'), cls: 'mod-warning' });
    force.addEventListener('click', () => host.startSync('force'));
  }

  const failures = host.settings.lastSyncFailures ?? [];
  if (failures.length > 0) {
    const block = ctx.container.createDiv({ cls: 'memos-hub-hint memos-hub-sync-failure' });
    const when = host.settings.lastSyncFailedAt > 0
      ? formatDate(Math.floor(host.settings.lastSyncFailedAt / 1000), 'YYYY-MM-DD HH:mm')
      : '';
    block.createEl('strong', {
      text: when
        ? t('SYNC_FAILED_SUMMARY', { n: failures.length, time: when })
        : t('SYNC_FAILED_SUMMARY_NO_TIME', { n: failures.length }),
    });
    for (const failure of failures) {
      block.createDiv({
        text: t('SYNC_FAILED_LINE', {
          name: failure.name || failure.profileId,
          message: failure.message,
        }),
      });
    }
  }
}

function renderSyncSettings(ctx: SettingsContext): void {
  const { host } = ctx;
  const settings = host.settings;
  const body = sectionCard(ctx.container, t('SYNC_SETTINGS_TITLE'), t('SYNC_SETTINGS_DESC'));

  dropdownField(body, {
    name: t('STORAGE_MODE_NAME'),
    desc: t('STORAGE_MODE_DESC'),
    value: settings.storageMode,
    options: [
      { value: 'file', label: t('STORAGE_MODE_FILE') },
      { value: 'dailyNote', label: t('STORAGE_MODE_DAILY') },
    ],
    onChange: value => {
      settings.storageMode = value as typeof settings.storageMode;
      void host.saveSettings().then(() => ctx.rerender());
    },
  });

  if (settings.storageMode === 'file') {
    textField(body, {
      name: t('SYNC_DIR_NAME'),
      desc: t('SYNC_DIR_DESC'),
      value: settings.syncTargetDir,
      placeholder: 'Memos',
      onChange: value => {
        settings.syncTargetDir = value.trim() || 'Memos';
        void host.saveSettings();
      },
    });

    dropdownField(body, {
      name: t('FOLDER_DEPTH_NAME'),
      desc: t('FOLDER_DEPTH_DESC'),
      value: settings.folderDepth,
      cls: 'memos-hub-short-control',
      options: [
        { value: 'flat', label: t('FOLDER_DEPTH_FLAT') },
        { value: 'year', label: t('FOLDER_DEPTH_YEAR') },
        { value: 'yearMonth', label: t('FOLDER_DEPTH_YEAR_MONTH') },
      ],
      onChange: value => {
        settings.folderDepth = value as typeof settings.folderDepth;
        void host.saveSettings();
      },
    });

    textField(body, {
      name: t('FILE_NAME_FORMAT_NAME'),
      desc: t('FILE_NAME_FORMAT_DESC'),
      value: settings.fileNameFormat,
      onChange: value => {
        settings.fileNameFormat = value.trim() || 'YYYY-MM-DD HH-mm-ss';
        void host.saveSettings();
      },
    });

    toggleField(body, {
      name: t('USE_FRONTMATTER_NAME'),
      desc: t('USE_FRONTMATTER_DESC'),
      value: settings.useFrontmatter,
      onChange: value => {
        settings.useFrontmatter = value;
        void host.saveSettings();
      },
    });

    toggleField(body, {
      name: t('HANDLE_DELETED_NAME'),
      desc: t('HANDLE_DELETED_DESC'),
      value: settings.handleDeletedMemos,
      onChange: value => {
        settings.handleDeletedMemos = value;
        void host.saveSettings();
      },
    });
  } else {
    textField(body, {
      name: t('DAILY_HEADER_NAME'),
      desc: t('DAILY_HEADER_DESC'),
      value: settings.dailyMemoHeader,
      placeholder: '## 📓 Memos',
      onChange: value => {
        const header = value.trim() || '## 📓 Memos';
        settings.dailyMemoHeader = header;
        for (const profile of settings.profiles) profile.dailyMemoHeader = header;
        void host.saveSettings();
      },
    });

    hint(body, t('DAILY_HEADER_HINT'));

    toggleField(body, {
      name: t('CREATE_MISSING_NOTES_NAME'),
      desc: t('CREATE_MISSING_NOTES_DESC'),
      value: settings.createMissingDailyNotes,
      onChange: value => {
        settings.createMissingDailyNotes = value;
        void host.saveSettings();
      },
    });

    toggleField(body, {
      name: t('USE_CALLOUT_FORMAT_NAME'),
      desc: t('USE_CALLOUT_FORMAT_DESC'),
      value: settings.useCalloutFormat,
      onChange: value => {
        settings.useCalloutFormat = value;
        if (value) settings.useListCalloutFormat = false;
        void host.saveSettings().then(() => ctx.rerender());
      },
    });

    toggleField(body, {
      name: t('USE_LIST_CALLOUT_FORMAT_NAME'),
      desc: t('USE_LIST_CALLOUT_FORMAT_DESC'),
      value: settings.useListCalloutFormat,
      disabled: settings.useCalloutFormat,
      onChange: value => {
        settings.useListCalloutFormat = value;
        if (value) settings.useCalloutFormat = false;
        void host.saveSettings().then(() => ctx.rerender());
      },
    });

    if (settings.useListCalloutFormat) {
      hintWithBold(body, t('LIST_CALLOUT_HINT_PRE'), t('LIST_CALLOUT_HINT_BOLD'), t('LIST_CALLOUT_HINT_POST'));
    }
  }
}

function renderMaintenance(ctx: SettingsContext): void {
  const { host } = ctx;
  const body = sectionCard(ctx.container, t('MAINTENANCE_TITLE'), t('MAINTENANCE_DESC'));
  const dirs = host.conflictDirs();

  const backupSetting = buttonField(
    body,
    t('CONFLICT_BACKUP_NAME'),
    dirs.length > 0 ? t('CONFLICT_FOUND_DESC', { dirs: dirs.join('、') }) : t('CONFLICT_NONE_DESC'),
    [{
      text: t('BTN_OPEN_FOLDER'),
      disabled: dirs.length === 0,
      onClick: () => {
        void host.openFolder(dirs[0]);
      },
    }],
  );
  backupSetting.setClass('memos-hub-conflict-setting');

  let days = 30;
  const cleanSetting = numberField(body, {
    name: t('CLEAN_BACKUPS_NAME'),
    desc: t('CLEAN_BACKUPS_DESC'),
    value: days,
    min: 0,
    max: 36500,
    cls: 'memos-hub-short-control',
    onChange: value => {
      days = value;
    },
  });

  cleanSetting.addButton(button => button
    .setButtonText(t('BTN_CLEAN_BACKUPS'))
    .setDisabled(dirs.length === 0)
    .onClick(() => {
      const run = (): void => {
        void host.cleanBackups(days).then(count => {
          if (days === 0) {
            new Notice(count > 0 ? t('CLEANED_ALL', { n: count }) : t('CLEANED_ALL_NONE'));
          } else {
            new Notice(count > 0
              ? t('CLEANED_BACKUPS', { n: count, days })
              : t('CLEANED_NONE', { days }));
          }
          ctx.rerender();
        });
      };
      // 0 means "delete every backup": make that destructive choice explicit.
      if (days === 0) new ConfirmModal(host.app, t('CONFIRM_CLEAN_ALL'), run).open();
      else run();
    }));

  const ignoredCount = Object.values(host.settings.ignoredMemoIds)
    .reduce((total, ids) => total + (Array.isArray(ids) ? ids.length : 0), 0);

  buttonField(
    body,
    t('IGNORE_PROTECTION_NAME'),
    ignoredCount > 0 ? t('IGNORE_COUNT_DESC', { n: ignoredCount }) : t('IGNORE_NONE_DESC'),
    [{
      text: t('BTN_CLEAR_IGNORED'),
      warning: true,
      disabled: ignoredCount === 0,
      onClick: () => {
        void host.clearIgnored();
      },
    }],
  );
}

export function renderSyncSection(ctx: SettingsContext): void {
  renderActions(ctx);
  renderSyncSettings(ctx);
  renderMaintenance(ctx);
}
