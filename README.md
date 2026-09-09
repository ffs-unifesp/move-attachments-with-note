# Move Attachments With Note

Obsidian plugin that moves attachments together with a note and creates companion notes for non-Markdown files.

## Manual installation

1. Build the plugin:
   - `npm install`
   - `npm run build`
2. Copy files to:
   - `<VAULT>/.obsidian/plugins/move-attachments-with-note/`
3. Required files:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. In Obsidian, enable the plugin under Community Plugins.

## Attachment move behavior

- Listens to the Markdown note `rename/move` event.
- Runs only when the note changes folder (rename in same folder is ignored).
- Reads note references from `metadataCache.resolvedLinks`.
- Moves only non-Markdown attachments that were exactly in the note's previous folder.
- Does not move shared attachments referenced by other notes.
- Resolves destination conflicts with numeric suffixes: `-1`, `-2`, ...
- Uses `app.fileManager.renameFile(...)` for safe link updates.

## Companion notes

A companion note is a Markdown note associated with any non-Markdown file through its `source` property:

```md
---
source: "[[article.pdf]]"
---
![[article.pdf]]
```

- Right-click one non-Markdown file in the File Explorer and choose **Open or create companion note**.
- Select multiple File Explorer items and choose **Create companion notes**. Markdown files and folders are ignored, and a summary is shown when processing finishes.
- Select two or more non-Markdown files and choose **Create collection note from selected files** to create one Markdown note containing all selected sources.
- Run **Open or create companion note for active file** from the Command Palette to use the active non-Markdown file. No default hotkey is assigned.
- When Notebook Navigator 2.0.0 or newer is installed and enabled, the same single-file and multi-file actions appear in its file menus after Obsidian loads.
- Companion notes are created next to their source files and are never allowed to overwrite an existing note.
- Existing companions are discovered from `source`, even after the note is renamed or moved.
- If multiple notes declare the same source, the plugin reports the ambiguity instead of choosing one.
- Links are generated through Obsidian's metadata API so duplicate filenames receive an unambiguous path when needed.

### Companion note model

In the plugin settings, **Companion note model** can point to any Markdown note in the vault. New companion notes copy that note's properties and body, while the plugin always replaces `source` with the canonical link to the source file.

The model supports `{{title}}`, `{{date}}`, `{{date:FORMAT}}`, `{{time}}`, `{{time:FORMAT}}`, `{{source}}`, and `{{embed}}`. If `{{embed}}` is absent, the source embed is appended to the end. When no model is selected, the built-in minimal content is used. If the selected model is unavailable, creation stops with a notice.

### Collection notes

A collection note is created in the deepest folder shared by all selected files and receives a collision-safe name such as `2026-09-09 17.30 Collection.md`. Its `sources` property contains one wikilink per selected file. All files are embedded in the body.

The optional **Collection note model** supports the standard date, time, and title placeholders plus `{{sources}}` and `{{embeds}}`. If `{{embeds}}` is absent, all embeds are appended to the end. Any singular `source` property inherited from the model is removed so the collection is not mistaken for a one-to-one companion note.

## Logs

Console prefix: `[move-attachments-with-note]`

- `info`: load/unload, companion creation/discovery, shared-attachment skips, and operation summaries.
- `warn`: resolved name conflicts, broken links, and incompatible Notebook Navigator versions.
- `error`: ambiguous companions, unavailable metadata, and creation, opening, or attachment-move failures.

## Limitations

- No interactive confirmation before moving.
- No manual link parsing fallback when `resolvedLinks` is empty.
- Companion discovery requires Obsidian metadata to be ready; it does not maintain a separate index or parse frontmatter manually.
- Enabling Notebook Navigator after this plugin has loaded may require reloading Obsidian before its companion menu actions appear.

## Test fixtures (optional)

To generate automated QA scenarios:

- `node scripts/generate-fixtures.mjs --vault <vault-path>`
- or set `OBSIDIAN_VAULT_PATH` and run `node scripts/generate-fixtures.mjs`
