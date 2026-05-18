export class TAbstractFile {}

export class TFile extends TAbstractFile {
  path: string;
  name: string;
  extension: string;

  constructor(path: string) {
    super();
    this.path = "";
    this.name = "";
    this.extension = "";
    this.updatePath(path);
  }

  updatePath(nextPath: string): void {
    this.path = normalizePath(nextPath);
    const slashIndex = this.path.lastIndexOf("/");
    const fileName = slashIndex === -1 ? this.path : this.path.slice(slashIndex + 1);
    this.name = fileName;
    const dotIndex = fileName.lastIndexOf(".");
    this.extension = dotIndex > 0 ? fileName.slice(dotIndex + 1) : "";
  }
}

export class Plugin {
  app: unknown;

  constructor(app?: unknown) {
    this.app = app;
  }

  registerEvent(): void {
    // no-op for tests
  }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}
