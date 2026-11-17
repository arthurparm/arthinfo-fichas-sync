// Heartbeat de presença do Foundry (FDD-125): enquanto o mundo está aberto,
// o GM ativo avisa a API a cada 30s que o módulo está vivo; ao fechar a aba
// manda "offline" na hora. Sem isso, a ficha do jogador no site ficaria com HP
// e slots congelados sem aviso quando o mestre fecha o mundo.
//
// Só o GM ativo manda (mesmo critério dos apply-*.js): com dois GMs, um
// "offline" do que sai faria os jogadores verem "Foundry offline" com o mundo
// aberto. No pagehide, quem sai só manda "offline" se não restar outro GM.
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * @param {{ postFoundryPresence: (state: 'online'|'offline', options?: object) => Promise<unknown> }} apiClient
 * @param {{ isActiveGM: () => boolean, otherGmActive: () => boolean,
 *   setInterval?: Function, clearInterval?: Function,
 *   addPageHideListener?: (fn: () => void) => void, onError?: (error: Error) => void }} deps
 */
export function startPresenceHeartbeat(apiClient, deps) {
  const {
    isActiveGM,
    otherGmActive,
    setInterval: setIntervalFn = globalThis.setInterval,
    clearInterval: clearIntervalFn = globalThis.clearInterval,
    addPageHideListener = (fn) => globalThis.addEventListener?.('pagehide', fn),
    onError = (error) => console.warn('Arthinfo Fichas | Falha ao enviar a presença do Foundry:', error?.message ?? error),
  } = deps;

  let stopped = false;
  let timer = null;
  const stop = () => {
    stopped = true;
    if (timer !== null) clearIntervalFn(timer);
  };

  const beat = () => {
    if (stopped || !isActiveGM()) return;
    Promise.resolve(apiClient.postFoundryPresence('online')).catch((error) => {
      // Rota ausente (API sem o deploy) ou chave revogada: insistir só suja o
      // console a cada 30s. O módulo recarrega e tenta de novo.
      if (error?.status === 404 || error?.status === 403 || error?.status === 401) stop();
      onError(error);
    });
  };

  beat();
  timer = setIntervalFn(beat, HEARTBEAT_INTERVAL_MS);

  // keepalive deixa o fetch terminar mesmo com a página fechando.
  addPageHideListener(() => {
    if (stopped || !isActiveGM() || otherGmActive()) return;
    Promise.resolve(apiClient.postFoundryPresence('offline', { keepalive: true })).catch(() => {});
  });

  return { stop };
}
