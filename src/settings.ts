import {
  AbstractInputSuggest,
  App,
  PluginSettingTab,
  Setting,
  TFile,
  TextComponent,
  normalizePath
} from "obsidian";

import type MoveAttachmentsWithNotePlugin from "./main";

export interface MoveAttachmentsWithNoteSettings {
  companionTemplatePath: string;
}

export const DEFAULT_SETTINGS: MoveAttachmentsWithNoteSettings = {
  companionTemplatePath: ""
};

class MarkdownFileSuggest extends AbstractInputSuggest<TFile> {
  constructor(app: App, input: TextComponent, onChoose: (file: TFile) => void) {
    super(app, input.inputEl);
    this.onSelect(onChoose);
  }

  protected getSuggestions(query: string): TFile[] {
    const normalizedQuery = query.trim().toLowerCase();
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => normalizedQuery.length === 0 || file.path.toLowerCase().includes(normalizedQuery))
      .slice(0, 100);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }
}

export class MoveAttachmentsWithNoteSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly owner: MoveAttachmentsWithNotePlugin) {
    super(app, owner);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Companion note model")
      .setDesc("Choose any Markdown note in the vault to use as the model for new companion notes. Leave blank to use the built-in minimal content.")
      .addText((text) => {
        text
          .setPlaceholder("Path/to/model.md")
          .setValue(this.owner.settings.companionTemplatePath)
          .onChange(async (value) => {
            this.owner.settings.companionTemplatePath = value.trim().length === 0
              ? ""
              : normalizePath(value.trim());
            await this.owner.saveSettings();
          });

        new MarkdownFileSuggest(this.app, text, (file) => {
          text.setValue(file.path);
          this.owner.settings.companionTemplatePath = file.path;
          void this.owner.saveSettings();
        });
      });
  }
}
