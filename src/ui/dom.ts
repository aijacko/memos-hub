/** Small DOM helpers shared by the settings sections. */

import { Setting, setIcon } from 'obsidian';

export function sectionCard(container: HTMLElement, title: string, desc: string): HTMLElement {
  const card = container.createDiv({ cls: 'memos-hub-section-card' });
  const header = card.createDiv({ cls: 'memos-hub-section-header' });
  header.createEl('h3', { text: title });
  if (desc) card.createDiv({ cls: 'memos-hub-section-desc', text: desc });
  return card.createDiv({ cls: 'memos-hub-section-body' });
}

export function hint(container: HTMLElement, text: string, extraClass = ''): HTMLElement {
  const el = container.createDiv({ cls: `memos-hub-hint ${extraClass}`.trim() });
  el.setText(text);
  return el;
}

export function hintWithBold(container: HTMLElement, before: string, bold: string, after?: string): HTMLElement {
  const el = container.createDiv({ cls: 'memos-hub-hint' });
  el.appendText(before);
  el.createEl('strong', { text: bold });
  if (after) el.appendText(after);
  return el;
}

export interface TextFieldOptions {
  name: string;
  desc?: string;
  value: string;
  placeholder?: string;
  cls?: string;
  onChange: (value: string) => void;
}

export function textField(container: HTMLElement, options: TextFieldOptions): Setting {
  const setting = new Setting(container).setName(options.name);
  if (options.desc) setting.setDesc(options.desc);
  if (options.cls) setting.setClass(options.cls);
  setting.addText(text => {
    text.setValue(options.value);
    if (options.placeholder) text.setPlaceholder(options.placeholder);
    if (options.cls) text.inputEl.addClass(options.cls);
    text.onChange(options.onChange);
  });
  return setting;
}

export interface NumberFieldOptions {
  name: string;
  desc?: string;
  value: number;
  placeholder?: string;
  min?: number;
  max?: number;
  cls?: string;
  onChange: (value: number) => void;
}

export function numberField(container: HTMLElement, options: NumberFieldOptions): Setting {
  const setting = new Setting(container).setName(options.name);
  if (options.desc) setting.setDesc(options.desc);
  if (options.cls) setting.setClass(options.cls);
  setting.addText(text => {
    text.inputEl.type = 'number';
    if (options.min !== undefined) text.inputEl.min = String(options.min);
    if (options.max !== undefined) text.inputEl.max = String(options.max);
    if (options.placeholder) text.setPlaceholder(options.placeholder);
    text.setValue(String(options.value));
    text.onChange(value => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      options.onChange(Math.max(options.min ?? 0, Math.min(options.max ?? Number.MAX_SAFE_INTEGER, Math.floor(parsed))));
    });
  });
  return setting;
}

export interface ToggleFieldOptions {
  name: string;
  desc?: string;
  value: boolean;
  disabled?: boolean;
  cls?: string;
  onChange: (value: boolean) => void;
}

export function toggleField(container: HTMLElement, options: ToggleFieldOptions): Setting {
  const setting = new Setting(container).setName(options.name);
  if (options.desc) setting.setDesc(options.desc);
  if (options.cls) setting.setClass(options.cls);
  setting.addToggle(toggle => {
    toggle.setValue(options.value);
    if (options.disabled) toggle.setDisabled(true);
    toggle.onChange(options.onChange);
  });
  return setting;
}

export interface DropdownOption {
  value: string;
  label: string;
}

export interface DropdownFieldOptions {
  name: string;
  desc?: string;
  value: string;
  options: DropdownOption[];
  cls?: string;
  onChange: (value: string) => void;
}

export function dropdownField(container: HTMLElement, options: DropdownFieldOptions): Setting {
  const setting = new Setting(container).setName(options.name);
  if (options.desc) setting.setDesc(options.desc);
  if (options.cls) setting.setClass(options.cls);
  setting.addDropdown(dropdown => {
    for (const option of options.options) dropdown.addOption(option.value, option.label);
    dropdown.setValue(options.value);
    dropdown.onChange(options.onChange);
  });
  return setting;
}

export interface PasswordFieldOptions {
  name: string;
  desc?: string;
  value: string;
  placeholder?: string;
  cls?: string;
  tooltip: string;
  onChange: (value: string) => void;
}

export function passwordField(container: HTMLElement, options: PasswordFieldOptions): Setting {
  const setting = new Setting(container).setName(options.name);
  if (options.desc) setting.setDesc(options.desc);
  if (options.cls) setting.setClass(options.cls);
  let inputEl: HTMLInputElement | null = null;
  setting.addExtraButton(button => {
    let visible = false;
    button.setIcon('eye');
    button.setTooltip(options.tooltip);
    button.onClick(() => {
      visible = !visible;
      if (inputEl) inputEl.type = visible ? 'text' : 'password';
      button.setIcon(visible ? 'eye-off' : 'eye');
    });
  });
  setting.addText(text => {
    inputEl = text.inputEl;
    text.inputEl.type = 'password';
    text.setValue(options.value);
    if (options.placeholder) text.setPlaceholder(options.placeholder);
    if (options.cls) text.inputEl.addClass(options.cls);
    text.onChange(options.onChange);
  });
  return setting;
}

export interface ButtonSpec {
  text: string;
  cta?: boolean;
  warning?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function buttonField(
  container: HTMLElement,
  name: string,
  desc: string,
  buttons: ButtonSpec[],
): Setting {
  const setting = new Setting(container).setName(name);
  if (desc) setting.setDesc(desc);
  for (const spec of buttons) {
    setting.addButton(button => {
      button.setButtonText(spec.text);
      if (spec.cta) button.setCta();
      if (spec.warning) button.setWarning();
      if (spec.disabled) button.setDisabled(true);
      button.onClick(spec.onClick);
    });
  }
  return setting;
}

/** Icon button used by the token / key visibility toggles. */
export function iconButton(parent: HTMLElement, icon: string, tooltip: string, onClick: () => void): HTMLButtonElement {
  const button = parent.createEl('button', { cls: 'clickable-icon' });
  setIcon(button, icon);
  button.setAttr('aria-label', tooltip);
  button.addEventListener('click', onClick);
  return button;
}
