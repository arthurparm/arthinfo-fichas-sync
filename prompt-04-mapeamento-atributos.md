# Prompt: Mapeamento Completo de Status e Atributos Bidirecional

**Contexto:**
Estamos construindo um módulo de sincronização (Foundry VTT <-> Firebase) para fichas de personagem usando o sistema D&D 5e. O módulo lê as alterações do Firestore (`onSnapshot`) e as aplica na ficha do Foundry, e vice-versa.

**O Problema Atual:**
O `sync-manager.js` atualmente é um "Proof of Concept" (PoC) e sincroniza apenas os atributos de **HP Máximo**, **HP Atual** e a **Força (Strength)**. Todo o resto da ficha (Destreza, Constituição, Inteligência, Sabedoria, Carisma, Classe de Armadura, Recursos de Classe, Moedas, Slots de Magia, etc.) está sendo ignorado ou não possui um mapeamento de/para o Firebase.
Além disso, as atualizações locais enviadas para o Firebase sobrescrevem nós inteiros ao invés de usar notação de ponto (dot-notation), o que é perigoso em bancos NoSQL.

**O Que Precisa Ser Feito:**

1. **Mapeamento Exaustivo de Propriedades (Data Mapper):**
   - Crie um arquivo de constantes ou um serviço de mapeamento que traduza o modelo de dados do Firebase (ex: `data.attributes.scores.dexterity`) para o *data path* do Foundry (ex: `system.abilities.dex.value`).
   - O mapeamento deve incluir, no mínimo:
     - Os 6 atributos básicos (STR, DEX, CON, INT, WIS, CHA).
     - HP Máximo, Atual e Temporário (`system.attributes.hp`).
     - Classe de Armadura (AC).
     - Moedas (CP, SP, EP, GP, PP).
     - Slots de Magia (`system.spells`).
     - Recursos personalizados (ex: Pontos de Ki, Fúria, etc. -> `system.resources`).

2. **Refatorar a Injeção de Dados (Firebase -> Foundry):**
   - Atualize o método `onSnapshot` no `sync-manager.js` para ler todos esses campos mapeados e construir um único objeto de `update` para passar para a função `actor.update({ ... })`.
   - Garanta cálculos corretos, como somar bônus raciais (`originBonuses`) aos valores base antes de aplicar no Foundry (conforme já era tentado com a Força).

3. **Refatorar o Envio de Dados (Foundry -> Firebase):**
   - No método `handleActorUpdate(actor, changes)`, leia as propriedades alteradas (`changes`) e traduza-as de volta para a estrutura do Firebase.
   - Utilize a notação de ponto (Dot-notation) do Firestore no método `updateDoc` para alterar apenas os campos específicos que mudaram (ex: `updateDoc(docRef, { 'attributes.scores.dexterity': 15 })`), evitando sobrescrever o documento inteiro.

**Entregáveis Esperados:**
- Um objeto ou dicionário de mapeamento claro entre os schemas (Foundry Paths vs Firebase Paths).
- O código atualizado do `sync-manager.js` (especificamente as seções de atualização de Actor) contemplando os novos atributos.
- Lógica robusta usando dot-notation no envio para o Firebase.