// Painel de status do mestre (FDD-75): API alcançável, streams, última
// sincronização, erro recente, Atores vinculados e quem da mesa está online no
// site. Só leitura: não muda vínculo nem escreve nada na API.
//
// renderStatusPanelHtml é puro (testável sem Foundry); a classe da janela é
// criada sob demanda porque foundry.applications só existe dentro do Foundry.

const POLL_INTERVAL_MS = 15_000;
const RENDER_DEBOUNCE_MS = 250;

const STREAM_LABELS = {
  connecting: 'Conectando',
  open: 'Conectado',
  reconnecting: 'Reconectando',
  closed: 'Parado',
};

const STATE_LABELS = {
  synced: 'Sincronizado',
  pending: 'Pendente',
  conflict: 'Conflito',
  error: 'Erro',
  missing: 'Ficha apagada',
};

const ROLE_LABELS = { gm: 'mestre', player: 'jogador' };

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "agora", "há 42 s", "há 3 min", "há 2 h" — ou "nunca". */
export function formatAgo(at, now) {
  if (!at) return 'nunca';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return 'agora';
  if (seconds < 60) return `há ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  return `há ${Math.round(minutes / 60)} h`;
}

function clock(at) {
  if (!at) return '';
  const date = new Date(at);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function personLabel(person) {
  return person.nickname || person.displayName || `Usuário ${String(person.userId).slice(0, 8)}`;
}

/** draftId → nomes de quem está com aquela ficha aberta. */
export function onlineByDraft(presence) {
  const map = new Map();
  for (const person of presence?.online ?? []) {
    for (const draftId of person.draftIds ?? []) {
      if (!map.has(draftId)) map.set(draftId, []);
      map.get(draftId).push(personLabel(person));
    }
  }
  return map;
}

/**
 * Primeira mesa conhecida a partir das fichas já carregadas (lastKnownDraft)
 * ou da lista de fichas da chave. A chave da mesa não diz o id sozinha.
 */
export function findMesaId(drafts) {
  for (const draft of drafts ?? []) {
    if (draft?.mesaId) return draft.mesaId;
  }
  return null;
}

/**
 * @param {{
 *   configured: boolean,
 *   now: number,
 *   health: null | { ok: boolean, version?: string|null, db?: string|null, error?: string|null, checkedAt?: number },
 *   status: { lastSyncAt: number|null, lastError: null|{ name: string, message: string, at: number }, actors: Array<object> },
 *   presence: null | { online: Array<object>, scope?: string },
 *   presenceError: string|null,
 *   loading?: boolean,
 * }} model
 */
export function renderStatusPanelHtml(model) {
  const { configured, now, health, status, presence, presenceError, loading } = model;
  if (!configured) {
    return `<section class="afs-status"><p>A chave da mesa não está configurada. Cole a chave nas configurações do módulo e recarregue o mundo.</p></section>`;
  }

  const actors = status?.actors ?? [];
  const openStreams = actors.filter((actor) => actor.stream === 'open').length;
  const reconnecting = actors.filter((actor) => actor.stream === 'reconnecting').length;

  let apiLine;
  if (!health) {
    apiLine = '<span class="afs-muted">verificando…</span>';
  } else if (health.ok) {
    apiLine = `<span class="afs-ok">no ar</span>${health.version ? ` <span class="afs-muted">(versão ${escapeHtml(health.version)})</span>` : ''}`;
  } else if (health.db === 'indisponivel') {
    apiLine = '<span class="afs-bad">no ar, mas sem banco de dados</span>';
  } else {
    apiLine = `<span class="afs-bad">fora do ar</span> <span class="afs-muted">(${escapeHtml(health.error || 'sem resposta')})</span>`;
  }

  // Reinício da API derruba todos os streams; o EventSource reconecta sozinho.
  const restartHint =
    reconnecting > 0 || (health && !health.ok)
      ? `<p class="afs-hint">A conexão caiu (a API pode ter reiniciado). Os Atores reconectam sozinhos, em até 30 s depois que a API voltar. Edição feita no Foundry enquanto a API estava fora aparece como Erro e não é reenviada sozinha: depois que a API voltar, refaça a edição (no campo do Ator ou no item, conforme o que falhou).</p>`
      : '';

  const lastError = status?.lastError
    ? `<span class="afs-bad">${escapeHtml(status.lastError.name)}: ${escapeHtml(status.lastError.message)}</span> <span class="afs-muted">(${escapeHtml(clock(status.lastError.at))})</span>`
    : '<span class="afs-muted">nenhum</span>';

  const byDraft = onlineByDraft(presence);

  let presenceBlock;
  if (presenceError) {
    presenceBlock = `<p class="afs-muted">${escapeHtml(presenceError)}</p>`;
  } else if (!presence) {
    presenceBlock = '<p class="afs-muted">verificando…</p>';
  } else if (!presence.online?.length) {
    presenceBlock = '<p class="afs-muted">Ninguém da mesa está com uma ficha aberta no site agora.</p>';
  } else {
    const items = presence.online
      .map((person) => {
        const where = [];
        const linkedNames = (person.draftIds ?? []).map((draftId) => {
          const actor = actors.find((entry) => entry.draftId === draftId);
          return actor ? escapeHtml(actor.name) : 'ficha sem Ator vinculado';
        });
        if (linkedNames.length) where.push(`ficha de ${linkedNames.join(', ')}`);
        if (person.watchingMesa) where.push('página da mesa');
        const role = ROLE_LABELS[person.role] ? ` <span class="afs-muted">(${ROLE_LABELS[person.role]})</span>` : '';
        return `<li><strong>${escapeHtml(personLabel(person))}</strong>${role}: ${where.join('; ')}</li>`;
      })
      .join('');
    presenceBlock = `<ul class="afs-online">${items}</ul>`;
  }

  let actorsBlock;
  if (!actors.length) {
    actorsBlock = '<p class="afs-muted">Nenhum Ator vinculado a uma ficha. Vincule pelo botão Arthinfo no cabeçalho da ficha do Ator.</p>';
  } else {
    const rows = actors
      .map((actor) => {
        const online = byDraft.get(actor.draftId);
        const error = actor.lastError ? `<div class="afs-row-error">${escapeHtml(actor.lastError.message)}</div>` : '';
        return `<tr>
          <td><strong>${escapeHtml(actor.name)}</strong>${error}</td>
          <td><span class="afs-pill afs-stream-${escapeHtml(actor.stream)}">${escapeHtml(STREAM_LABELS[actor.stream] ?? actor.stream)}</span></td>
          <td><span class="afs-pill afs-state-${escapeHtml(actor.state)}">${escapeHtml(STATE_LABELS[actor.state] ?? actor.state)}</span></td>
          <td>${escapeHtml(formatAgo(actor.lastSyncAt, now))}</td>
          <td>${online ? escapeHtml(online.join(', ')) : '<span class="afs-muted">—</span>'}</td>
        </tr>`;
      })
      .join('');
    actorsBlock = `<table class="afs-actors">
      <thead><tr><th>Ator</th><th>Conexão</th><th>Estado</th><th>Última sync</th><th>No site agora</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  return `<section class="afs-status">
    <style>${PANEL_STYLES}</style>
    <dl class="afs-summary">
      <dt>API</dt><dd>${apiLine}</dd>
      <dt>Conexões ao vivo</dt><dd>${openStreams} de ${actors.length} abertas${reconnecting ? `, <span class="afs-warn">${reconnecting} reconectando</span>` : ''}</dd>
      <dt>Última sincronização</dt><dd>${status?.lastSyncAt ? `${escapeHtml(clock(status.lastSyncAt))} <span class="afs-muted">(${escapeHtml(formatAgo(status.lastSyncAt, now))})</span>` : '<span class="afs-muted">nenhuma nesta sessão</span>'}</dd>
      <dt>Erro recente</dt><dd>${lastError}</dd>
    </dl>
    ${restartHint}
    <h3>Online na mesa (site)</h3>
    ${presenceBlock}
    <h3>Atores vinculados</h3>
    ${actorsBlock}
    <footer class="afs-footer">
      <span class="afs-muted">${health?.checkedAt ? `Verificado ${escapeHtml(formatAgo(health.checkedAt, now))}; atualiza a cada ${POLL_INTERVAL_MS / 1000} s.` : ''}</span>
      <button type="button" data-action="refresh" ${loading ? 'disabled' : ''}><i class="fas fa-rotate"></i> Atualizar agora</button>
    </footer>
  </section>`;
}

const PANEL_STYLES = `
  .afs-status { display: flex; flex-direction: column; gap: 8px; }
  .afs-status h3 { margin: 8px 0 2px; border-bottom: 1px solid var(--color-border-light-tertiary, #7a7971); }
  .afs-summary { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
  .afs-summary dt { font-weight: 700; }
  .afs-summary dd { margin: 0; }
  .afs-muted { opacity: 0.7; }
  .afs-ok { color: #2e7d32; font-weight: 700; }
  .afs-warn { color: #b26a00; font-weight: 700; }
  .afs-bad { color: #c62828; font-weight: 700; }
  .afs-hint { margin: 0; padding: 6px 8px; border-left: 3px solid #b26a00; background: rgba(178, 106, 0, 0.08); }
  .afs-online { margin: 0; padding-left: 18px; }
  .afs-actors { width: 100%; border-collapse: collapse; }
  .afs-actors th, .afs-actors td { text-align: left; padding: 4px 6px; vertical-align: top; }
  .afs-actors tbody tr { border-top: 1px solid var(--color-border-light-tertiary, #7a7971); }
  .afs-row-error { font-size: 0.85em; color: #c62828; }
  .afs-pill { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 0.85em; white-space: nowrap; border: 1px solid currentColor; }
  .afs-stream-open, .afs-state-synced { color: #2e7d32; }
  .afs-stream-connecting, .afs-stream-reconnecting, .afs-state-pending { color: #b26a00; }
  .afs-stream-closed, .afs-state-conflict, .afs-state-error, .afs-state-missing { color: #c62828; }
  .afs-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; }
  .afs-footer button { flex: 0 0 auto; width: auto; }
`;

let PanelClass = null;

/**
 * Classe da janela (ApplicationV2). Recebe { apiClient, syncManager } por
 * getter para sempre ler o estado atual (o SyncManager só existe com chave).
 */
export function getStatusPanelClass(getDeps) {
  if (PanelClass) return PanelClass;
  const { ApplicationV2 } = foundry.applications.api;

  PanelClass = class ArthinfoStatusPanel extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: 'arthinfo-fichas-status',
      classes: ['arthinfo-fichas-status'],
      tag: 'section',
      window: { title: 'Arthinfo Fichas: status da sincronização', icon: 'fas fa-signal', resizable: true },
      position: { width: 720, height: 'auto' },
      actions: {
        refresh: function () {
          void this.poll();
        },
      },
    };

    constructor(options = {}) {
      super(options);
      this.health = null;
      this.presence = null;
      this.presenceError = null;
      this.mesaId = null;
      this.loading = false;
      this._timer = null;
      this._renderTimer = null;
      this._unsubscribe = null;
    }

    async _renderHTML() {
      const { apiClient, syncManager } = getDeps();
      return renderStatusPanelHtml({
        configured: Boolean(apiClient && syncManager),
        now: Date.now(),
        health: this.health,
        status: syncManager?.status.snapshot() ?? { lastSyncAt: null, lastError: null, actors: [] },
        presence: this.presence,
        presenceError: this.presenceError,
        loading: this.loading,
      });
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
    }

    _scheduleRender() {
      if (this._renderTimer || this._closed) return;
      this._renderTimer = setTimeout(() => {
        this._renderTimer = null;
        if (this.rendered) void this.render();
      }, RENDER_DEBOUNCE_MS);
    }

    async _onFirstRender(context, options) {
      await super._onFirstRender?.(context, options);
      this._closed = false;
      const { syncManager } = getDeps();
      if (syncManager) this._unsubscribe = syncManager.status.onChange(() => this._scheduleRender());
      this._timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
      void this.poll();
    }

    async _resolveMesaId(apiClient, syncManager) {
      if (this.mesaId) return this.mesaId;
      this.mesaId = findMesaId([...(syncManager?.lastKnownDraft.values() ?? [])]);
      if (!this.mesaId) this.mesaId = findMesaId(await apiClient.listDrafts());
      return this.mesaId;
    }

    async poll() {
      const { apiClient, syncManager } = getDeps();
      if (!apiClient || !syncManager || this.loading) return;
      this.loading = true;
      this._scheduleRender();
      try {
        this.health = { ...(await apiClient.getHealth()), checkedAt: Date.now() };
        if (!this.health.ok) {
          this.presenceError = 'Sem a API no ar, não dá para saber quem está online.';
          this.presence = null;
          return;
        }
        let mesaId;
        try {
          mesaId = await this._resolveMesaId(apiClient, syncManager);
        } catch (error) {
          this.presenceError = `Não foi possível descobrir a mesa: ${error?.message || 'erro desconhecido'}`;
          return;
        }
        if (!mesaId) {
          this.presence = null;
          this.presenceError = 'Nenhuma ficha desta mesa no site ainda, então não há quem mostrar online.';
          return;
        }
        try {
          this.presence = await apiClient.getMesaPresence(mesaId);
          this.presenceError = null;
        } catch (error) {
          this.presence = null;
          this.presenceError =
            error?.status === 404
              ? 'A API não achou a mesa, ou ainda não tem a consulta de presença (atualize a API).'
              : error?.status === 401 || error?.status === 403
                ? 'A chave da mesa foi recusada (revogada ou de outra mesa).'
                : `Não foi possível consultar quem está online: ${error?.message || 'erro desconhecido'}`;
        }
      } finally {
        this.loading = false;
        this._scheduleRender();
      }
    }

    async _onClose(options) {
      this._closed = true;
      clearInterval(this._timer);
      clearTimeout(this._renderTimer);
      this._timer = null;
      this._renderTimer = null;
      this._unsubscribe?.();
      this._unsubscribe = null;
      await super._onClose?.(options);
    }
  };
  return PanelClass;
}
