// O dnd5e guarda no Ator uma cópia em cache da magia de uma atividade "Cast" de
// feature (ex.: Marca do Caçador via Inimigo Favorito). A cópia nasce quando a
// atividade é usada e leva `flags.dnd5e.cachedFor`; o dnd5e a esconde do
// grimório. Ela é estado do Foundry, não da ficha: espelhá-la no draft criava
// magia extra no site e, na volta, cópias com `cachedFor` obsoleto (FDD-117).
export function isCachedSpell(item) {
  return Boolean(item?.flags?.dnd5e?.cachedFor);
}
