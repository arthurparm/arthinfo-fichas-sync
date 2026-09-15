---
name: Bug / melhoria com causa raiz
about: Relate um problema já investigado no código (não só o sintoma)
title: ''
labels: ''
assignees: ''
---

## Sintoma

O que se observa (Ator/mundo real do Foundry quando aplicável — nunca
dado fabricado). Seja específico: qual Ator, qual campo, qual sequência de
ações.

## Causa raiz confirmada no código

Arquivo:linha + trecho relevante (`sync-manager.js`, `data-mapper.js` etc).
Se envolver direção de sincronização, checar `ONE_WAY_FOUNDRY_TO_SITE` em
`data-mapper.js` antes de supor que é bidirecional.

## Sugestão

O que mudar, e por quê essa opção em vez de outra (se houver mais de uma
razoável).
