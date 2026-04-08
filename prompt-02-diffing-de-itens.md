# Prompt: Otimização da Comparação de Itens (Diffing)

**Contexto:**
Estamos desenvolvendo um módulo de integração entre o Foundry VTT (D&D 5e) e o Firebase Firestore. O sistema sincroniza um array de objetos JSON representando o inventário, magias e habilidades (Itens) do personagem.

**O Problema Atual:**
No arquivo `sync-manager.js`, o método responsável por comparar os itens vindos do Firebase com os itens locais do Foundry utiliza uma comparação de string estrita e ingênua:
```javascript
const lItemJson = JSON.stringify(lItem.toObject());
const rItemJson = JSON.stringify(rItem);
if (lItemJson !== rItemJson) { ... }
```
Essa abordagem é fatal no ecossistema do Foundry. O Foundry injeta automaticamente metadados e propriedades de estado nos itens (como `_stats`, `sort`, `flags`, `folder`, `ownership`). Como o banco de dados do Firebase armazena apenas os dados estruturais (nome, dano, descrição, etc.), a comparação entre o objeto local e o remoto **sempre falhará** (sempre serão diferentes). Isso resulta em um loop infinito de criação/deleção/atualização de itens a cada ciclo de sincronização, esgotando a cota de leitura/escrita do Firebase rapidamente e travando o cliente.

**O Que Precisa Ser Feito:**

1. **Criar um Algoritmo de Diffing Inteligente (Deep Compare):**
   - Escreva uma função de comparação que ignore campos internos do Foundry que não devem ser sincronizados (ex: `_stats`, `sort`, `flags.core`, etc.).
   - A comparação deve focar apenas nos campos "core" do item (ex: `name`, `type`, `system.description`, `system.damage`, `system.quantity`, `system.equipped`, `system.activities`).
   - Você pode usar uma abordagem de extrair apenas as chaves relevantes antes do `JSON.stringify` ou implementar uma biblioteca leve/função recursiva de `isEqual` com lista de ignorados.

2. **Otimizar as Atualizações em Lote (Batch Updates):**
   - Ao invés de atualizar o item inteiro no Foundry caso haja uma diferença mínima, garanta que o payload enviado para `actor.updateEmbeddedDocuments("Item", toUpdate)` contenha apenas o ID do item e os campos que realmente mudaram (se possível), ou o objeto limpo, evitando sobrescrever *flags* locais de outros módulos.

3. **Garantir a Integridade na Escrita (Foundry -> Firebase):**
   - No método `handleItemUpdate`, antes de enviar o array de itens para o Firebase via `updateDoc`, limpe os objetos de `item.toObject()` removendo as chaves temporárias/metadados do Foundry para manter o banco de dados enxuto.

**Entregáveis Esperados:**
- Uma função auxiliar `compareItems(localItem, remoteItem)` que retorne um booleano confiável.
- Refatoração do bloco de *Deep Sync* no `sync-manager.js` para utilizar a nova função.
- Um snippet mostrando como "limpar" o objeto do item antes de enviá-lo para o Firebase.