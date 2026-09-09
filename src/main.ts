import { Menu, Notice, Plugin, TAbstractFile, TFile } from "obsidian";

import {
  buildNumberedName,
  buildPath,
  buildCompanionIndex,
  CompanionIndex,
  createCollectionNote,
  createCompanionIfNeeded,
  getDirectory,
  isEligibleFile,
  MAX_SUFFIX_ATTEMPTS
} from "./companion";
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
          this.addSingleCompanionMenuItem(menu, file);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        if (files.length >= 2 && files.some(isEligibleFile)) {
          this.addBatchCompanionMenuItem(menu, files);
        }
      })
    );

    this.addCommand({
      id: "open-or-create-companion-note-for-active-file",
      name: "Open or create companion note for active file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const available = isEligibleFile(file);
        if (available && !checking) {
          void this.openOrCreateCompanion(file);
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  private async handleTemplateRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (!(file instanceof TFile)) {
      return;
    }

    let changed = false;
    if (oldPath === this.settings.companionTemplatePath) {
      this.settings.companionTemplatePath = file.path;
      changed = true;
    }
    if (oldPath === this.settings.collectionTemplatePath) {
      this.settings.collectionTemplatePath = file.path;
      changed = true;
    }
    if (changed) {
      await this.saveSettings();
    }
  }

  private async readNoteModelOrNotify(path: string, label: string): Promise<string | null | undefined> {
    if (path.length === 0) {
      return null;
    }

    const model = this.app.vault.getAbstractFileByPath(path);
    if (!(model instanceof TFile) || model.extension.toLowerCase() !== "md") {
      console.error(`${LOG_PREFIX} ${label} is unavailable: ${path}`);
      new Notice(`${label} is unavailable: ${path}`);
      return undefined;
    }

    try {
      return await this.app.vault.cachedRead(model);
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not read ${label.toLowerCase()}: ${path}`, error);
      new Notice(`Could not read ${label.toLowerCase()}: ${path}`);
      return undefined;
    }
  }

  private readCompanionTemplateOrNotify(): Promise<string | null | undefined> {
    return this.readNoteModelOrNotify(this.settings.companionTemplatePath, "Companion note model");
  }

  private readCollectionTemplateOrNotify(): Promise<string | null | undefined> {
    return this.readNoteModelOrNotify(this.settings.collectionTemplatePath, "Collection note model");
  }

  private addSingleCompanionMenuItem(menu: Menu, file: TFile): void {
    menu.addItem((item) => {
      item
        .setTitle("Open or create companion note")
        .setIcon("file-plus-2")
        .onClick(() => this.openOrCreateCompanion(file));
    });
  }

  private addBatchCompanionMenuItem(menu: Menu, files: readonly TAbstractFile[]): void {
    menu.addItem((item) => {
      item
        .setTitle("Create companion notes")
        .setIcon("files")
        .onClick(() => this.createCompanionBatch(files));
    });

    if (files.filter(isEligibleFile).length >= 2) {
      menu.addItem((item) => {
        item
          .setTitle("Create collection note from selected files")
          .setIcon("notebook-tabs")
          .onClick(() => this.createCollectionFromSelection(files));
      });
    }
  }

  private async createCollectionFromSelection(files: readonly TAbstractFile[]): Promise<void> {
    const eligibleFiles = files.filter(isEligibleFile);
    if (eligibleFiles.length < 2) {
      new Notice("Select at least two non-Markdown files to create a collection note.");
      return;
    }

    const modelContent = await this.readCollectionTemplateOrNotify();
    if (modelContent === undefined) {
      return;
    }

    const result = await createCollectionNote(this.app, eligibleFiles, modelContent);
    if (result.kind === "error") {
      console.error(`${LOG_PREFIX} Failed to create collection note`, result.error);
      new Notice("Could not create a collection note for the selected files.");
      return;
    }

    console.info(`${LOG_PREFIX} Collection note created: ${result.path} (${eligibleFiles.length} sources)`);
    try {
      await this.app.workspace.getLeaf(false).openFile(result.note);
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to open collection note ${result.path}`, error);
      new Notice(`Collection note exists but could not be opened: ${result.path}`);
    }
  }

  private async openOrCreateCompanion(file: TFile): Promise<void> {
    const index = this.getCompanionIndexOrNotify();
    if (index == null) {
      return;
    }

    let modelContent: string | null = null;
    if ((index.bySourcePath.get(file.path) ?? []).length === 0) {
      const loadedModel = await this.readCompanionTemplateOrNotify();
      if (loadedModel === undefined) {
        return;
      }
      modelContent = loadedModel;
    }

    const result = await createCompanionIfNeeded(this.app, file, index, modelContent);
    if (result.kind === "ambiguous") {
      const paths = result.notes.map((note) => note.path).join(", ");
      console.error(`${LOG_PREFIX} Ambiguous companion association for ${file.path}: ${paths}`);
      new Notice(`Multiple companion notes declare ${file.name} as source: ${paths}`);
      return;
    }

    if (result.kind === "error") {
      console.error(`${LOG_PREFIX} Failed to create companion for ${file.path}`, result.error);
      new Notice(`Could not open or create a companion note for ${file.name}.`);
      return;
    }

    if (result.kind === "created") {
      if (result.conflictResolved) {
        console.warn(`${LOG_PREFIX} Companion name conflict for ${file.path}; using ${result.path}`);
      }
      console.info(`${LOG_PREFIX} Companion created: ${result.note.path} (source: ${file.path})`);
    } else {
      console.info(`${LOG_PREFIX} Existing companion found: ${result.note.path} (source: ${file.path})`);
    }

    try {
      await this.app.workspace.getLeaf(false).openFile(result.note);
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to open companion ${result.note.path}`, error);
      new Notice(`Companion note exists but could not be opened: ${result.note.path}`);
    }
  }

  private async createCompanionBatch(files: readonly TAbstractFile[]): Promise<void> {
    const eligibleFiles = files.filter(isEligibleFile);
    const ignored = files.length - eligibleFiles.length;
    const index = this.getCompanionIndexOrNotify(false);
    if (index == null) {
      this.showBatchSummary(0, 0, ignored, eligibleFiles.length);
      return;
    }

    let created = 0;
    let alreadyExisting = 0;
    let errors = 0;
    let modelLoaded = false;
    let modelContent: string | null | undefined = null;

    for (const file of eligibleFiles) {
      if ((index.bySourcePath.get(file.path) ?? []).length === 0 && !modelLoaded) {
        modelContent = await this.readCompanionTemplateOrNotify();
        modelLoaded = true;
      }
      if ((index.bySourcePath.get(file.path) ?? []).length === 0 && modelContent === undefined) {
        errors += 1;
        continue;
      }

      const result = await createCompanionIfNeeded(this.app, file, index, modelContent ?? null);
      if (result.kind === "created") {
        created += 1;
        if (result.conflictResolved) {
          console.warn(`${LOG_PREFIX} Companion name conflict for ${file.path}; using ${result.path}`);
        }
        console.info(`${LOG_PREFIX} Companion created: ${result.note.path} (source: ${file.path})`);
      } else if (result.kind === "alreadyExisting") {
        alreadyExisting += 1;
        console.info(`${LOG_PREFIX} Existing companion found: ${result.note.path} (source: ${file.path})`);
      } else if (result.kind === "ambiguous") {
        errors += 1;
        console.error(
          `${LOG_PREFIX} Ambiguous companion association for ${file.path}: ${result.notes
            .map((note) => note.path)
            .join(", ")}`
        );
      } else {
        errors += 1;
        console.error(`${LOG_PREFIX} Failed to create companion for ${file.path}`, result.error);
      }
    }

    this.showBatchSummary(created, alreadyExisting, ignored, errors);
  }

  private getCompanionIndexOrNotify(notify = true): CompanionIndex | null {
    const index = buildCompanionIndex(this.app);
    if (index.missingMetadata.length === 0) {
      return index;
    }

    console.error(
      `${LOG_PREFIX} Companion discovery stopped because metadata is unavailable for: ${index.missingMetadata.join(", ")}`
    );
    if (notify) {
      new Notice("Companion notes could not be checked because Obsidian metadata is not ready.");
    }
    return null;
  }

  private showBatchSummary(created: number, alreadyExisting: number, ignored: number, errors: number): void {
    const parts = [`${created} created`, `${alreadyExisting} already existed`];
    if (ignored > 0) {
      parts.push(`${ignored} ignored`);
    }
    parts.push(`${errors} failed`);
    const message = `Companion notes: ${parts.join(", ")}.`;
    console.info(`${LOG_PREFIX} ${message}`);
    new Notice(message);
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
        if (context.selection.files.length >= 2 && context.selection.files.some(isEligibleFile)) {
          context.addItem((item) => {
            item.setTitle("Create companion notes");
            item.setIcon("files");
            item.onClick(() => this.createCompanionBatch(context.selection.files));
          });
          if (context.selection.files.filter(isEligibleFile).length >= 2) {
            context.addItem((item) => {
              item.setTitle("Create collection note from selected files");
              item.setIcon("notebook-tabs");
              item.onClick(() => this.createCollectionFromSelection(context.selection.files));
            });
          }
        }
        return;
      }

      if (isEligibleFile(context.file)) {
        context.addItem((item) => {
          item.setTitle("Open or create companion note");
          item.setIcon("file-plus-2");
          item.onClick(() => this.openOrCreateCompanion(context.file));
        });
      }
    });
    this.notebookNavigatorMenusRegistered = true;
    this.register(dispose);
    console.info(`${LOG_PREFIX} Notebook Navigator companion menus registered`);
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
