// Estado do sync por Ator, para o painel do mestre (FDD-75). Só memória da
// sessão do Foundry: nada aqui vai para a API nem para flags.
//
// stream: estado do SSE da ficha.
//   connecting   → pedindo ticket / abrindo
//   open         → conectado
//   reconnecting → caiu (ex.: API reiniciou) e está tentando de novo
//   closed       → parado (sem acesso, ficha apagada, ou falha ao abrir)
// state: estado da escrita Foundry → site (derivado, ver _deriveState).
//   synced   → nada pendente
//   pending  → edição no Ator ainda não enviada (debounce/fila)
//   conflict → 409 que não se resolveu nem com a nova tentativa
//   error    → falhou ao carregar ou salvar (ver lastError)
//   missing  → a ficha foi apagada no site
//
// Pendência e falha são guardadas por tipo de save ('actor' = campos do Ator,
// 'items' = itens), porque os dois overlays escrevem partes diferentes da
// ficha: o save do Ator dar certo não envia os itens que falharam antes.

export const STREAM_STATES = ['connecting', 'open', 'reconnecting', 'closed'];
export const SYNC_STATES = ['synced', 'pending', 'conflict', 'error', 'missing'];
export const SAVE_KINDS = ['actor', 'items'];

function errorMessage(error) {
  if (!error) return 'erro desconhecido';
  if (typeof error === 'string') return error;
  return error.message || (error.status ? `HTTP ${error.status}` : 'erro desconhecido');
}

export class SyncStatusTracker {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.actors = new Map();
    this.lastSyncAt = null;
    this.lastError = null;
    this.listeners = new Set();
    // Sequência das edições locais: um save só limpa o "pendente" se nenhuma
    // edição chegou depois de ele começar a ler o Ator (ver checkpoint()).
    this.seq = 0;
  }

  /** Marca o início de um save; passar o valor para markSynced. */
  checkpoint() {
    this.seq += 1;
    return this.seq;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit() {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Arthinfo Fichas | Erro no ouvinte do painel de status:', error);
      }
    }
  }

  _entry(actorId) {
    return this.actors.get(actorId) ?? null;
  }

  _kinds(kind) {
    return kind ? [kind] : SAVE_KINDS;
  }

  // missing > conflito/erro (algum tipo falhou, ou erro geral) > pendente > ok.
  _deriveState(entry) {
    if (entry.missing) return 'missing';
    const failures = [...Object.values(entry.failures)];
    if (entry.generalError) failures.push(entry.generalError);
    if (failures.length) return failures.some((failure) => failure.conflict) ? 'conflict' : 'error';
    if (Object.values(entry.pendingSeq).some((seq) => seq > 0)) return 'pending';
    return 'synced';
  }

  _currentError(entry) {
    const failures = [...Object.values(entry.failures)];
    if (entry.generalError) failures.push(entry.generalError);
    if (entry.missing) failures.push(entry.missing);
    if (!failures.length) return null;
    const latest = failures.reduce((a, b) => (b.at >= a.at ? b : a));
    return { message: latest.message, at: latest.at };
  }

  track(actor, draftId) {
    const previous = this._entry(actor.id);
    this.actors.set(actor.id, {
      actor,
      actorId: actor.id,
      draftId,
      stream: 'connecting',
      lastSyncAt: previous?.lastSyncAt ?? null,
      pendingSeq: previous?.pendingSeq ?? {},
      failures: {},
      generalError: null,
      missing: null,
    });
    this._emit();
  }

  forget(actorId) {
    if (this.actors.delete(actorId)) this._emit();
  }

  setStream(actorId, stream) {
    const entry = this._entry(actorId);
    if (!entry || entry.stream === stream) return;
    entry.stream = stream;
    this._emit();
  }

  markPending(actorId, kind) {
    const entry = this._entry(actorId);
    if (!entry) return;
    this.seq += 1;
    for (const k of this._kinds(kind)) entry.pendingSeq[k] = this.seq;
    this._emit();
  }

  /**
   * Save (ou carga) concluído. Com `checkpoint`, uma edição feita depois dele
   * mantém o "pendente": ela ainda está na fila e não foi neste envio. Sem
   * `kind`, vale para os dois tipos (carga inicial).
   */
  markSynced(actorId, checkpoint = null, kind = null) {
    const entry = this._entry(actorId);
    if (!entry) return;
    const at = this.now();
    entry.lastSyncAt = at;
    this.lastSyncAt = at;
    for (const k of this._kinds(kind)) {
      if (checkpoint === null || (entry.pendingSeq[k] ?? 0) <= checkpoint) {
        entry.pendingSeq[k] = 0;
        delete entry.failures[k];
      }
    }
    if (!kind) entry.generalError = null;
    this._emit();
  }

  /** Ficha do site aplicada no Ator: atualiza a hora; não mexe em pendência nem falha local. */
  markRemoteApplied(actorId) {
    const entry = this._entry(actorId);
    if (!entry) return;
    const at = this.now();
    entry.lastSyncAt = at;
    this.lastSyncAt = at;
    this._emit();
  }

  _fail(actorId, kind, error, { conflict = false } = {}) {
    const entry = this._entry(actorId);
    if (!entry) return;
    const failure = { message: errorMessage(error), at: this.now(), conflict };
    if (kind) entry.failures[kind] = failure;
    else entry.generalError = failure;
    this.lastError = { actorId, name: entry.actor?.name ?? actorId, message: failure.message, at: failure.at };
    this._emit();
  }

  markConflict(actorId, error, kind = null) {
    this._fail(actorId, kind, error, { conflict: true });
  }

  /** Sem `kind`: erro que não é de um save (carga, stream, chave recusada). */
  markError(actorId, error, kind = null) {
    this._fail(actorId, kind, error);
  }

  markMissing(actorId) {
    const entry = this._entry(actorId);
    if (!entry) return;
    entry.missing = { message: 'A ficha foi apagada no site.', at: this.now() };
    this.lastError = { actorId, name: entry.actor?.name ?? actorId, message: entry.missing.message, at: entry.missing.at };
    this._emit();
  }

  snapshot() {
    return {
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError ? { ...this.lastError } : null,
      actors: [...this.actors.values()]
        .map((entry) => ({
          actorId: entry.actorId,
          // Nome lido na hora: renomear o Ator no Foundry aparece no painel.
          name: entry.actor?.name ?? entry.actorId,
          draftId: entry.draftId,
          stream: entry.stream,
          state: this._deriveState(entry),
          lastSyncAt: entry.lastSyncAt,
          lastError: this._currentError(entry),
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    };
  }
}
