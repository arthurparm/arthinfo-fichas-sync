# Sincronização de Itens com Múltiplas Ações (D&D 5e v3+ / Runarcana)

A versão mais recente do sistema dnd5e no Foundry VTT aboliu a estrutura plana de ações e danos em favor do sistema de **Activities** (Atividades). Agora, em vez de um item ter `system.damage` ou `system.actionType`, ele possui um dicionário `system.activities` que agrupa todos os possíveis usos de um item.

Isso é especialmente importante para itens complexos como **Marca da Presa** (uma magia que possui uma ação de conjurar, uma ação de mover a marca e um efeito passivo de dano) ou **Armas Versáteis** (que podem atacar com uma ou duas mãos).

Para garantir que a integração Web <-> Foundry funcione perfeitamente e os botões de rolagem não sejam corrompidos ou recriados a cada sincronização, a equipe Web deve seguir este guia.

## 1. Definição da Estrutura de Dados (Data Contract)

O Firebase deve armazenar a propriedade `system.activities` como um **Dicionário (Objeto)**, onde a chave é um ID único da atividade e o valor são os dados da atividade.

### Regras para Geração de IDs:
- O Web App deve gerar um ID único e estável para cada atividade (ex: `16` caracteres alfanuméricos ou chaves semânticas como `act_cast`, `act_damage`).
- **NUNCA** envie `activities` como um Array. O Foundry espera um dicionário.
- Se o Foundry já tiver gerado um ID para aquela atividade (via sync), o Web App deve preservá-lo. (O `sync-manager` no Foundry possui uma camada de fallback para tentar recuperar e parear IDs perdidos, mas o ideal é que a Web armazene o payload completo enviado de volta pelo Foundry).

### Exemplo Completo: Magia "Marca da Presa" (Hunter's Mark)

```json
{
  "name": "Marca da Presa",
  "type": "spell",
  "img": "icons/magic/nature/stealth-hide-eyes-green.webp",
  "system": {
    "level": 1,
    "school": "div",
    "components": {
      "vocal": true,
      "somatic": false,
      "material": false
    },
    "activities": {
      "act_cast": {
        "type": "utility",
        "_id": "act_cast",
        "name": "Conjurar Marca",
        "activation": {
          "type": "bonus",
          "value": 1
        },
        "target": {
          "template": {
            "type": "",
            "size": "",
            "count": ""
          },
          "affects": {
            "type": "creature",
            "count": "1"
          }
        },
        "range": {
          "value": "90",
          "units": "ft"
        }
      },
      "act_move": {
        "type": "utility",
        "_id": "act_move",
        "name": "Mover Marca",
        "activation": {
          "type": "bonus",
          "value": 1
        }
      },
      "act_damage": {
        "type": "damage",
        "_id": "act_damage",
        "name": "Dano Extra",
        "damage": {
          "parts": [
            {
              "number": 1,
              "denomination": 6,
              "types": ["slashing"]
            }
          ]
        }
      }
    }
  }
}
```

## 2. Instruções para a Equipe de Frontend (Web)

Quando vocês estiverem montando o payload do item no Frontend para salvar no Firestore:

1. **Montagem Inicial**: Ao criar um item que possui dano, conjuração ou utilidade, estruture esses efeitos dentro de `system.activities`.
2. **Tipos de Activities**:
   - `attack`: Rolagens de ataque (armas ou magias com ataque).
   - `damage`: Aplicação de dano.
   - `save`: Habilidades que exigem teste de resistência.
   - `heal`: Habilidades de cura.
   - `utility`: Ações gerais (como conjurar uma magia sem ataque/dano/save direto, ou mover uma marca).
3. **Persistência de IDs**: Ao receber o JSON de volta do Firebase (caso tenha sido modificado no Foundry), as chaves do dicionário `activities` e a propriedade interna `_id` podem ter mudado (o Foundry usa IDs de 16 caracteres, como `a1b2c3d4e5f6g7h8`). O Web App **deve preservar** essa estrutura e esses IDs em edições futuras, para não forçar o Foundry a recriar os botões.

## 3. Lidar com Casos de Fallback / Legacy

Se a Aplicação Web atual **ainda não suportar** a criação dessa árvore complexa de `activities` em sua interface, temos duas alternativas arquiteturais:

### Opção A: Sincronização Passiva (Implementada)
O `sync-manager` do Foundry foi atualizado para **não destruir** as `activities` locais.
- Se a Aplicação Web enviar um item sem `system.activities`, o Foundry irá assumir que o Web App é "Legacy" e preservará as atividades locais do Foundry intactas.
- **Prós**: A Web pode focar apenas no "esqueleto" do item (nome, descrição, tipo), deixando que o jogador configure os botões de ação e dano diretamente dentro do Foundry.
- **Contras**: Jogadores que usarem apenas a interface Web não terão as rolagens configuradas automaticamente, dependendo do VTT para jogar.

### Opção B: Itens Separados (Workaround)
Se for crucial rolar tudo pela Web, mas a interface não suportar a criação de `activities` múltiplas em um único item, a Web pode dividir o item em entradas separadas.
Exemplo:
- Item 1: "Marca da Presa (Conjurar)"
- Item 2: "Marca da Presa (Dano)"
- **Prós**: Fácil de implementar na Web se o modelo de dados atual for muito restrito (apenas 1 ação por item).
- **Contras**: Polui o inventário e a aba de magias do personagem, gerando confusão visual e descolamento do padrão do sistema dnd5e, o que pode quebrar a automação de outros módulos do VTT.

> **Recomendação**: Adotem a **Opção A** (Sincronização Passiva) temporariamente enquanto desenvolvem o suporte real a `activities` (Data Contract definido na seção 1) na interface Web. O Foundry foi ajustado para suportar essa transição.
