import { beforeEach, describe, expect, it, vi } from "vitest";

import MoveAttachmentsWithNotePlugin from "../src/main";
import { TFile, normalizePath } from "obsidian";

type ResolvedLinks = Record<string, Record<string, number>>;

function createFile(path: string): TFile {
  return new TFile(path);
}

function setupPlugin(params: {
  files: string[];
  resolvedLinks: ResolvedLinks;
}) {
  const filesByPath = new Map<string, TFile>();
  for (const path of params.files) {
    const file = createFile(path);
    filesByPath.set(file.path, file);
  }

  const vault = {
    getAbstractFileByPath: (path: string) => filesByPath.get(normalizePath(path)) ?? null
  };

  const fileManager = {
    renameFile: vi.fn(async (file: TFile, newPath: string) => {
      filesByPath.delete(file.path);
      file.updatePath(newPath);
      filesByPath.set(file.path, file);
    })
  };

  const app = {
    vault,
    fileManager,
    metadataCache: {
      resolvedLinks: params.resolvedLinks
    }
  };

  const plugin = new MoveAttachmentsWithNotePlugin();
  (plugin as { app: unknown }).app = app;

  return { plugin, fileManager, filesByPath };
}

async function runRename(plugin: MoveAttachmentsWithNotePlugin, movedNotePath: string, oldPath: string) {
  const note = createFile(movedNotePath);
  await (plugin as unknown as { handleRename: (file: TFile, oldPath: string) => Promise<void> }).handleRename(
    note,
    oldPath
  );
}

describe("Move Attachments With Note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T1: moves local attachments when note changes folder", async () => {
    const { plugin, fileManager, filesByPath } = setupPlugin({
      files: ["QA/T1/A/img.png", "QA/T1/A/doc.pdf"],
      resolvedLinks: {
        "QA/T1/B/Note.md": { "QA/T1/A/img.png": 1, "QA/T1/A/doc.pdf": 1 }
      }
    });

    await runRename(plugin, "QA/T1/B/Note.md", "QA/T1/A/Note.md");

    expect(fileManager.renameFile).toHaveBeenCalledTimes(2);
    expect(filesByPath.has("QA/T1/B/img.png")).toBe(true);
    expect(filesByPath.has("QA/T1/B/doc.pdf")).toBe(true);
  });

  it("T2: ignores rename when note stays in same folder", async () => {
    const { plugin, fileManager } = setupPlugin({
      files: ["QA/T2/A/img.png"],
      resolvedLinks: {
        "QA/T2/A/Note2.md": { "QA/T2/A/img.png": 1 }
      }
    });

    await runRename(plugin, "QA/T2/A/Note2.md", "QA/T2/A/Note.md");

    expect(fileManager.renameFile).not.toHaveBeenCalled();
  });

  it("T3: note with no attachments does nothing", async () => {
    const { plugin, fileManager } = setupPlugin({
      files: [],
      resolvedLinks: {}
    });

    await runRename(plugin, "QA/T3/B/Note.md", "QA/T3/A/Note.md");

    expect(fileManager.renameFile).not.toHaveBeenCalled();
  });

  it("T4: ignores attachments outside old note folder", async () => {
    const { plugin, fileManager, filesByPath } = setupPlugin({
      files: ["QA/T4/Global/img.png"],
      resolvedLinks: {
        "QA/T4/B/Note.md": { "QA/T4/Global/img.png": 1 }
      }
    });

    await runRename(plugin, "QA/T4/B/Note.md", "QA/T4/A/Note.md");

    expect(fileManager.renameFile).not.toHaveBeenCalled();
    expect(filesByPath.has("QA/T4/Global/img.png")).toBe(true);
  });

  it("T5: ignores shared attachments referenced by another markdown note", async () => {
    const { plugin, fileManager, filesByPath } = setupPlugin({
      files: ["QA/T5/A/img.png"],
      resolvedLinks: {
        "QA/T5/B/Note1.md": { "QA/T5/A/img.png": 1 },
        "QA/T5/C/Note2.md": { "QA/T5/A/img.png": 1 }
      }
    });

    await runRename(plugin, "QA/T5/B/Note1.md", "QA/T5/A/Note1.md");

    expect(fileManager.renameFile).not.toHaveBeenCalled();
    expect(filesByPath.has("QA/T5/A/img.png")).toBe(true);
  });

  it("T6: resolves destination conflicts using numeric suffix", async () => {
    const { plugin, fileManager, filesByPath } = setupPlugin({
      files: ["QA/T6/A/img.png", "QA/T6/B/img.png"],
      resolvedLinks: {
        "QA/T6/B/Note.md": { "QA/T6/A/img.png": 1 }
      }
    });

    await runRename(plugin, "QA/T6/B/Note.md", "QA/T6/A/Note.md");

    expect(fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(filesByPath.has("QA/T6/B/img-1.png")).toBe(true);
  });

  it("T7: broken links are ignored without throwing", async () => {
    const { plugin, fileManager } = setupPlugin({
      files: [],
      resolvedLinks: {
        "QA/T7/B/Note.md": {
          "QA/T7/A/missing-file.pdf": 1,
          "QA/T7/A/missing-image.png": 1
        }
      }
    });

    await expect(runRename(plugin, "QA/T7/B/Note.md", "QA/T7/A/Note.md")).resolves.toBeUndefined();
    expect(fileManager.renameFile).not.toHaveBeenCalled();
  });

  it("T8: moving note to vault root moves eligible attachments to root", async () => {
    const { plugin, fileManager, filesByPath } = setupPlugin({
      files: ["QA/T8/A/img.png"],
      resolvedLinks: {
        "Note.md": { "QA/T8/A/img.png": 1 }
      }
    });

    await runRename(plugin, "Note.md", "QA/T8/A/Note.md");

    expect(fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(filesByPath.has("img.png")).toBe(true);
  });

  it("T9: moves both wiki-style and markdown-style linked attachments", async () => {
    const { plugin, fileManager, filesByPath } = setupPlugin({
      files: ["QA/T9/A/img.png", "QA/T9/A/doc.pdf"],
      resolvedLinks: {
        "QA/T9/B/Note.md": { "QA/T9/A/img.png": 1, "QA/T9/A/doc.pdf": 1 }
      }
    });

    await runRename(plugin, "QA/T9/B/Note.md", "QA/T9/A/Note.md");

    expect(fileManager.renameFile).toHaveBeenCalledTimes(2);
    expect(filesByPath.has("QA/T9/B/img.png")).toBe(true);
    expect(filesByPath.has("QA/T9/B/doc.pdf")).toBe(true);
  });

  it("T10: handles attachment names with spaces and accents", async () => {
    const { plugin, fileManager, filesByPath } = setupPlugin({
      files: ["QA/T10/A/image a-tilde ã.png", "QA/T10/A/report e-acute é.pdf"],
      resolvedLinks: {
        "QA/T10/B/Note.md": {
          "QA/T10/A/image a-tilde ã.png": 1,
          "QA/T10/A/report e-acute é.pdf": 1
        }
      }
    });

    await runRename(plugin, "QA/T10/B/Note.md", "QA/T10/A/Note.md");

    expect(fileManager.renameFile).toHaveBeenCalledTimes(2);
    expect(filesByPath.has("QA/T10/B/image a-tilde ã.png")).toBe(true);
    expect(filesByPath.has("QA/T10/B/report e-acute é.pdf")).toBe(true);
  });
});
