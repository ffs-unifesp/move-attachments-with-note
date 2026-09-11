import { beforeEach, describe, expect, it, vi } from "vitest";
import { Menu, Notice, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";

import MoveAttachmentsWithNotePlugin from "../src/main";
import {
  buildLinkedNoteContent,
  createLinkedNote,
  findAvailableLinkedNotePath,
  getCommonDirectory,
  isEligibleFile
} from "../src/linked-note";

function createTestApp(params: {
  files: string[];
  folders?: string[];
  contents?: Record<string, string>;
  activeFile?: string;
  notebookNavigator?: {
    version: string;
    registerFileMenu: (callback: (context: any) => void) => () => void;
  };
}) {
  const filesByPath = new Map<string, TAbstractFile>();
  const contents = new Map<string, string>(Object.entries(params.contents ?? {}));
  for (const path of params.files) {
    filesByPath.set(normalizePath(path), new TFile(path));
  }
  for (const path of params.folders ?? []) {
    filesByPath.set(normalizePath(path), new TFolder(path));
  }

  const eventHandlers = new Map<string, (...args: any[]) => unknown>();
  const openFile = vi.fn(async () => undefined);
  const create = vi.fn(async (path: string, content: string) => {
    const normalized = normalizePath(path);
    if (filesByPath.has(normalized)) {
      throw new Error(`file exists: ${normalized}`);
    }
    const file = new TFile(normalized);
    filesByPath.set(normalized, file);
    contents.set(normalized, content);
    return file;
  });

  const app: any = {
    vault: {
      on: vi.fn(() => ({})),
      getAbstractFileByPath: (path: string) => filesByPath.get(normalizePath(path)) ?? null,
      getMarkdownFiles: () => [...filesByPath.values()].filter(
        (file): file is TFile => file instanceof TFile && file.extension.toLowerCase() === "md"
      ),
      cachedRead: vi.fn(async (file: TFile) => {
        const content = contents.get(file.path);
        if (content == null) {
          throw new Error(`missing content: ${file.path}`);
        }
        return content;
      }),
      create
    },
    metadataCache: {
      resolvedLinks: {},
      fileToLinktext: (file: TFile) => {
        const duplicates = [...filesByPath.values()].filter(
          (candidate) => candidate instanceof TFile && candidate.name === file.name
        );
        return duplicates.length > 1 ? file.path : file.name;
      }
    },
    fileManager: { renameFile: vi.fn(async () => undefined) },
    workspace: {
      on: vi.fn((name: string, callback: (...args: any[]) => unknown) => {
        eventHandlers.set(name, callback);
        return {};
      }),
      onLayoutReady: vi.fn((callback: () => void) => callback()),
      getActiveFile: () => params.activeFile == null
        ? null
        : filesByPath.get(normalizePath(params.activeFile)) ?? null,
      getLeaf: vi.fn(() => ({ openFile }))
    },
    plugins: params.notebookNavigator == null
      ? undefined
      : {
          getPlugin: (id: string) => id === "notebook-navigator"
            ? {
                api: {
                  getVersion: () => params.notebookNavigator?.version,
                  menus: { registerFileMenu: params.notebookNavigator.registerFileMenu }
                }
              }
            : null
        }
  };

  const plugin = new MoveAttachmentsWithNotePlugin();
  plugin.app = app;
  return { app, plugin, filesByPath, contents, eventHandlers, openFile, create };
}

describe("linked note domain logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Notice.messages = [];
  });

  it("accepts non-Markdown files and rejects Markdown files and folders", () => {
    expect(isEligibleFile(new TFile("paper.pdf"))).toBe(true);
    expect(isEligibleFile(new TFile("LICENSE"))).toBe(true);
    expect(isEligibleFile(new TFile("README.MD"))).toBe(false);
    expect(isEligibleFile(new TFolder("archive"))).toBe(false);
  });

  it.each([
    ["paper.pdf", "paper.md"],
    ["archive.tar.gz", "archive.tar.md"],
    ["LICENSE", "LICENSE.md"],
    ["Relatórios/foto verão.jpg", "Relatórios/foto verão.md"]
  ])("names a single selection %s as %s", (sourcePath, expectedPath) => {
    const { app } = createTestApp({ files: [sourcePath] });
    expect(findAvailableLinkedNotePath(app, [new TFile(sourcePath)])).toEqual({
      path: expectedPath,
      conflictResolved: false
    });
  });

  it("uses extension and numeric suffixes for single-file conflicts", () => {
    const { app } = createTestApp({
      files: ["Report.PDF", "Report.md", "Report - PDF.md", "Report - PDF-1.md"]
    });
    expect(findAvailableLinkedNotePath(app, [new TFile("Report.PDF")])).toEqual({
      path: "Report - PDF-2.md",
      conflictResolved: true
    });
  });

  it("finds the deepest folder shared by multiple files", () => {
    expect(getCommonDirectory([
      new TFile("Projects/A/one.pdf"),
      new TFile("Projects/A/Sub/two.pdf"),
      new TFile("Projects/A/three.png")
    ])).toBe("Projects/A");
    expect(getCommonDirectory([new TFile("A/one.pdf"), new TFile("B/two.pdf")])).toBe("");
  });

  it("creates a timestamped name for multiple files", () => {
    const now = new Date(2026, 8, 11, 10, 30);
    const { app } = createTestApp({ files: ["A/one.pdf", "A/two.pdf"] });
    expect(findAvailableLinkedNotePath(
      app,
      [new TFile("A/one.pdf"), new TFile("A/two.pdf")],
      now
    )).toEqual({ path: "A/2026-09-11 10.30 Collection.md", conflictResolved: false });
  });

  it("creates minimal content containing only embeds and no frontmatter", () => {
    expect(buildLinkedNoteContent(["one.pdf", "two.pdf"], null, "Collection")).toBe(
      "![[one.pdf]]\n![[two.pdf]]\n"
    );
  });

  it("copies model frontmatter unchanged and expands body placeholders", () => {
    const model = "---\ntype: document\ncustom: keep\n---\n# {{title}}\n\n{{embeds}}\n";
    const content = buildLinkedNoteContent(
      ["one.pdf", "two.pdf"],
      model,
      "Selected files",
      new Date(2026, 8, 11)
    );
    expect(content).toBe(
      "---\ntype: document\ncustom: keep\n---\n# Selected files\n\n![[one.pdf]]\n![[two.pdf]]\n"
    );
    expect(content).not.toContain("source:");
    expect(content).not.toContain("sources:");
  });

  it("appends embeds when the model has no embed placeholder", () => {
    expect(buildLinkedNoteContent(["paper.pdf"], "---\nstatus: false\n---\n", "paper")).toBe(
      "---\nstatus: false\n---\n![[paper.pdf]]\n"
    );
  });

  it("creates one note for one selected file", async () => {
    const { app, filesByPath, contents } = createTestApp({ files: ["A/paper.pdf"] });
    const result = await createLinkedNote(app, [filesByPath.get("A/paper.pdf") as TFile]);
    expect(result).toMatchObject({ kind: "created", path: "A/paper.md" });
    expect(contents.get("A/paper.md")).toBe("![[paper.pdf]]\n");
  });

  it("creates one note for all selected files", async () => {
    const now = new Date(2026, 8, 11, 10, 30);
    const { app, filesByPath, contents, create } = createTestApp({
      files: ["A/one.pdf", "A/two.pdf", "A/note.md"]
    });
    const result = await createLinkedNote(
      app,
      [filesByPath.get("A/one.pdf") as TFile, filesByPath.get("A/two.pdf") as TFile],
      null,
      now
    );
    expect(result).toMatchObject({ kind: "created", path: "A/2026-09-11 10.30 Collection.md" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(contents.get("A/2026-09-11 10.30 Collection.md")).toBe(
      "![[one.pdf]]\n![[two.pdf]]\n"
    );
  });
});

describe("linked note plugin flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Notice.messages = [];
  });

  it("creates and opens a note using the selected model", async () => {
    const { plugin, filesByPath, contents, openFile } = createTestApp({
      files: ["A/paper.pdf", "Templates/Model.md"],
      contents: { "Templates/Model.md": "---\ntype: document\n---\n# {{title}}\n" }
    });
    plugin.settings.noteTemplatePath = "Templates/Model.md";
    await (plugin as any).createNoteFromSelection([filesByPath.get("A/paper.pdf")]);
    expect(contents.get("A/paper.md")).toBe(
      "---\ntype: document\n---\n# paper\n![[paper.pdf]]\n"
    );
    expect(openFile).toHaveBeenCalledWith(filesByPath.get("A/paper.md"));
  });

  it("stops safely when the selected model is unavailable", async () => {
    const { plugin, filesByPath, create } = createTestApp({ files: ["paper.pdf"] });
    plugin.settings.noteTemplatePath = "Missing.md";
    await (plugin as any).createNoteFromSelection([filesByPath.get("paper.pdf")]);
    expect(create).not.toHaveBeenCalled();
    expect(Notice.messages.at(-1)).toBe("Linked note model is unavailable: Missing.md");
  });

  it("registers adaptive native File Explorer menus", async () => {
    const { plugin, filesByPath, eventHandlers } = createTestApp({
      files: ["paper.pdf", "figure.png", "note.md"]
    });
    await plugin.onload();

    const fileMenu = eventHandlers.get("file-menu")!;
    const singleMenu = new Menu();
    fileMenu(singleMenu, filesByPath.get("paper.pdf"), "file-explorer-context-menu");
    expect(singleMenu.items.map((item) => item.title)).toEqual(["Create note for file"]);

    const filesMenu = eventHandlers.get("files-menu")!;
    const multipleMenu = new Menu();
    filesMenu(multipleMenu, [
      filesByPath.get("paper.pdf"),
      filesByPath.get("figure.png"),
      filesByPath.get("note.md")
    ]);
    expect(multipleMenu.items.map((item) => item.title)).toEqual(["Create note for selected files"]);
  });

  it("registers adaptive Notebook Navigator menus", async () => {
    let notebookMenuCallback: ((context: any) => void) | null = null;
    const registerFileMenu = vi.fn((callback: (context: any) => void) => {
      notebookMenuCallback = callback;
      return vi.fn();
    });
    const { plugin, filesByPath } = createTestApp({
      files: ["paper.pdf", "figure.png"],
      notebookNavigator: { version: "2.5.0", registerFileMenu }
    });
    await plugin.onload();

    const singleMenu = new Menu();
    notebookMenuCallback!({
      addItem: (callback: any) => singleMenu.addItem(callback),
      file: filesByPath.get("paper.pdf"),
      selection: { mode: "single", files: [filesByPath.get("paper.pdf")] }
    });
    expect(singleMenu.items.map((item) => item.title)).toEqual(["Create note for file"]);

    const multipleMenu = new Menu();
    notebookMenuCallback!({
      addItem: (callback: any) => multipleMenu.addItem(callback),
      file: filesByPath.get("paper.pdf"),
      selection: {
        mode: "multiple",
        files: [filesByPath.get("paper.pdf"), filesByPath.get("figure.png")]
      }
    });
    expect(multipleMenu.items.map((item) => item.title)).toEqual(["Create note for selected files"]);
  });

  it("migrates the existing companion model setting", async () => {
    const { plugin } = createTestApp({ files: [] });
    plugin.data = { companionTemplatePath: "Templates/Old model.md" };
    await plugin.onload();
    expect(plugin.settings.noteTemplatePath).toBe("Templates/Old model.md");
  });

  it("exposes the command only for an active eligible file", async () => {
    const eligible = createTestApp({ files: ["paper.pdf"], activeFile: "paper.pdf" });
    await eligible.plugin.onload();
    expect(eligible.plugin.commands[0].id).toBe("create-note-for-active-file");
    expect(eligible.plugin.commands[0].checkCallback(true)).toBe(true);

    const markdown = createTestApp({ files: ["note.md"], activeFile: "note.md" });
    await markdown.plugin.onload();
    expect(markdown.plugin.commands[0].checkCallback(true)).toBe(false);
  });
});
