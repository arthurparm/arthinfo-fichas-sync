# Runarcana Sync (módulo Foundry)

Módulo do Foundry VTT que vincula um Ator a uma ficha do Runarcana e mantém
os dois sincronizados (atributos, HP, itens) em tempo real.

A partir desta versão, o módulo **não fala mais direto com o Firestore**.
Ele usa:

- **Firebase Auth** só para login (quem está usando o módulo).
- **[runarcana-api](../runarcana-api)** — o backend próprio — para ler/gravar
  fichas e para receber atualizações ao vivo (via SSE) quando a ficha muda
  pelo site ou por outra instância do Foundry.

## Configuração

Nas configurações do módulo (Configurações do Jogo → Runarcana Firebase Sync):

1. **Firebase API Key / Auth Domain / Project ID / App ID**: os mesmos dados
   do projeto Firebase já usado pelo site, só para login funcionar.
2. **URL do Backend Runarcana**: a URL pública do `runarcana-api` publicado
   (ex: `https://api.seudominio.com`) — veja
   [`runarcana-api/README.md`](../runarcana-api/README.md) para como publicar
   esse backend na Hostinger.
3. **Chave de Sincronização de Compêndio**: o mesmo valor de
   `COMPENDIUM_SYNC_KEY` configurado no backend — só é usado pra sincronizar
   itens de compêndio (não é login).

Depois de configurar, reinicie o mundo (as configurações exigem reload). No
cabeçalho da ficha de um Ator, use o botão **Runarcana Sync** para fazer
login (se ainda não estiver) e vincular o Ator a uma ficha existente.

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
3. Abra **Configurações do Jogo → Runarcana Firebase Sync → Sincronizar
   Compêndio de Itens** (ou rode o macro abaixo, se o botão não aparecer na
   sua versão do Foundry):
   ```js
   game.modules.get('runarcana-sync').api.openCompendiumSync();
   ```
4. Marque os compêndios que quer sincronizar e confirme. A sincronização
   roda em lotes (útil se o compêndio for grande) e mostra o progresso via
   notificação.

Rodar de novo mais tarde atualiza os itens já sincronizados (não duplica).

## Como funciona

- Ao vincular, o módulo guarda o `draftId` como flag do Ator
  (`runarcana-sync.draftId`) e abre um stream ao vivo com o backend.
- Mudanças no Ator/itens no Foundry são enviadas ao backend (debounced, 1s)
  via `PUT`, que por sua vez distribui a mudança para quem mais estiver
  ouvindo aquele `draftId` (por exemplo, o site).
- Mudanças vindas do backend (feitas pelo site, ou por outra sessão do
  Foundry) chegam pelo stream e são aplicadas ao Ator/itens automaticamente,
  incluindo a lógica de preservar `system.activities` (ver
  [`src/sync-manager.js`](src/sync-manager.js)).
