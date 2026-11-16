/** Modals: confirm, account picker and quick capture. */

import { App, Modal, Setting, TextAreaComponent } from 'obsidian';
import type { MemosProfile, Visibility } from '../types';
import { t } from '../i18n/t';

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
    private readonly onConfirm: () => void,
    private readonly confirmText: string = t('CONFIRM_OK'),
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl('p', { text: this.message });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText(t('CONFIRM_CANCEL')).onClick(() => this.close()))
      .addButton(button => button
        .setButtonText(this.confirmText)
        .setWarning()
        .onClick(() => {
          this.close();
          this.onConfirm();
        }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class AccountPickModal extends Modal {
  private picked = false;

  constructor(
    app: App,
    private readonly profiles: MemosProfile[],
    private readonly onPick: (profile: MemosProfile | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl('h3', { text: t('MODAL_PICK_ACCOUNT') });
    for (const profile of this.profiles) {
      new Setting(this.contentEl)
        .setName(profile.name.trim() || profile.id)
        .setDesc(profile.apiUrl)
        .addButton(button => button
          .setButtonText(t('BTN_SEND'))
          .setCta()
          .onClick(() => {
            this.picked = true;
            this.close();
            this.onPick(profile);
          }));
    }
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.picked) this.onPick(null);
  }
}

export class QuickCaptureModal extends Modal {
  private textarea: TextAreaComponent | null = null;
  private visibility: Visibility = 'PRIVATE';
  private profileId = '';
  private submitting = false;

  constructor(
    app: App,
    private readonly profiles: MemosProfile[],
    private readonly onSubmit: (content: string, visibility: Visibility, profile: MemosProfile) => Promise<boolean>,
  ) {
    super(app);
    this.profileId = profiles[0]?.id ?? '';
  }

  onOpen(): void {
    this.contentEl.createEl('h3', { text: t('MODAL_QUICK_CAPTURE') });
    this.textarea = new TextAreaComponent(this.contentEl);
    this.textarea.inputEl.addClass('memos-hub-quick-capture-input');
    this.textarea.inputEl.rows = 6;
    this.textarea.setPlaceholder(t('QUICK_CAPTURE_PLACEHOLDER'));
    this.textarea.inputEl.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void this.submit();
      }
    });

    new Setting(this.contentEl)
      .addDropdown(dropdown => {
        dropdown.addOption('PRIVATE', t('VISIBILITY_PRIVATE'));
        dropdown.addOption('PROTECTED', t('VISIBILITY_PROTECTED'));
        dropdown.addOption('PUBLIC', t('VISIBILITY_PUBLIC'));
        dropdown.setValue(this.visibility);
        dropdown.onChange(value => {
          this.visibility = value as Visibility;
        });
      });

    if (this.profiles.length > 1) {
      new Setting(this.contentEl)
        .addDropdown(dropdown => {
          for (const profile of this.profiles) {
            dropdown.addOption(profile.id, profile.name.trim() || profile.id);
          }
          dropdown.setValue(this.profileId);
          dropdown.onChange(value => {
            this.profileId = value;
          });
        });
    }

    new Setting(this.contentEl)
      .addButton(button => button.setButtonText(t('CONFIRM_CANCEL')).onClick(() => this.close()))
      .addButton(button => button
        .setButtonText(t('BTN_SEND'))
        .setCta()
        .onClick(() => void this.submit()));

    window.setTimeout(() => this.textarea?.inputEl.focus(), 50);
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    const content = this.textarea?.getValue().trim() ?? '';
    const profile = this.profiles.find(item => item.id === this.profileId) ?? this.profiles[0];
    if (!content || !profile) {
      this.close();
      return;
    }
    this.submitting = true;
    const sent = await this.onSubmit(content, this.visibility, profile);
    this.submitting = false;
    // Keep the draft when sending failed so the text is not lost.
    if (sent) this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
