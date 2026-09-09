import { beforeEach, describe, expect, it, vi } from "vitest";
import { Menu, Notice, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";

import MoveAttachmentsWithNotePlugin from "../src/main";
import {
  buildCompanionContent,
  buildCompanionContentFromModel,
  buildCompanionIndex,
  createCompanionIfNeeded,
  findAvailableCompanionPath,
  isEligibleFile
} from "../src/companion";

type Cache = {
  frontmatter?: Record<string, unknown>;
  frontmatterLinks?: Array<{ key: string; link: string }>;
};

function createTestApp(params: {
  files: string[];
  folders?: string[];
  caches?: Record<string, Cache | null>;
  failCreate?: string[];
  activeFile?: string;
  contents?: Record<string, string>;
  notebookNavigator?: {
    version: string;
    registerFileMenu: (callback: (context: any) => void) => () => void;
  };
}) {
  const filesByPath = new Map<string, TAbstractFile>();
  const contents = new Map<string, string>(
    Object.entries(params.contents ?? {}).map(([path, content]) => [normalizePath(path), content])
  );
  for (const path of params.files) {
    filesByPath.set(normalizePath(path), new TFile(path));
  }
  for (const path of params.folders ?? []) {
    filesByPath.set(normalizePath(path), new TFolder(path));
  }

  const failCreate = new Set((params.failCreate ?? []).map(normalizePath));
  const eventHandlers = new Map<string, (...args: any[]) => unknown>();
  const openFile = vi.fn(async () => undefined);
  const create = vi.fn(async (path: string, content: string) => {
    const normalized = normalizePath(path);
    if (failCreate.has(normalized)) {
      throw new Error(`create failed: ${normalized}`);
    }
    if (filesByPath.has(normalized)) {
      throw new Error(`file exists: ${normalized}`);
    }
    const file = new TFile(normalized);
    filesByPath.set(normalized, file);
    contents.set(normalized, content);
    return file;
  });

  const getFirstLinkpathDest = (linktext: string, sourcePath: string): TFile | null => {
    const linkpath = linktext.split("|")[0];
    const direct = filesByPath.get(normalizePath(linkpath));
    if (direct instanceof TFile) {
      return direct;
    }

    const slashIndex = sourcePath.lastIndexOf("/");
    const directory = slashIndex === -1 ? "" : sourcePath.slice(0, slashIndex);
    const relativePath = normalizePath(directory.length > 0 ? `${directory}/${linkpath}` : linkpath);
    const relative = filesByPath.get(relativePath);
    if (relative instanceof TFile) {
      return relative;
    }

    const matches = [...filesByPath.values()].filter(
      (file): file is TFile => file instanceof TFile && file.name === linkpath
    );
    return matches.length === 1 ? matches[0] : null;
  };

  const app: any = {
    vault: {
      on: vi.fn(() => ({})),
      getAbstractFileByPath: (path: string) => filesByPath.get(normalizePath(path)) ?? null,
      getMarkdownFiles: () =>
        [...filesByPath.values()].filter(
          (file): file is TFile => file instanceof TFile && file.extension.toLowerCase() === "md"
        ),
      create,
      cachedRead: vi.fn(async (file: TFile) => {
        const content = contents.get(file.path);
        if (content == null) {
          throw new Error(`missing content: ${file.path}`);
        }
        return content;
      })
    },
    fileManager: {
      renameFile: vi.fn(async () => undefined)
    },
    metadataCache: {
      resolvedLinks: {},
      getFileCache: (file: TFile) => {
        if (Object.prototype.hasOwnProperty.call(params.caches ?? {}, file.path)) {
          return params.caches?.[file.path] ?? null;
        }
        return {};
      },
      getFirstLinkpathDest,
      fileToLinktext: (file: TFile) => {
        const duplicates = [...filesByPath.values()].filter(
          (candidate) => candidate instanceof TFile && candidate.name === file.name
        );
        return duplicates.length > 1 ? file.path : file.name;
      }
    },
    workspace: {
      on: vi.fn((name: string, callback: (...args: any[]) => unknown) => {
        eventHandlers.set(name, callback);
        return {};
      }),
      onLayoutReady: vi.fn((callback: () => void) => callback()),
      getActiveFile: () =>
        params.activeFile == null
          ? null
          : filesByPath.get(normalizePath(params.activeFile)) ?? null,
      getLeaf: vi.fn(() => ({ openFile }))
    },
    plugins: params.notebookNavigator == null
      ? undefined
      : {
          getPlugin: (id: string) =>
            id === "notebook-navigator"
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

describe("companion note domain logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Notice.messages = [];
  });

  it.each([
    ["paper.pdf", "paper.md"],
    ["foto.jpg", "foto.md"],
    ["archive.tar.gz", "archive.tar.md"],
    ["LICENSE", "LICENSE.md"],
    ["Relatórios/foto verão.jpg", "Relatórios/foto verão.md"]
  ])("names %s as %s", (sourcePath, expectedPath) => {
    const { app, filesByPath } = createTestApp({ files: [sourcePath] });
    const source = filesByPath.get(sourcePath) as TFile;

    expect(findAvailableCompanionPath(app, source)).toEqual({
      path: expectedPath,
      conflictResolved: false
    });
  });

  it("uses the extension and then numbered suffixes for collisions", () => {
    const { app, filesByPath } = createTestApp({
      files: ["Research/Report.PDF", "Research/Report.md", "Research/Report - PDF.md", "Research/Report - PDF-1.md"]
    });

    expect(findAvailableCompanionPath(app, filesByPath.get("Research/Report.PDF") as TFile)).toEqual({
      path: "Research/Report - PDF-2.md",
      conflictResolved: true
    });
  });

  it("uses the file token for an extensionless collision", () => {
    const { app, filesByPath } = createTestApp({ files: ["LICENSE", "LICENSE.md"] });

    expect(findAvailableCompanionPath(app, filesByPath.get("LICENSE") as TFile)).toEqual({
      path: "LICENSE - file.md",
      conflictResolved: true
    });
  });

  it("creates the canonical frontmatter and embed", () => {
    expect(buildCompanionContent("article.pdf")).toBe(
      '---\nsource: "[[article.pdf]]"\n---\n![[article.pdf]]\n'
    );
  });

  it("creates from a model while replacing source and expanding placeholders", () => {
    const now = new Date(2026, 8, 9, 14, 5);
    const content = buildCompanionContentFromModel(
      "---\ntitle: {{title}}\ndate: {{date:YYYY-MM-DD HH:mm}}\nsource: old.pdf\nstatus: false\n---\n# {{title}}\n\n{{embed}}\n",
      "Research/article.pdf",
      "article",
      now
    );

    expect(content).toBe(
      '---\ntitle: article\ndate: 2026-09-09 14:05\nsource: "[[Research/article.pdf]]"\nstatus: false\n---\n# article\n\n![[Research/article.pdf]]\n'
    );
  });

  it("preserves comments and replaces a multi-line source property only", () => {
    const content = buildCompanionContentFromModel(
      "---\n# keep this comment\ntags:\n  - document\nsource:\n  - '[[old.pdf]]'\nstatus: false\n---\nBody\n",
      "new.pdf",
      "new"
    );

    expect(content).toContain("# keep this comment\ntags:\n  - document");
    expect(content).toContain('source: "[[new.pdf]]"\nstatus: false');
    expect(content).not.toContain("old.pdf");
  });

  it("expands replacement-sensitive characters literally", () => {
    const content = buildCompanionContentFromModel(
      "{{title}}\n{{source}}\n{{embed}}\n",
      "cash-$&.pdf",
      "cash-$&"
    );

    expect(content).toContain("cash-$&\n[[cash-$&.pdf]]\n![[cash-$&.pdf]]");
  });

  it("adds frontmatter and appends the embed when the model has neither", () => {
    expect(
      buildCompanionContentFromModel("# Notes for {{source}}\n", "paper.pdf", "paper", new Date(2026, 0, 1))
    ).toBe('---\nsource: "[[paper.pdf]]"\n---\n# Notes for [[paper.pdf]]\n![[paper.pdf]]\n');
  });

  it("recognizes a manually created, renamed companion by source", () => {
    const { app } = createTestApp({
      files: ["Research/article.pdf", "Notes/Mutation Testing.md"],
      caches: {
        "Notes/Mutation Testing.md": {
          frontmatter: { source: "[[Research/article.pdf]]" },
          frontmatterLinks: [{ key: "source", link: "Research/article.pdf" }]
        }
      }
    });

    const index = buildCompanionIndex(app);
    expect(index.bySourcePath.get("Research/article.pdf")?.map((file) => file.path)).toEqual([
      "Notes/Mutation Testing.md"
    ]);
  });

  it("resolves aliased and path-qualified source links", () => {
    const { app } = createTestApp({
      files: ["Research/article.pdf", "Other/article.pdf", "Notes/Article.md"],
      caches: {
        "Notes/Article.md": {
          frontmatter: { source: "[[Research/article.pdf|primary article]]" },
          frontmatterLinks: [{ key: "source", link: "Research/article.pdf" }]
        }
      }
    });

    const index = buildCompanionIndex(app);
    expect(index.bySourcePath.get("Research/article.pdf")?.map((file) => file.path)).toEqual([
      "Notes/Article.md"
    ]);
    expect(index.bySourcePath.has("Other/article.pdf")).toBe(false);
  });

  it("does not require the embed body to recognize a companion", () => {
    const { app } = createTestApp({
      files: ["paper.pdf", "My paper.md"],
      caches: {
        "My paper.md": {
          frontmatter: { source: "[[paper.pdf]]" },
          frontmatterLinks: [{ key: "source", link: "paper.pdf" }]
        }
      }
    });

    expect(buildCompanionIndex(app).bySourcePath.get("paper.pdf")).toHaveLength(1);
  });

  it("rejects non-scalar and non-wiki source properties", () => {
    const { app } = createTestApp({
      files: ["paper.pdf", "list.md", "plain.md"],
      caches: {
        "list.md": {
          frontmatter: { source: ["[[paper.pdf]]"] },
          frontmatterLinks: [{ key: "source.0", link: "paper.pdf" }]
        },
        "plain.md": { frontmatter: { source: "paper.pdf" }, frontmatterLinks: [] }
      }
    });

    expect(buildCompanionIndex(app).bySourcePath.size).toBe(0);
  });

  it("reports multiple companions without choosing one", async () => {
    const { app, filesByPath } = createTestApp({
      files: ["paper.pdf", "First.md", "Second.md"],
      caches: {
        "First.md": {
          frontmatter: { source: "[[paper.pdf]]" },
          frontmatterLinks: [{ key: "source", link: "paper.pdf" }]
        },
        "Second.md": {
          frontmatter: { source: "[[paper.pdf]]" },
          frontmatterLinks: [{ key: "source", link: "paper.pdf" }]
        }
      }
    });

    const result = await createCompanionIfNeeded(
      app,
      filesByPath.get("paper.pdf") as TFile,
      buildCompanionIndex(app)
    );
    expect(result.kind).toBe("ambiguous");
  });

  it("creates once and reuses the same in-memory batch index", async () => {
    const { app, filesByPath, create } = createTestApp({ files: ["paper.pdf"] });
    const source = filesByPath.get("paper.pdf") as TFile;
    const index = buildCompanionIndex(app);

    expect((await createCompanionIfNeeded(app, source, index)).kind).toBe("created");
    expect((await createCompanionIfNeeded(app, source, index)).kind).toBe("alreadyExisting");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("marks unavailable source files as errors", async () => {
    const { app, filesByPath } = createTestApp({ files: ["gone.pdf"] });
    const source = filesByPath.get("gone.pdf") as TFile;
    filesByPath.delete("gone.pdf");

    expect((await createCompanionIfNeeded(app, source, buildCompanionIndex(app))).kind).toBe("error");
  });

  it("accepts every non-Markdown TFile and rejects Markdown and folders", () => {
    expect(isEligibleFile(new TFile("data.unknown"))).toBe(true);
    expect(isEligibleFile(new TFile("LICENSE"))).toBe(true);
    expect(isEligibleFile(new TFile("README.MD"))).toBe(false);
    expect(isEligibleFile(new TFolder("archive"))).toBe(false);
  });
});

describe("companion note flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Notice.messages = [];
  });

  it("creates and opens a single companion", async () => {
    const { plugin, filesByPath, contents, openFile } = createTestApp({ files: ["Research/article.pdf"] });

    await (plugin as any).openOrCreateCompanion(filesByPath.get("Research/article.pdf"));

    expect(contents.get("Research/article.md")).toBe(
      '---\nsource: "[[article.pdf]]"\n---\n![[article.pdf]]\n'
    );
    expect(openFile).toHaveBeenCalledWith(filesByPath.get("Research/article.md"));
  });

  it("uses the selected vault note as the companion model", async () => {
    const { plugin, filesByPath, contents } = createTestApp({
      files: ["Research/article.pdf", "Static/Companion model.md"],
      contents: {
        "Static/Companion model.md": "---\ntype: document\n---\n# {{title}}\n\n{{embed}}\n"
      }
    });
    plugin.settings.companionTemplatePath = "Static/Companion model.md";

    await (plugin as any).openOrCreateCompanion(filesByPath.get("Research/article.pdf"));

    expect(contents.get("Research/article.md")).toContain("type: document");
    expect(contents.get("Research/article.md")).toContain('source: "[[article.pdf]]"');
    expect(contents.get("Research/article.md")).toContain("# article\n\n![[article.pdf]]");
  });

  it("stops creation with a notice when the selected model is unavailable", async () => {
    const { plugin, filesByPath, create } = createTestApp({ files: ["paper.pdf"] });
    plugin.settings.companionTemplatePath = "Missing model.md";

    await (plugin as any).openOrCreateCompanion(filesByPath.get("paper.pdf"));

    expect(create).not.toHaveBeenCalled();
    expect(Notice.messages.at(-1)).toBe("Companion note model is unavailable: Missing model.md");
  });

  it("opens an existing companion even when the selected model is unavailable", async () => {
    const { plugin, filesByPath, create, openFile } = createTestApp({
      files: ["paper.pdf", "Paper notes.md"],
      caches: {
        "Paper notes.md": {
          frontmatter: { source: "[[paper.pdf]]" },
          frontmatterLinks: [{ key: "source", link: "paper.pdf" }]
        }
      }
    });
    plugin.settings.companionTemplatePath = "Missing model.md";

    await (plugin as any).openOrCreateCompanion(filesByPath.get("paper.pdf"));

    expect(create).not.toHaveBeenCalled();
    expect(openFile).toHaveBeenCalledWith(filesByPath.get("Paper notes.md"));
    expect(Notice.messages).toHaveLength(0);
  });

  it("opens an existing companion without creating another note", async () => {
    const { plugin, filesByPath, create, openFile } = createTestApp({
      files: ["paper.pdf", "Paper notes.md"],
      caches: {
        "Paper notes.md": {
          frontmatter: { source: "[[paper.pdf]]" },
          frontmatterLinks: [{ key: "source", link: "paper.pdf" }]
        }
      }
    });

    await (plugin as any).openOrCreateCompanion(filesByPath.get("paper.pdf"));

    expect(create).not.toHaveBeenCalled();
    expect(openFile).toHaveBeenCalledWith(filesByPath.get("Paper notes.md"));
  });

  it("notifies about an ambiguous association and opens nothing", async () => {
    const { plugin, filesByPath, openFile } = createTestApp({
      files: ["paper.pdf", "First.md", "Second.md"],
      caches: {
        "First.md": {
          frontmatter: { source: "[[paper.pdf]]" },
          frontmatterLinks: [{ key: "source", link: "paper.pdf" }]
        },
        "Second.md": {
          frontmatter: { source: "[[paper.pdf]]" },
          frontmatterLinks: [{ key: "source", link: "paper.pdf" }]
        }
      }
    });

    await (plugin as any).openOrCreateCompanion(filesByPath.get("paper.pdf"));

    expect(openFile).not.toHaveBeenCalled();
    expect(Notice.messages.at(-1)).toContain("First.md, Second.md");
  });

  it("uses a qualified link when duplicate filenames make the short link ambiguous", async () => {
    const { plugin, filesByPath, contents } = createTestApp({
      files: ["Research/article.pdf", "Archive/article.pdf"]
    });

    await (plugin as any).openOrCreateCompanion(filesByPath.get("Research/article.pdf"));

    expect(contents.get("Research/article.md")).toBe(
      '---\nsource: "[[Research/article.pdf]]"\n---\n![[Research/article.pdf]]\n'
    );
  });

  it("continues a mixed batch after one file fails and opens nothing", async () => {
    const { plugin, filesByPath, openFile } = createTestApp({
      files: ["a.pdf", "b.jpg", "c.xlsx", "note.md"],
      folders: ["archive"],
      failCreate: ["b.md"]
    });

    await (plugin as any).createCompanionBatch([
      filesByPath.get("a.pdf"),
      filesByPath.get("b.jpg"),
      filesByPath.get("c.xlsx"),
      filesByPath.get("note.md"),
      filesByPath.get("archive")
    ]);

    expect(filesByPath.has("a.md")).toBe(true);
    expect(filesByPath.has("b.md")).toBe(false);
    expect(filesByPath.has("c.md")).toBe(true);
    expect(openFile).not.toHaveBeenCalled();
    expect(Notice.messages.at(-1)).toBe(
      "Companion notes: 2 created, 0 already existed, 2 ignored, 1 failed."
    );
  });

  it("counts an existing companion without duplicating it", async () => {
    const { plugin, filesByPath, create, openFile } = createTestApp({
      files: ["photo.jpg", "article.pdf", "article.md", "results.xlsx"],
      caches: {
        "article.md": {
          frontmatter: { source: "[[article.pdf]]" },
          frontmatterLinks: [{ key: "source", link: "article.pdf" }]
        }
      }
    });

    await (plugin as any).createCompanionBatch([
      filesByPath.get("photo.jpg"),
      filesByPath.get("article.pdf"),
      filesByPath.get("results.xlsx")
    ]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(filesByPath.has("photo.md")).toBe(true);
    expect(filesByPath.has("results.md")).toBe(true);
    expect(openFile).not.toHaveBeenCalled();
    expect(Notice.messages.at(-1)).toBe(
      "Companion notes: 2 created, 1 already existed, 0 failed."
    );
  });

  it("fails safely when metadata is unavailable", async () => {
    const { plugin, filesByPath, create } = createTestApp({
      files: ["paper.pdf", "Uncached.md"],
      caches: { "Uncached.md": null }
    });

    await (plugin as any).openOrCreateCompanion(filesByPath.get("paper.pdf"));

    expect(create).not.toHaveBeenCalled();
    expect(Notice.messages).toContain(
      "Companion notes could not be checked because Obsidian metadata is not ready."
    );
  });

  it("registers native menus only for the intended File Explorer surfaces", async () => {
    const { plugin, filesByPath, eventHandlers } = createTestApp({ files: ["paper.pdf", "note.md"] });
    await plugin.onload();

    const fileMenu = eventHandlers.get("file-menu")!;
    const explorerMenu = new Menu();
    fileMenu(explorerMenu, filesByPath.get("paper.pdf"), "file-explorer-context-menu");
    expect(explorerMenu.items.map((item) => item.title)).toEqual(["Open or create companion note"]);

    const tabMenu = new Menu();
    fileMenu(tabMenu, filesByPath.get("paper.pdf"), "tab-header");
    expect(tabMenu.items).toHaveLength(0);

    const markdownMenu = new Menu();
    fileMenu(markdownMenu, filesByPath.get("note.md"), "file-explorer-context-menu");
    expect(markdownMenu.items).toHaveLength(0);

    const filesMenu = eventHandlers.get("files-menu")!;
    const batchMenu = new Menu();
    filesMenu(batchMenu, [filesByPath.get("paper.pdf"), filesByPath.get("note.md")]);
    expect(batchMenu.items.map((item) => item.title)).toEqual(["Create companion notes"]);
  });

  it("registers both Notebook Navigator selection modes through its optional API", async () => {
    let notebookMenuCallback: ((context: any) => void) | null = null;
    const registerFileMenu = vi.fn((callback: (context: any) => void) => {
      notebookMenuCallback = callback;
      return vi.fn();
    });
    const { plugin, filesByPath } = createTestApp({
      files: ["paper.pdf", "figure.png", "note.md"],
      notebookNavigator: { version: "2.5.0", registerFileMenu }
    });
    await plugin.onload();

    expect(registerFileMenu).toHaveBeenCalledTimes(1);
    const singleMenu = new Menu();
    notebookMenuCallback!({
      addItem: (callback: any) => singleMenu.addItem(callback),
      file: filesByPath.get("paper.pdf"),
      selection: { mode: "single", files: [filesByPath.get("paper.pdf")] }
    });
    expect(singleMenu.items.map((item) => item.title)).toEqual(["Open or create companion note"]);

    const batchMenu = new Menu();
    notebookMenuCallback!({
      addItem: (callback: any) => batchMenu.addItem(callback),
      file: filesByPath.get("paper.pdf"),
      selection: {
        mode: "multiple",
        files: [filesByPath.get("paper.pdf"), filesByPath.get("figure.png"), filesByPath.get("note.md")]
      }
    });
    expect(batchMenu.items.map((item) => item.title)).toEqual(["Create companion notes"]);

    expect(registerFileMenu).toHaveBeenCalledTimes(1);
  });

  it("waits for Notebook Navigator to publish its API asynchronously", async () => {
    vi.useFakeTimers();
    try {
      const registerFileMenu = vi.fn(() => vi.fn());
      const { app, plugin } = createTestApp({ files: ["paper.pdf"] });
      await plugin.onload();

      expect(registerFileMenu).not.toHaveBeenCalled();
      app.plugins = {
        getPlugin: () => ({
          api: {
            getVersion: () => "2.0.0",
            menus: { registerFileMenu }
          }
        })
      };

      await vi.advanceTimersByTimeAsync(250);
      expect(registerFileMenu).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(registerFileMenu).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes the command only for an active eligible file", async () => {
    const eligible = createTestApp({ files: ["paper.pdf"], activeFile: "paper.pdf" });
    await eligible.plugin.onload();
    expect(eligible.plugin.commands[0].checkCallback(true)).toBe(true);

    const markdown = createTestApp({ files: ["note.md"], activeFile: "note.md" });
    await markdown.plugin.onload();
    expect(markdown.plugin.commands[0].checkCallback(true)).toBe(false);
  });
});
