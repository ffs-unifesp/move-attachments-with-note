# Move Attachments With Note

Plugin para Obsidian que move anexos junto com a nota quando a nota muda de pasta.

## Instalação (manual)

1. Compile o plugin:
   - `npm install`
   - `npm run build`
2. Copie os arquivos para:
   - `<VAULT>/.obsidian/plugins/move-attachments-with-note/`
3. Arquivos necessários:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. No Obsidian, habilite o plugin em Community Plugins.

## Comportamento da v1

- Escuta evento de `rename/move` de nota Markdown.
- Só atua quando a nota muda de pasta (renomear na mesma pasta é ignorado).
- Lê anexos referenciados pela nota no `metadataCache.resolvedLinks`.
- Move apenas anexos não-Markdown que estavam exatamente na mesma pasta antiga da nota.
- Não move anexos compartilhados por outras notas.
- Em conflito no destino, cria sufixo incremental: `-1`, `-2`, ...
- Move usando `app.fileManager.renameFile(...)` para atualização segura de links.

## Logs

Prefixo no console: `[move-attachments-with-note]`

- `info`: carregamento, descarregamento, anexos compartilhados ignorados, resumo por nota.
- `warn`: conflito de nome resolvido por sufixo, link quebrado.
- `error`: falha ao mover anexo ou esgotamento de tentativas de nome.

## Limitações da v1

- Sem interface de configuração.
- Sem confirmação interativa antes de mover.
- Sem parser manual de links quando `resolvedLinks` está vazio.
