# Prompt: Solução de Sincronização em Tempo Real (Anti-Echo e Race Conditions)

**Contexto:**
Estamos desenvolvendo um módulo para Foundry VTT (baseado no sistema D&D 5e) que sincroniza fichas de personagens em tempo real com um banco de dados Firebase Firestore. Atualmente, o módulo possui um problema arquitetural crítico de "Race Conditions" e "Echo" (Loop Infinito) durante a sincronização bidirecional (Foundry <-> Firebase).

**O Problema Atual:**
No arquivo `sync-manager.js`, o controle de bloqueio de sincronização (`this.isApplyingRemote`) é implementado como um booleano global e simples. Isso causa dois problemas graves:
1. **Bloqueio Global (Anti-Echo Falho):** Quando o `onSnapshot` do Firebase é disparado para atualizar um Ator localmente, a flag `this.isApplyingRemote = true` é ativada para impedir que o hook do Foundry (`updateActor` ou `updateItem`) envie os dados de volta para o Firebase (Echo). No entanto, por ser global, se o Mestre ou outro jogador modificar *qualquer outro* personagem no mundo simultaneamente, essas alterações não serão enviadas para o Firebase.
2. **Race Conditions:** Se múltiplas atualizações chegarem rapidamente do Firebase, ou se houver alterações rápidas na UI do Foundry, a flag booleana não consegue lidar com o estado assíncrono corretamente, resultando em perda de dados ou reenvio indesejado.

**O Que Precisa Ser Feito:**

1. **Refatorar o Controle de Bloqueio (Locking Mechanism):**
   - Substitua o booleano global `this.isApplyingRemote` por um mapa de bloqueios específico por documento (`Map` ou `Set`).
   - O controle deve rastrear individualmente qual Ator (`actor.id`) está atualmente recebendo dados do Firebase.
   - Exemplo de estrutura: `this.activeSyncs = new Set();` onde você adiciona o ID do ator antes da atualização local e o remove no final.

2. **Implementar Debounce nas Atualizações Locais (Foundry -> Firebase):**
   - Adicione um mecanismo de *debounce* (ex: 1000ms a 2000ms) nos métodos `handleActorUpdate` e `handleItemUpdate`.
   - Isso evitará que interações rápidas na ficha (ex: clicar várias vezes no HP, arrastar itens rapidamente, ou macros que disparam múltiplos updates em sequência) gerem dezenas de escritas (`updateDoc`) no Firestore, economizando cotas e evitando conflitos de versão.

3. **Garantir a Atomicidade das Operações:**
   - Assegure-se de que as funções assíncronas no `onSnapshot` não sobreponham as requisições de *update* locais que já estavam na fila do debounce.

**Entregáveis Esperados:**
- Um código refatorado para o arquivo `sync-manager.js` (comentado e limpo).
- O mecanismo de trava (Lock) deve ser por instância/documento e não global.
- Uma função utilitária de *debounce* integrada aos métodos de envio.
- Explicação de como a nova abordagem previne o "Echo" sem bloquear o resto do mundo.
