# Runarcana Sync (módulo Foundry)

Módulo do Foundry VTT que vincula um Ator a uma ficha do Runarcana e mantém
os dois sincronizados (atributos, HP, itens) em tempo real.

O mundo Foundry é a mesa do mestre. A identidade desse mundo é a **chave da
mesa** gerada no site (prefixo `ra_mesa_`). Jogadores não entram no Foundry
neste produto — eles jogam no site.

O módulo **não usa Firebase**. Ele fala só com o
[runarcana-api](../runarcana-api) para ler/gravar fichas e para receber
atualizações ao vivo (via SSE).

## Configuração

1. Instale o módulo no Foundry.
2. Nas configurações do módulo (Configurações do Jogo → Runarcana Sync),
   cole a **Chave da mesa**. Ela é gerada no site, na página da mesa.
3. Recarregue o mundo.
4. No cabeçalho da ficha de um Ator, use o botão **Runarcana Sync** para
   vincular o Ator a uma ficha da mesa.

A **URL do Backend Runarcana** já vem como `https://api.runarcana.org`. Só
altere se estiver hospedando o backend por conta própria.

Sem a chave da mesa, o botão avisa para colá-la nas configurações. Não há
login Google nem configuração de Firebase.

## Sincronizar itens de compêndio

O seletor de equipamento do site pode mostrar itens reais do Foundry (com
dano/`activities` corretos) em vez de só o catálogo narrativo da wiki. Pra
isso funcionar:

1. No Foundry, crie (ou use um que já tenha) um compêndio de **Itens** com
   só o que você libera na sua mesa — pode arrastar itens de qualquer
   sourcebook pra dentro dele, não precisa criar do zero.
2. Opcional, mas recomendado pros itens que você quer que apareçam
   corretamente vinculados no site: em cada item, adicione a flag
   `runarcana-sync.catalogKey` com o mesmo id que o item já usa no catálogo
   do site (ex: `adaga`) — pela aba "Detalhes/Flags" do próprio item no
   Foundry, ou via macro:
   ```js
   await item.setFlag('runarcana-sync', 'catalogKey', 'adaga');
   ```
   Sem essa flag, o site ainda tenta casar pelo nome do item
   automaticamente, mas o Foundry não consegue equipar o item real
   automaticamente num Ator vinculado sem essa flag.
3. Cole a **Chave de Sincronização de Compêndio** (`COMPENDIUM_SYNC_KEY`
   do backend). Ela autentica o catálogo compartilhado do site — a chave
   da mesa não escreve nesse catálogo.
4. Abra **Configurações do Jogo → Runarcana Sync → Sincronizar Compêndio
   de Itens** (ou rode o macro abaixo, se o botão não aparecer na sua
   versão do Foundry):
   ```js
   game.modules.get('runarcana-sync').api.openCompendiumSync();
   ```
5. Marque os compêndios que quer sincronizar e confirme. A sincronização
   usa `COMPENDIUM_SYNC_KEY`, roda em lotes (útil se o compêndio for grande) e
   mostra o progresso via notificação.

Rodar de novo mais tarde atualiza os itens já sincronizados (não duplica).

## Como funciona

- Ao vincular, o módulo guarda o `draftId` como flag do Ator
  (`runarcana-sync.draftId`) e abre um stream ao vivo com o backend.
- Mudanças no Ator/itens no Foundry são enviadas ao backend (debounced, 1s)
  via `PUT`, que por sua vez distribui a mudança para quem mais estiver
  ouvindo aquele `draftId` (por exemplo, o site do jogador).
- Mudanças vindas do backend (feitas pelo site, ou por outra sessão do
  Foundry) chegam pelo stream e são aplicadas ao Ator/itens automaticamente,
  incluindo a lógica de preservar `system.activities` (ver
  [`src/sync-manager.js`](src/sync-manager.js)).
- Alguns campos são sincronizados **numa direção só** (ex: `hp.max`, só
  Foundry → site) — ver `ONE_WAY_FOUNDRY_TO_SITE` em `src/data-mapper.js`
  e o `AGENTS.md` deste repo antes de "corrigir" uma sincronização que
  parece faltar num sentido.

## Gaps conhecidos

- **`actor.name` nunca é sincronizado** — renomear o Ator no Foundry não
  atualiza o nome exibido no site (issue #7).
