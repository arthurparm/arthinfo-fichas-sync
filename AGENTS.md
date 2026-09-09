# runarcana-sync

Módulo do Foundry VTT que vincula um Ator a uma ficha do **Arthinfo
Fichas** e mantém os dois sincronizados em tempo real (atributos, HP,
itens, condições, efeitos). JS puro, roda dentro do Foundry. Nome da
pasta, `module.json` e flags (`runarcana-sync`) são legado (Runarcana) —
não “corrigir” sem pedido. Ecossistema e regras de trabalho:
`../AGENTS.md` e `../.agents/` (direção de sync e `lastKnownDraft`).

## Comandos

- `npm run dev` — Vite em modo watch.
- `npm run build` — gera `dist/module.js` (versão publicada no
  `module.json`/Foundry).
- `npm run test` — Vitest (`*.spec.js` ao lado de cada arquivo fonte).
  Isso não substitui verificação in-world no Foundry.

## Estrutura

- `src/sync-manager.js` — o coração do módulo. `handleActorUpdate` escuta
  mudança no Ator do Foundry, parte da última cópia conhecida do draft
  (`lastKnownDraft`, nunca faz PUT sem essa base) e sobrescreve só os
  campos mapeados antes de mandar pro backend. Quais campos entram no
  sync se conferem aqui — não assumir `actor.name` nem qualquer outro
  campo sem ler o mapper.
- `src/data-mapper.js` — `ATTR_MAP` (de/para Foundry ↔ site) e
  `ONE_WAY_FOUNDRY_TO_SITE` (campos que só vão de Foundry pro site, nunca
  voltam — ver comentário no arquivo sobre o motivo de `hp.max` estar
  aqui). Ao adicionar um campo novo ao mapa, decidir explicitamente a
  direção — não assumir bidirecional por padrão.
- `src/draft-selector.js` — diálogo de vincular um Ator a um draft
  existente (`actor.setFlag('runarcana-sync', 'draftId', ...)` — esse flag
  no Ator é a fonte da verdade de "qual draft está vinculado", não o
  draft em si).
- `src/api-client.js` — chamadas HTTP pro `runarcana-api`.
- `src/compendium-sync.js` / `compendium-sync-dialog.js` — sincronização
  de itens do compêndio (usa `COMPENDIUM_SYNC_KEY`, não token de usuário).
- `src/index.js` — hooks do Foundry (`Hooks.on(...)`), ponto de entrada.

Login Firebase é no site, não neste módulo. Não reintroduzir cliente
Firebase aqui sem pedido explícito.

## Issues

Antes de tratar “campo não sincroniza” como bug, ler `data-mapper.js` /
`sync-manager.js` e `gh issue list` neste repo. Remote é público: push na
branch default só com confirmação.
