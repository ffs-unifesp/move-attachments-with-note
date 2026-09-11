# Move Attachments With Note

Obsidian plugin that moves attachments together with a note and creates linked notes from selected files.

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

## Linked notes

- Right-click any vault file, including a Markdown note, and choose **Create note for file** to create one note containing that file's embed.
- Select multiple files and choose **Create note for selected files** to create one note containing all selected embeds.
- Run **Create note for active file** from the Command Palette for any active file. No default hotkey is assigned.
- The actions are available in the native File Explorer and in Notebook Navigator 2.0.0 or newer.
- In the native File Explorer, non-contiguous files can be accumulated with **Add to note selection**. On another file, choose **Create note with selection + this file (N)**. The temporary selection is cleared after successful creation.
- The plugin always creates a new note. Obsidian backlinks reveal every note that references a file.
- No `source` or `sources` property is added or required.
- Single-file notes are created beside the selected file. Multi-file notes are created in the deepest folder shared by the selection.
- Name conflicts receive a numeric suffix and never overwrite an existing note.
- Links are generated through Obsidian's metadata API so duplicate filenames receive an unambiguous path when needed.

### Linked note model

In the plugin settings, **Linked note model** can point to any Markdown note in the vault. Its frontmatter and body are copied without adding or modifying properties.

The model supports `{{title}}`, `{{date}}`, `{{date:FORMAT}}`, `{{time}}`, `{{time:FORMAT}}`, `{{link}}`, `{{links}}`, `{{embed}}`, and `{{embeds}}`. Both embed placeholders accept one or many selected files. If neither is present, the embeds are appended to the end. When no model is selected, the note contains only the embeds. If the selected model is unavailable, creation stops with a notice.

## Logs

Console prefix: `[move-attachments-with-note]`

- `info`: load/unload, linked-note creation, shared-attachment skips, and operation summaries.
- `warn`: resolved name conflicts, broken links, and incompatible Notebook Navigator versions.
- `error`: unavailable models and creation, opening, or attachment-move failures.

## Limitations

- No interactive confirmation before moving.
- No manual link parsing fallback when `resolvedLinks` is empty.
- Enabling Notebook Navigator after this plugin has loaded may require reloading Obsidian before its linked-note action appears.

## Test fixtures (optional)

To generate automated QA scenarios:

- `node scripts/generate-fixtures.mjs --vault <vault-path>`
- or set `OBSIDIAN_VAULT_PATH` and run `node scripts/generate-fixtures.mjs`
