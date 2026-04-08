# Prompt: Sincronização de Itens com Múltiplas Ações (Sistema de Atividades do D&D 5e)

**Contexto:**
Estamos desenvolvendo uma integração bidirecional (Foundry VTT <-> Firebase) para fichas de RPG (sistema Runarcana / D&D 5e). Uma das maiores complexidades desse sistema é lidar com habilidades, feitiços ou itens que possuem **múltiplos perfis de uso** (ex: *Marca da Presa*, que possui uma Ação Bônus para conjurar, outra Ação Bônus para mover a marca, e um Dano Extra passivo; ou *Armas Versáteis*).

**O Problema Atual:**
Modelagens de banco de dados tradicionais costumam tratar "Ação" ou "Dano" como propriedades planas dentro de um item (ex: `item.system.damage`). No entanto, a versão moderna do sistema D&D 5e no Foundry VTT aboliu essa estrutura plana em favor do sistema de **Activities (Atividades)**. Se não padronizarmos a estrutura de dados entre a Aplicação Web (Firebase) e o Foundry, os itens com múltiplas ações serão sincronizados incorretamente, perdendo botões de rolagem ou corrompendo a ficha no VTT.

**O Que Precisa Ser Feito:**

1. **Definição de Estrutura de Dados (Data Contract):**
   - Crie um guia/esquema JSON detalhado de como um Item (arma, magia, habilidade) deve ser armazenado no Firebase utilizando a estrutura de `system.activities` exigida pelo Foundry dnd5e v3+.
   - O esquema deve suportar que um único item contenha um dicionário de atividades (ex: `cast`, `damage`, `utility`, `save`).

2. **Implementar Suporte no Sincronizador (Foundry side):**
   - Garanta que o `sync-manager.js` não altere ou destrua a estrutura `activities` ao ler do Firebase e inserir no Foundry.
   - Como as *Activities* geram IDs únicos internamente, o algoritmo de sincronização deve preservar os IDs das atividades locais ou aceitar os IDs gerados pela Web, para evitar recriar os botões de ação a cada sincronização.

3. **Lidar com Casos de Fallback / Legacy:**
   - Se a Aplicação Web ainda não suportar a criação de `activities` aninhadas de forma complexa, crie uma proposta arquitetural alternativa (ex: enviar itens separados como "Marca da Presa (Conjurar)" e "Marca da Presa (Dano)") e explique os prós e contras dessa abordagem para a equipe Web.

**Entregáveis Esperados:**
- Um JSON de exemplo detalhado de uma magia complexa (como *Marca da Presa* ou *Mísseis Mágicos*) modelada com o sistema de `activities`.
- Código ou instruções claras para a equipe de Frontend (Web) sobre como eles devem montar o payload do item antes de salvá-lo no Firestore.
- Se necessário, ajustes no `sync-manager.js` para garantir que o array/dicionário de atividades seja mesclado corretamente sem gerar duplicatas no Foundry.