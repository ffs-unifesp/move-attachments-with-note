import { normalizePath, Plugin, TAbstractFile, TFile } from "obsidian";

const LOG_PREFIX = "[move-attachments-with-note]";
const LINK_CACHE_DELAY_MS = 150;
const MAX_SUFFIX_ATTEMPTS = 10000;

type LinkMap = Record<string, number>;
type ResolvedLinks = Record<string, LinkMap>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDirectory(path: string): string {
  const normalized = normalizePath(path);
  const splitIndex = normalized.lastIndexOf("/");
  return splitIndex === -1 ? "" : normalized.slice(0, splitIndex);
}

function buildPath(dir: string, fileName: string): string {
  return dir.length > 0 ? normalizePath(`${dir}/${fileName}`) : normalizePath(fileName);
}

function buildNumberedName(fileName: string, suffix: number): string {
  const extIndex = fileName.lastIndexOf(".");
  if (extIndex <= 0) {
    return `${fileName}-${suffix}`;
  }

  const base = fileName.slice(0, extIndex);
  const ext = fileName.slice(extIndex);
  return `${base}-${suffix}${ext}`;
}

export default class MoveAttachmentsWithNotePlugin extends Plugin {
  async onload(): Promise<void> {
    console.info(`${LOG_PREFIX} loaded`);

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        void this.handleRename(file, oldPath);
      })
    );
  }

  onunload(): void {
    console.info(`${LOG_PREFIX} unloaded`);
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
