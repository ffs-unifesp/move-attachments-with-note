import { moment, normalizePath, parseYaml, TAbstractFile, TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";

export const MAX_SUFFIX_ATTEMPTS = 10000;

export interface CompanionIndex {
  bySourcePath: Map<string, TFile[]>;
  missingMetadata: string[];
}

export type EnsureCompanionResult =
  | { kind: "created"; note: TFile; path: string; conflictResolved: boolean }
  | { kind: "alreadyExisting"; note: TFile }
  | { kind: "ambiguous"; notes: TFile[] }
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

  const base = fileName.slice(0, extIndex);
  const ext = fileName.slice(extIndex);
  return `${base}-${suffix}${ext}`;
}

export function isEligibleFile(file: TAbstractFile | null): file is TFile {
  return file instanceof TFile && file.extension.toLowerCase() !== "md";
}

export function buildCompanionContent(linktext: string): string {
  const source = JSON.stringify(`[[${linktext}]]`);
  return `---\nsource: ${source}\n---\n![[${linktext}]]\n`;
}

function setCanonicalSource(frontmatter: string, sourceLink: string): string {
  const parsed = parseYaml(frontmatter);
  if (parsed != null && (typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new Error("Companion note model frontmatter must be a YAML mapping");
  }

  const sourceLine = `source: ${JSON.stringify(sourceLink)}`;
  const lines = frontmatter.split(/\r?\n/);
  const sourceIndex = lines.findIndex((line) => /^(?:source|["']source["'])\s*:/.test(line));
  if (sourceIndex === -1) {
    while (lines[lines.length - 1] === "") {
      lines.pop();
    }
    lines.push(sourceLine);
    return lines.join("\n");
  }

  let endIndex = sourceIndex + 1;
  while (endIndex < lines.length && (/^\s/.test(lines[endIndex]) || lines[endIndex].trim() === "")) {
    endIndex += 1;
  }
  lines.splice(sourceIndex, endIndex - sourceIndex, sourceLine);
  return lines.join("\n");
}

function removeTopLevelProperty(frontmatter: string, property: string): string {
  const lines = frontmatter.split(/\r?\n/);
  const propertyPattern = new RegExp(`^(?:${property}|["']${property}["'])\\s*:`);
  const propertyIndex = lines.findIndex((line) => propertyPattern.test(line));
  if (propertyIndex === -1) {
    return frontmatter;
  }

  let endIndex = propertyIndex + 1;
  while (endIndex < lines.length && (/^\s/.test(lines[endIndex]) || lines[endIndex].trim() === "")) {
    endIndex += 1;
  }
  lines.splice(propertyIndex, endIndex - propertyIndex);
  return lines.join("\n");
}

function setCanonicalSources(frontmatter: string, sourceLinks: readonly string[]): string {
  const withoutSingular = removeTopLevelProperty(frontmatter, "source");
  const withoutExisting = removeTopLevelProperty(withoutSingular, "sources").trimEnd();
  const sourcesBlock = [
    "sources:",
    ...sourceLinks.map((sourceLink) => `  - ${JSON.stringify(sourceLink)}`)
  ].join("\n");
  return withoutExisting.length === 0 ? sourcesBlock : `${withoutExisting}\n${sourcesBlock}`;
}

function expandStandardPlaceholders(
  content: string,
  title: string,
  now: number | Date
): string {
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

function splitModelContent(content: string): { frontmatter: string; body: string } {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatterMatch == null) {
    return { frontmatter: "", body: content };
  }

  const parsed = parseYaml(frontmatterMatch[1]);
  if (parsed != null && (typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new Error("Note model frontmatter must be a YAML mapping");
  }
  return {
    frontmatter: frontmatterMatch[1],
    body: content.slice(frontmatterMatch[0].length)
  };
}

export function buildCompanionContentFromModel(
  modelContent: string,
  linktext: string,
  title: string,
  now: number | Date = Date.now()
): string {
  const sourceLink = `[[${linktext}]]`;
  const embed = `![[${linktext}]]`;
  const hadEmbedPlaceholder = modelContent.includes("{{embed}}");
  let content = expandStandardPlaceholders(modelContent, title, now)
    .replace(/\{\{source\}\}/g, () => sourceLink)
    .replace(/\{\{embed\}\}/g, () => embed);

  if (!hadEmbedPlaceholder) {
    content = `${content.trimEnd()}${content.trim().length > 0 ? "\n" : ""}${embed}\n`;
  } else if (!content.endsWith("\n")) {
    content += "\n";
  }

  const { frontmatter, body } = splitModelContent(content);

  return `---\n${setCanonicalSource(frontmatter, sourceLink)}\n---\n${body}`;
}

export function getCommonDirectory(files: readonly TFile[]): string {
  if (files.length === 0) {
    return "";
  }

  const directories = files.map((file) => getDirectory(file.path).split("/").filter(Boolean));
  const common: string[] = [];
  for (let index = 0; index < directories[0].length; index += 1) {
    const segment = directories[0][index];
    if (directories.every((directory) => directory[index] === segment)) {
      common.push(segment);
    } else {
      break;
    }
  }
  return common.join("/");
}

export function findAvailableCollectionPath(
  app: App,
  sourceFiles: readonly TFile[],
  now: number | Date = Date.now()
): string | null {
  const directory = getCommonDirectory(sourceFiles);
  const fileName = `${moment(now).format("YYYY-MM-DD HH.mm")} Collection.md`;
  const primaryPath = buildPath(directory, fileName);
  if (app.vault.getAbstractFileByPath(primaryPath) == null) {
    return primaryPath;
  }

  for (let suffix = 1; suffix <= MAX_SUFFIX_ATTEMPTS; suffix += 1) {
    const candidatePath = buildPath(directory, buildNumberedName(fileName, suffix));
    if (app.vault.getAbstractFileByPath(candidatePath) == null) {
      return candidatePath;
    }
  }
  return null;
}

export function buildCollectionContent(
  linktexts: readonly string[],
  modelContent: string | null,
  title: string,
  now: number | Date = Date.now()
): string {
  const sourceLinks = linktexts.map((linktext) => `[[${linktext}]]`);
  const embeds = linktexts.map((linktext) => `![[${linktext}]]`).join("\n");
  if (modelContent == null) {
    return `---\n${setCanonicalSources("", sourceLinks)}\n---\n${embeds}\n`;
  }

  const hadEmbedsPlaceholder = modelContent.includes("{{embeds}}");
  let content = expandStandardPlaceholders(modelContent, title, now)
    .replace(/\{\{sources\}\}/g, () => sourceLinks.map((link) => `- ${link}`).join("\n"))
    .replace(/\{\{embeds\}\}/g, () => embeds);
  if (!hadEmbedsPlaceholder) {
    content = `${content.trimEnd()}${content.trim().length > 0 ? "\n" : ""}${embeds}\n`;
  } else if (!content.endsWith("\n")) {
    content += "\n";
  }

  const { frontmatter, body } = splitModelContent(content);
  return `---\n${setCanonicalSources(frontmatter, sourceLinks)}\n---\n${body}`;
}

export type CreateCollectionResult =
  | { kind: "created"; note: TFile; path: string }
  | { kind: "error"; error: unknown };

export async function createCollectionNote(
  app: App,
  sourceFiles: readonly TFile[],
  modelContent: string | null = null,
  now: number | Date = Date.now()
): Promise<CreateCollectionResult> {
  const currentFiles: TFile[] = [];
  for (const sourceFile of sourceFiles) {
    const current = app.vault.getAbstractFileByPath(sourceFile.path);
    if (!isEligibleFile(current)) {
      return { kind: "error", error: new Error(`Source file is no longer available: ${sourceFile.path}`) };
    }
    currentFiles.push(current);
  }
  if (currentFiles.length < 2) {
    return { kind: "error", error: new Error("A collection note requires at least two source files") };
  }

  const targetPath = findAvailableCollectionPath(app, currentFiles, now);
  if (targetPath == null) {
    return { kind: "error", error: new Error("Could not allocate a collection note name") };
  }

  const linktexts = currentFiles.map((file) => app.metadataCache.fileToLinktext(file, targetPath, false));
  const targetFileName = targetPath.slice(targetPath.lastIndexOf("/") + 1);
  let content: string;
  try {
    content = buildCollectionContent(linktexts, modelContent, targetFileName.slice(0, -3), now);
  } catch (error) {
    return { kind: "error", error };
  }

  try {
    const note = await app.vault.create(targetPath, content);
    return { kind: "created", note, path: targetPath };
  } catch (error) {
    return { kind: "error", error };
  }
}

export function findAvailableCompanionPath(
  app: App,
  sourceFile: TFile
): { path: string; conflictResolved: boolean } | null {
  const directory = getDirectory(sourceFile.path);
  const primaryPath = buildPath(directory, `${sourceFile.basename}.md`);
  if (app.vault.getAbstractFileByPath(primaryPath) == null) {
    return { path: primaryPath, conflictResolved: false };
  }

  const token = sourceFile.extension.length > 0 ? sourceFile.extension : "file";
  const fallbackStem = `${sourceFile.basename} - ${token}`;
  const fallbackPath = buildPath(directory, `${fallbackStem}.md`);
  if (app.vault.getAbstractFileByPath(fallbackPath) == null) {
    return { path: fallbackPath, conflictResolved: true };
  }

  for (let suffix = 1; suffix <= MAX_SUFFIX_ATTEMPTS; suffix += 1) {
    const candidatePath = buildPath(directory, `${fallbackStem}-${suffix}.md`);
    if (app.vault.getAbstractFileByPath(candidatePath) == null) {
      return { path: candidatePath, conflictResolved: true };
    }
  }

  return null;
}

function getCanonicalSourceLink(cache: CachedMetadata): string | null {
  if (typeof cache.frontmatter?.source !== "string") {
    return null;
  }

  const value = cache.frontmatter.source.trim();
  if (!/^\[\[[^\]]+\]\]$/.test(value)) {
    return null;
  }

  const sourceLinks = (cache.frontmatterLinks ?? []).filter((link) => link.key === "source");
  return sourceLinks.length === 1 ? sourceLinks[0].link : null;
}

export function buildCompanionIndex(app: App): CompanionIndex {
  const bySourcePath = new Map<string, TFile[]>();
  const missingMetadata: string[] = [];

  for (const note of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(note);
    if (cache == null) {
      missingMetadata.push(note.path);
      continue;
    }

    const sourceLink = getCanonicalSourceLink(cache);
    if (sourceLink == null) {
      continue;
    }

    const sourceFile = app.metadataCache.getFirstLinkpathDest(sourceLink, note.path);
    if (!isEligibleFile(sourceFile)) {
      continue;
    }

    const companions = bySourcePath.get(sourceFile.path) ?? [];
    companions.push(note);
    bySourcePath.set(sourceFile.path, companions);
  }

  return { bySourcePath, missingMetadata };
}

export async function createCompanionIfNeeded(
  app: App,
  sourceFile: TFile,
  index: CompanionIndex,
  modelContent: string | null = null,
  now: number | Date = Date.now()
): Promise<EnsureCompanionResult> {
  const existing = index.bySourcePath.get(sourceFile.path) ?? [];
  if (existing.length > 1) {
    return { kind: "ambiguous", notes: existing };
  }
  if (existing.length === 1) {
    return { kind: "alreadyExisting", note: existing[0] };
  }

  const currentFile = app.vault.getAbstractFileByPath(sourceFile.path);
  if (!isEligibleFile(currentFile)) {
    return { kind: "error", error: new Error(`Source file is no longer available: ${sourceFile.path}`) };
  }

  const target = findAvailableCompanionPath(app, currentFile);
  if (target == null) {
    return {
      kind: "error",
      error: new Error(
        `Could not allocate a companion name after ${MAX_SUFFIX_ATTEMPTS} numbered attempts`
      )
    };
  }

  const linktext = app.metadataCache.fileToLinktext(currentFile, target.path, false);
  let content: string;
  try {
    const targetFileName = target.path.slice(target.path.lastIndexOf("/") + 1);
    content = modelContent == null
      ? buildCompanionContent(linktext)
      : buildCompanionContentFromModel(
          modelContent,
          linktext,
          targetFileName.slice(0, -3),
          now
        );
  } catch (error) {
    return { kind: "error", error };
  }

  try {
    const note = await app.vault.create(target.path, content);
    index.bySourcePath.set(currentFile.path, [note]);
    return {
      kind: "created",
      note,
      path: target.path,
      conflictResolved: target.conflictResolved
    };
  } catch (error) {
    return { kind: "error", error };
  }
}
