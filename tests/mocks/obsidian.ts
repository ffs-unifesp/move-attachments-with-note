export class TAbstractFile {
  path: string;
  name: string;

  constructor(path = "") {
    this.path = normalizePath(path);
    const slashIndex = this.path.lastIndexOf("/");
    this.name = slashIndex === -1 ? this.path : this.path.slice(slashIndex + 1);
  }
}

export class TFolder extends TAbstractFile {}

export class TFile extends TAbstractFile {
  basename: string;
  extension: string;

  constructor(path: string) {
    super(path);
    this.basename = "";
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
    this.basename = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  }
}

export class Plugin {
  app: any;
  commands: any[] = [];
  disposers: Array<() => void> = [];
  settingTabs: any[] = [];
  data: any = null;

  constructor(app?: any) {
    this.app = app;
  }

  registerEvent(): void {
    // no-op for tests
  }

  register(dispose: () => void): void {
    this.disposers.push(dispose);
  }

  addCommand(command: any): void {
    this.commands.push(command);
  }

  addSettingTab(tab: any): void {
    this.settingTabs.push(tab);
  }

  async loadData(): Promise<any> {
    return this.data;
  }

  async saveData(data: any): Promise<void> {
    this.data = data;
  }
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl = { empty: () => undefined };

  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
}

export class AbstractInputSuggest<T> {
  app: any;
  callback: ((value: T) => unknown) | null = null;

  constructor(app: any, _input: unknown) {
    this.app = app;
  }

  onSelect(callback: (value: T) => unknown): this {
    this.callback = callback;
    return this;
  }
}

export class TextComponent {
  inputEl = {};
  value = "";

  setPlaceholder(_placeholder: string): this {
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  onChange(_callback: (value: string) => unknown): this {
    return this;
  }
}

export class Setting {
  constructor(_container: unknown) {}

  setName(_name: string): this {
    return this;
  }

  setDesc(_description: string): this {
    return this;
  }

  addText(callback: (text: TextComponent) => void): this {
    callback(new TextComponent());
    return this;
  }
}

export class MenuItem {
  title = "";
  icon = "";
  click: (() => unknown) | null = null;

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  onClick(callback: () => unknown): this {
    this.click = callback;
    return this;
  }
}

export class Menu {
  items: MenuItem[] = [];

  addItem(callback: (item: MenuItem) => void): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
}

export class Notice {
  static messages: string[] = [];

  constructor(message: string) {
    Notice.messages.push(message);
  }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

export function moment(input?: number | Date) {
  const date = input instanceof Date ? input : new Date(input ?? Date.now());
  return {
    format(pattern: string): string {
      const values: Record<string, string> = {
        YYYY: String(date.getFullYear()),
        MM: String(date.getMonth() + 1).padStart(2, "0"),
        DD: String(date.getDate()).padStart(2, "0"),
        HH: String(date.getHours()).padStart(2, "0"),
        mm: String(date.getMinutes()).padStart(2, "0")
      };
      return pattern.replace(/YYYY|MM|DD|HH|mm/g, (token) => values[token]);
    }
  };
}

export function parseYaml(yaml: string): Record<string, unknown> | null {
  if (yaml.trim().length === 0) {
    return null;
  }

  const result: Record<string, unknown> = {};
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^([^:#][^:]*):(?:\s*(.*))?$/);
    if (match == null) {
      continue;
    }
    const key = match[1].trim();
    const raw = (match[2] ?? "").trim();
    if (raw === "") {
      result[key] = null;
    } else if (raw === "true" || raw === "false") {
      result[key] = raw === "true";
    } else {
      result[key] = raw.replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return result;
}

export function stringifyYaml(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entry]) => {
      if (entry == null) {
        return `${key}:`;
      }
      if (typeof entry === "string" && (entry.includes("[[") || entry.includes(":"))) {
        return `${key}: ${JSON.stringify(entry)}`;
      }
      return `${key}: ${String(entry)}`;
    })
    .join("\n") + "\n";
}
