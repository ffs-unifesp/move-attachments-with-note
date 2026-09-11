import { moment, normalizePath, TAbstractFile, TFile } from "obsidian";
import type { App } from "obsidian";

export const MAX_SUFFIX_ATTEMPTS = 10000;

export type CreateLinkedNoteResult =
  | { kind: "created"; note: TFile; path: string; conflictResolved: boolean }
  | { kind: "error"; error: unknown };

export function getDirectory(path: string): string {
  const normalized = normalizePath(path);
  const splitIndex = normalized.lastIndexOf("/");
  return splitIndex === -1 ? "" : normalized.slice(0, splitIndex);
}

export function buildPath(dir: string, fileName: string): string {
  return dir.length > 0 ? normalizePath(`${dir}/${fileName}`) : normalizePath(fileName);
}

export function buildNumberedName(fileName: string, suffix: number): string {
  const extIndex = fileName.lastIndexOf(".");
  if (extIndex <= 0) {
    return `${fileName}-${suffix}`;
  }

  return `${fileName.slice(0, extIndex)}-${suffix}${fileName.slice(extIndex)}`;
}

export function isEligibleFile(file: TAbstractFile | null): file is TFile {
  return file instanceof TFile && file.extension.toLowerCase() !== "md";
}

export function getCommonDirectory(files: readonly TFile[]): string {
  if (files.length === 0) {
    return "";
  }

  const directories = files.map((file) => getDirectory(file.path).split("/").filter(Boolean));
  const common: string[] = [];
  for (let index = 0; index < directories[0].length; index += 1) {
    const segment = directories[0][index];
    if (!directories.every((directory) => directory[index] === segment)) {
      break;
    }
    common.push(segment);
  }
  return common.join("/");
}

function findAvailablePath(
  app: App,
  directory: string,
  fileName: string
): { path: string; conflictResolved: boolean } | null {
  const primaryPath = buildPath(directory, fileName);
  if (app.vault.getAbstractFileByPath(primaryPath) == null) {
    return { path: primaryPath, conflictResolved: false };
  }

  for (let suffix = 1; suffix <= MAX_SUFFIX_ATTEMPTS; suffix += 1) {
    const candidatePath = buildPath(directory, buildNumberedName(fileName, suffix));
    if (app.vault.getAbstractFileByPath(candidatePath) == null) {
      return { path: candidatePath, conflictResolved: true };
    }
  }
  return null;
}

export function findAvailableLinkedNotePath(
  app: App,
  sourceFiles: readonly TFile[],
  now: number | Date = Date.now()
): { path: string; conflictResolved: boolean } | null {
  if (sourceFiles.length === 0) {
    return null;
  }

  if (sourceFiles.length === 1) {
    const source = sourceFiles[0];
    const directory = getDirectory(source.path);
    const primaryPath = buildPath(directory, `${source.basename}.md`);
    if (app.vault.getAbstractFileByPath(primaryPath) == null) {
      return { path: primaryPath, conflictResolved: false };
    }

    const token = source.extension.length > 0 ? source.extension : "file";
    const fallback = findAvailablePath(app, directory, `${source.basename} - ${token}.md`);
    return fallback == null ? null : { path: fallback.path, conflictResolved: true };
  }

  const directory = getCommonDirectory(sourceFiles);
  return findAvailablePath(
    app,
    directory,
    `${moment(now).format("YYYY-MM-DD HH.mm")} Collection.md`
  );
}

function expandStandardPlaceholders(content: string, title: string, now: number | Date): string {
  const timestamp = moment(now);
  return content
    .replace(/\{\{date(?::([^}]+))?\}\}/g, (_match, format: string | undefined) =>
      timestamp.format(format ?? "YYYY-MM-DD")
    )
    .replace(/\{\{time(?::([^}]+))?\}\}/g, (_match, format: string | undefined) =>
      timestamp.format(format ?? "HH:mm")
    )
    .replace(/\{\{title\}\}/g, () => title);
}

export function buildLinkedNoteContent(
  linktexts: readonly string[],
  modelContent: string | null,
  title: string,
  now: number | Date = Date.now()
): string {
  const links = linktexts.map((linktext) => `[[${linktext}]]`);
  const embeds = linktexts.map((linktext) => `![[${linktext}]]`).join("\n");
  if (modelContent == null) {
    return `${embeds}\n`;
  }

  const hasEmbedPlaceholder = /\{\{embeds?\}\}/.test(modelContent);
  let content = expandStandardPlaceholders(modelContent, title, now)
    .replace(/\{\{link\}\}/g, () => links[0] ?? "")
    .replace(/\{\{links\}\}/g, () => links.map((link) => `- ${link}`).join("\n"))
    .replace(/\{\{embeds?\}\}/g, () => embeds);

  if (!hasEmbedPlaceholder) {
    content = `${content.trimEnd()}${content.trim().length > 0 ? "\n" : ""}${embeds}\n`;
  } else if (!content.endsWith("\n")) {
    content += "\n";
  }
  return content;
}

export async function createLinkedNote(
  app: App,
  sourceFiles: readonly TFile[],
  modelContent: string | null = null,
  now: number | Date = Date.now()
): Promise<CreateLinkedNoteResult> {
  const currentFiles: TFile[] = [];
  for (const sourceFile of sourceFiles) {
    const current = app.vault.getAbstractFileByPath(sourceFile.path);
    if (!isEligibleFile(current)) {
      return { kind: "error", error: new Error(`Selected file is no longer available: ${sourceFile.path}`) };
    }
    currentFiles.push(current);
  }
  if (currentFiles.length === 0) {
    return { kind: "error", error: new Error("At least one non-Markdown file must be selected") };
  }

  const target = findAvailableLinkedNotePath(app, currentFiles, now);
  if (target == null) {
    return { kind: "error", error: new Error("Could not allocate a linked note name") };
  }

  const linktexts = currentFiles.map((file) =>
    app.metadataCache.fileToLinktext(file, target.path, false)
  );
  const targetFileName = target.path.slice(target.path.lastIndexOf("/") + 1);
  const content = buildLinkedNoteContent(linktexts, modelContent, targetFileName.slice(0, -3), now);

  try {
    const note = await app.vault.create(target.path, content);
    return { kind: "created", note, path: target.path, conflictResolved: target.conflictResolved };
  } catch (error) {
    return { kind: "error", error };
  }
}
