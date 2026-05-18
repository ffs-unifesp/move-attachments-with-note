# Move Attachments With Note

Obsidian plugin that moves attachments together with a note when the note changes folder.

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

## v1 behavior

- Listens to the Markdown note `rename/move` event.
- Runs only when the note changes folder (rename in same folder is ignored).
- Reads note references from `metadataCache.resolvedLinks`.
- Moves only non-Markdown attachments that were exactly in the note's previous folder.
- Does not move shared attachments referenced by other notes.
- Resolves destination conflicts with numeric suffixes: `-1`, `-2`, ...
- Uses `app.fileManager.renameFile(...)` for safe link updates.

## Logs

Console prefix: `[move-attachments-with-note]`

- `info`: load/unload, shared-attachment skips, per-note summary.
- `warn`: conflict resolved with suffix, broken link.
- `error`: attachment move failure or name-attempt exhaustion.

## v1 limitations

- No settings UI.
- No interactive confirmation before moving.
- No manual link parsing fallback when `resolvedLinks` is empty.

## Test fixtures (optional)

To generate automated QA scenarios:

- `node scripts/generate-fixtures.mjs --vault <vault-path>`
- or set `OBSIDIAN_VAULT_PATH` and run `node scripts/generate-fixtures.mjs`
