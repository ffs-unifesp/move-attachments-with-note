import { Menu, Notice, Plugin, TAbstractFile, TFile } from "obsidian";

import {
  buildNumberedName,
  buildPath,
  createLinkedNote,
  getDirectory,
  isEligibleFile,
  MAX_SUFFIX_ATTEMPTS
} from "./linked-note";
import {
  DEFAULT_SETTINGS,
  MoveAttachmentsWithNoteSettings,
  MoveAttachmentsWithNoteSettingTab
} from "./settings";

const LOG_PREFIX = "[move-attachments-with-note]";
const LINK_CACHE_DELAY_MS = 150;
const FILE_EXPLORER_MENU_SOURCE = "file-explorer-context-menu";
const NOTEBOOK_NAVIGATOR_PLUGIN_ID = "notebook-navigator";
const NOTEBOOK_NAVIGATOR_RETRY_INTERVAL_MS = 250;
const NOTEBOOK_NAVIGATOR_MAX_RETRIES = 40;

type LinkMap = Record<string, number>;
type ResolvedLinks = Record<string, LinkMap>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface NotebookNavigatorFileMenuContext {
  addItem(callback: (item: { setTitle(title: string): unknown; setIcon(icon: string): unknown; onClick(callback: () => unknown): unknown }) => void): void;
  file: TFile;
  selection: {
    mode: "single" | "multiple";
    files: readonly TFile[];
  };
}

interface NotebookNavigatorApi {
  getVersion(): string;
  menus: {
    registerFileMenu(callback: (context: NotebookNavigatorFileMenuContext) => void): () => void;
  };
}

interface NotebookNavigatorPlugin {
  api?: NotebookNavigatorApi;
}

interface PluginRegistry {
  getPlugin?(id: string): NotebookNavigatorPlugin | null;
  plugins?: Record<string, NotebookNavigatorPlugin>;
}

export default class MoveAttachmentsWithNotePlugin extends Plugin {
  settings: MoveAttachmentsWithNoteSettings = { ...DEFAULT_SETTINGS };
  private notebookNavigatorMenusRegistered = false;
  private notebookNavigatorRegistrationTimer: ReturnType<typeof setTimeout> | null = null;

  async onload(): Promise<void> {
    console.info(`${LOG_PREFIX} loaded`);
    await this.loadSettings();
    this.addSettingTab(new MoveAttachmentsWithNoteSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        void this.handleRename(file, oldPath);
        void this.handleTemplateRename(file, oldPath);
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (source === FILE_EXPLORER_MENU_SOURCE && isEligibleFile(file)) {
          this.addCreateNoteMenuItem(menu, [file]);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        const eligibleFiles = files.filter(isEligibleFile);
        if (eligibleFiles.length > 0) {
          this.addCreateNoteMenuItem(menu, eligibleFiles);
        }
      })
    );

    this.addCommand({
      id: "create-note-for-active-file",
      name: "Create note for active file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const available = isEligibleFile(file);
        if (available && !checking) {
          void this.createNoteFromSelection([file]);
        }
        return available;
      }
    });

    this.app.workspace.onLayoutReady(() => {
      this.startNotebookNavigatorRegistration();
    });
    this.register(() => {
      if (this.notebookNavigatorRegistrationTimer != null) {
        clearTimeout(this.notebookNavigatorRegistrationTimer);
      }
    });
  }

  onunload(): void {
    console.info(`${LOG_PREFIX} unloaded`);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async loadSettings(): Promise<void> {
    const saved = await this.loadData() as Partial<MoveAttachmentsWithNoteSettings> & {
      companionTemplatePath?: string;
      collectionTemplatePath?: string;
    } | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      noteTemplatePath: saved?.noteTemplatePath
        ?? saved?.companionTemplatePath
        ?? saved?.collectionTemplatePath
        ?? ""
    };
  }

  private async handleTemplateRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (!(file instanceof TFile)) {
      return;
    }

    if (oldPath === this.settings.noteTemplatePath) {
      this.settings.noteTemplatePath = file.path;
      await this.saveSettings();
    }
  }

  private async readNoteModelOrNotify(): Promise<string | null | undefined> {
    const path = this.settings.noteTemplatePath;
    if (path.length === 0) {
      return null;
    }

    const model = this.app.vault.getAbstractFileByPath(path);
    if (!(model instanceof TFile) || model.extension.toLowerCase() !== "md") {
      console.error(`${LOG_PREFIX} Linked note model is unavailable: ${path}`);
      new Notice(`Linked note model is unavailable: ${path}`);
      return undefined;
    }

    try {
      return await this.app.vault.cachedRead(model);
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not read linked note model: ${path}`, error);
      new Notice(`Could not read linked note model: ${path}`);
      return undefined;
    }
  }

  private addCreateNoteMenuItem(menu: Menu, files: readonly TFile[]): void {
    const title = files.length === 1
      ? "Create note for file"
      : "Create note for selected files";
    menu.addItem((item) => {
      item
        .setTitle(title)
        .setIcon("file-plus-2")
        .onClick(() => this.createNoteFromSelection(files));
    });
  }

  private async createNoteFromSelection(files: readonly TFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const modelContent = await this.readNoteModelOrNotify();
    if (modelContent === undefined) {
      return;
    }

    const result = await createLinkedNote(this.app, files, modelContent);
    if (result.kind === "error") {
      console.error(`${LOG_PREFIX} Failed to create note for selected files`, result.error);
      new Notice("Could not create a note for the selected files.");
      return;
    }

    if (result.conflictResolved) {
      console.warn(`${LOG_PREFIX} Note name conflict; using ${result.path}`);
    }
    console.info(`${LOG_PREFIX} Linked note created: ${result.path} (${files.length} files)`);
    try {
      await this.app.workspace.getLeaf(false).openFile(result.note);
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to open linked note ${result.path}`, error);
      new Notice(`Note exists but could not be opened: ${result.path}`);
    }
  }

  private startNotebookNavigatorRegistration(): void {
    let attempts = 0;
    const tryRegistration = (): void => {
      this.notebookNavigatorRegistrationTimer = null;
      if (this.registerNotebookNavigatorMenus()) {
        return;
      }

      attempts += 1;
      if (attempts >= NOTEBOOK_NAVIGATOR_MAX_RETRIES) {
        return;
      }

      this.notebookNavigatorRegistrationTimer = setTimeout(
        tryRegistration,
        NOTEBOOK_NAVIGATOR_RETRY_INTERVAL_MS
      );
    };

    tryRegistration();
  }

  private registerNotebookNavigatorMenus(): boolean {
    if (this.notebookNavigatorMenusRegistered) {
      return true;
    }

    const registry = (this.app as unknown as { plugins?: PluginRegistry }).plugins;
    const plugin = registry?.getPlugin?.(NOTEBOOK_NAVIGATOR_PLUGIN_ID)
      ?? registry?.plugins?.[NOTEBOOK_NAVIGATOR_PLUGIN_ID];
    const api = plugin?.api;
    if (api == null || typeof api.getVersion !== "function" || typeof api.menus?.registerFileMenu !== "function") {
      return false;
    }

    const majorVersion = Number.parseInt(api.getVersion().split(".")[0] ?? "", 10);
    if (!Number.isFinite(majorVersion) || majorVersion < 2) {
      console.warn(`${LOG_PREFIX} Notebook Navigator 2.0.0 or newer is required for menu integration`);
      return true;
    }

    const dispose = api.menus.registerFileMenu((context) => {
      if (context.selection.mode === "multiple") {
        const eligibleFiles = context.selection.files.filter(isEligibleFile);
        if (eligibleFiles.length > 0) {
          context.addItem((item) => {
            item.setTitle("Create note for selected files");
            item.setIcon("file-plus-2");
            item.onClick(() => this.createNoteFromSelection(eligibleFiles));
          });
        }
        return;
      }

      if (isEligibleFile(context.file)) {
        context.addItem((item) => {
          item.setTitle("Create note for file");
          item.setIcon("file-plus-2");
          item.onClick(() => this.createNoteFromSelection([context.file]));
        });
      }
    });
    this.notebookNavigatorMenusRegistered = true;
    this.register(dispose);
    console.info(`${LOG_PREFIX} Notebook Navigator linked-note menus registered`);
    return true;
  }

  private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (!(file instanceof TFile)) {
      return;
    }

    if (file.extension.toLowerCase() !== "md") {
      return;
    }

    const oldDir = getDirectory(oldPath);
    const newDir = getDirectory(file.path);

    if (oldDir === newDir) {
      return;
    }

    await sleep(LINK_CACHE_DELAY_MS);

    const linkedPaths = this.getLinkedPaths(file.path, oldPath);
    if (linkedPaths.length === 0) {
      console.info(
        `${LOG_PREFIX} No resolved links found for moved note: ${file.path} (oldPath: ${oldPath})`
      );
      return;
    }

    let movedCount = 0;
    let sharedSkippedCount = 0;
    let folderSkippedCount = 0;
    let brokenSkippedCount = 0;
    let markdownSkippedCount = 0;
    let errorCount = 0;

    for (const linkedPath of linkedPaths) {
      const candidate = this.app.vault.getAbstractFileByPath(linkedPath);

      if (!(candidate instanceof TFile)) {
        brokenSkippedCount += 1;
        console.warn(
          `${LOG_PREFIX} Ignoring unresolved attachment link: ${linkedPath} (note: ${file.path})`
        );
        continue;
      }

      if (candidate.extension.toLowerCase() === "md") {
        markdownSkippedCount += 1;
        continue;
      }

      if (getDirectory(candidate.path) !== oldDir) {
        folderSkippedCount += 1;
        continue;
      }

      if (this.isSharedAttachment(candidate.path, file.path, oldPath)) {
        sharedSkippedCount += 1;
        console.info(
          `${LOG_PREFIX} Ignoring shared attachment: ${candidate.path} (note: ${file.path})`
        );
        continue;
      }

      const target = this.findAvailableTargetPath(newDir, candidate.name);
      if (target == null) {
        errorCount += 1;
        console.error(
          `${LOG_PREFIX} Could not allocate destination name after ${MAX_SUFFIX_ATTEMPTS} attempts for ${candidate.path}`
        );
        continue;
      }

      if (target.suffix > 0) {
        console.warn(
          `${LOG_PREFIX} Destination conflict for ${candidate.path}; using ${target.path}`
        );
      }

      try {
        await this.app.fileManager.renameFile(candidate, target.path);
        movedCount += 1;
      } catch (error) {
        errorCount += 1;
        console.error(
          `${LOG_PREFIX} Failed to move attachment ${candidate.path} -> ${target.path}`,
          error
        );
      }
    }

    console.info(
      `${LOG_PREFIX} Move summary for ${file.path}: moved=${movedCount}, skippedShared=${sharedSkippedCount}, skippedFolder=${folderSkippedCount}, skippedBroken=${brokenSkippedCount}, skippedMarkdown=${markdownSkippedCount}, errors=${errorCount}`
    );
  }

  private getLinkedPaths(newPath: string, oldPath: string): string[] {
    const resolvedLinks = this.app.metadataCache.resolvedLinks as ResolvedLinks;
    const fromNewPath = resolvedLinks[newPath] ?? {};
    const fromOldPath = resolvedLinks[oldPath] ?? {};
    const merged = { ...fromOldPath, ...fromNewPath };
    return Object.keys(merged);
  }

  private isSharedAttachment(attachmentPath: string, newNotePath: string, oldNotePath: string): boolean {
    const resolvedLinks = this.app.metadataCache.resolvedLinks as ResolvedLinks;

    for (const [sourcePath, outgoingLinks] of Object.entries(resolvedLinks)) {
      if (!sourcePath.toLowerCase().endsWith(".md")) {
        continue;
      }

      if (sourcePath === newNotePath || sourcePath === oldNotePath) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(outgoingLinks, attachmentPath)) {
        return true;
      }
    }

    return false;
  }

  private findAvailableTargetPath(
    destinationDirectory: string,
    originalFileName: string
  ): { path: string; suffix: number } | null {
    const firstCandidate = buildPath(destinationDirectory, originalFileName);
    if (this.app.vault.getAbstractFileByPath(firstCandidate) == null) {
      return { path: firstCandidate, suffix: 0 };
    }

    for (let suffix = 1; suffix <= MAX_SUFFIX_ATTEMPTS; suffix += 1) {
      const numberedName = buildNumberedName(originalFileName, suffix);
      const candidatePath = buildPath(destinationDirectory, numberedName);
      if (this.app.vault.getAbstractFileByPath(candidatePath) == null) {
        return { path: candidatePath, suffix };
      }
    }

    return null;
  }
}
