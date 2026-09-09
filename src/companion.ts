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

export function buildCompanionContentFromModel(
  modelContent: string,
  linktext: string,
  title: string,
  now: number | Date = Date.now()
): string {
  const sourceLink = `[[${linktext}]]`;
  const embed = `![[${linktext}]]`;
  const hadEmbedPlaceholder = modelContent.includes("{{embed}}");
  const timestamp = moment(now);
  let content = modelContent
    .replace(/\{\{date(?::([^}]+))?\}\}/g, (_match, format: string | undefined) =>
      timestamp.format(format ?? "YYYY-MM-DD")
    )
    .replace(/\{\{time(?::([^}]+))?\}\}/g, (_match, format: string | undefined) =>
      timestamp.format(format ?? "HH:mm")
    )
    .replace(/\{\{title\}\}/g, () => title)
    .replace(/\{\{source\}\}/g, () => sourceLink)
    .replace(/\{\{embed\}\}/g, () => embed);

  if (!hadEmbedPlaceholder) {
    content = `${content.trimEnd()}${content.trim().length > 0 ? "\n" : ""}${embed}\n`;
  } else if (!content.endsWith("\n")) {
    content += "\n";
  }

  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let frontmatter = "";
  let body = content;
  if (frontmatterMatch != null) {
    frontmatter = frontmatterMatch[1];
    body = content.slice(frontmatterMatch[0].length);
  }

  return `---\n${setCanonicalSource(frontmatter, sourceLink)}\n---\n${body}`;
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
