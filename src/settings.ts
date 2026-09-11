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
  noteTemplatePath: string;
}

export const DEFAULT_SETTINGS: MoveAttachmentsWithNoteSettings = {
  noteTemplatePath: ""
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
      .setName("Linked note model")
      .setDesc("Choose any Markdown note in the vault to use as the model for notes created from selected files. Leave blank to create a note containing only the file embeds.")
      .addText((text) => {
        text
          .setPlaceholder("Path/to/model.md")
          .setValue(this.owner.settings.noteTemplatePath)
          .onChange(async (value) => {
            this.owner.settings.noteTemplatePath = value.trim().length === 0
              ? ""
              : normalizePath(value.trim());
            await this.owner.saveSettings();
          });

        new MarkdownFileSuggest(this.app, text, (file) => {
          text.setValue(file.path);
          this.owner.settings.noteTemplatePath = file.path;
          void this.owner.saveSettings();
        });
      });
  }
}
