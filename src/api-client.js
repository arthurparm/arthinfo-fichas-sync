// Cliente HTTP para o backend do Arthinfo Fichas (arthinfo-fichas-api).
// Autentica com a chave da mesa (prefixo ra_mesa_), sem Firebase.

// A API não distingue chave inexistente de revogada — as duas respondem 401
// (ver resolveMesaKeyHash em arthinfo-fichas-api/src/auth.js). Carregar o status no
// erro deixa a UI dizer 'chave inválida' em vez de mostrar um número solto.
function apiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export class ArthinfoApiClient {
  constructor({ mesaKey, baseUrl } = {}) {
    this.mesaKey = typeof mesaKey === 'string' ? mesaKey.trim() : '';
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    // Identifica esta sessão do módulo pra ignorar o próprio eco quando o
    // stream SSE devolver uma mudança que este mesmo cliente acabou de enviar.
    this.clientId = foundry.utils.randomID();
  }

  _headers(extra = {}) {
    if (!this.mesaKey) {
      throw new Error('Chave da mesa não configurada.');
    }
    return {
      'X-Mesa-Key': this.mesaKey,
      Authorization: `Bearer ${this.mesaKey}`,
      ...extra,
    };
  }

  async listDrafts() {
    const res = await fetch(`${this.baseUrl}/api/drafts`, {
      headers: this._headers(),
    });
    if (!res.ok) {
      throw apiError(`Falha ao listar fichas (HTTP ${res.status}).`, res.status);
    }
    return res.json();
  }

  async getDraft(draftId) {
    const res = await fetch(`${this.baseUrl}/api/drafts/${draftId}`, {
      headers: this._headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Falha ao buscar a ficha (HTTP ${res.status}).`);
    }
    return res.json();
  }

  /**
   * Envia um lote de itens de compêndio pro backend (FDD-16, FDD-74). Sempre
   * com a chave da mesa: os itens ficam no compêndio da mesa, atribuídos ao
   * mestre dela. O módulo não escreve mais no catálogo público (SRD).
   */
  async putCompendiumItemsBatch(items) {
    if (!this.mesaKey) {
      throw new Error('Chave da mesa não configurada.');
    }
    const res = await fetch(`${this.baseUrl}/api/compendium/items`, {
      method: 'PUT',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      throw new Error(`Falha ao sincronizar itens de compêndio (HTTP ${res.status}).`);
    }
    return res.json();
  }

  /** O que a mesa disponibilizou: { total, packs: [{ packId, count }] } (FDD-74). */
  async getMyCompendium() {
    const res = await fetch(`${this.baseUrl}/api/compendium/mine`, {
      headers: this._headers(),
    });
    if (!res.ok) {
      throw apiError(`Falha ao consultar o compêndio da mesa (HTTP ${res.status}).`, res.status);
    }
    return res.json();
  }

  /**
   * Limpa o compêndio da mesa (FDD-74); `packId` limita a um pack. Irreversível:
   * só volta com nova sincronização. Nunca toca no catálogo público.
   */
  async clearMyCompendium(packId) {
    const query = packId ? `?packId=${encodeURIComponent(packId)}` : '';
    const res = await fetch(`${this.baseUrl}/api/compendium/items${query}`, {
      method: 'DELETE',
      headers: this._headers(),
    });
    if (!res.ok) {
      throw apiError(`Falha ao limpar o compêndio da mesa (HTTP ${res.status}).`, res.status);
    }
    return res.json();
  }

  async saveDraft(draftId, payload) {
    const { assignedUserId: _ignored, ...body } = payload || {};
    const ifMatch = typeof body.updatedAt === 'string' ? body.updatedAt.trim() : '';
    const res = await fetch(`${this.baseUrl}/api/drafts/${draftId}`, {
      method: 'PUT',
      headers: this._headers({
        'Content-Type': 'application/json',
        'X-Client-Id': this.clientId,
        ...(ifMatch ? { 'If-Match': ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      let parsed = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      const error = apiError(parsed?.error || 'Ficha foi modificada por outra origem desde a última leitura.', 409);
      error.current = parsed?.current ?? null;
      throw error;
    }
    if (!res.ok) {
      throw apiError(`Falha ao salvar a ficha (HTTP ${res.status}).`, res.status);
    }
    return res.json();
  }

  /**
   * Escrita parcial (FDD-78): manda só o que mudou. `ifMatch` é o updatedAt da
   * última ficha conhecida e é obrigatório, igual ao PUT de ficha existente.
   * Erros carregam `status` e, quando a API manda, `code` (ex.: DRAFT_NOT_FOUND,
   * que separa "ficha apagada" de "API antiga sem PATCH").
   */
  async patchDraft(draftId, patch, ifMatch) {
    const res = await fetch(`${this.baseUrl}/api/drafts/${draftId}`, {
      method: 'PATCH',
      headers: this._headers({
        'Content-Type': 'application/json',
        'X-Client-Id': this.clientId,
        ...(ifMatch ? { 'If-Match': ifMatch } : {}),
      }),
      body: JSON.stringify(patch),
    });
    if (res.ok) return res.json();

    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (res.status === 409) {
      const error = apiError(parsed?.error || 'Ficha foi modificada por outra origem desde a última leitura.', 409);
      error.current = parsed?.current ?? null;
      throw error;
    }
    const error = apiError(parsed?.error || `Falha ao salvar a ficha (HTTP ${res.status}).`, res.status);
    if (parsed?.code) error.code = parsed.code;
    throw error;
  }

  /**
   * Troca a chave da mesa (header) por um ticket opaco de curta duração,
   * preso a esta ficha, pra abrir o stream SSE. A chave nunca vai na URL
   * (FDD-46): EventSource não manda header, e query string cai em access
   * log do host/proxy.
   */
  async requestStreamTicket(draftId) {
    const res = await fetch(`${this.baseUrl}/api/drafts/${draftId}/stream-ticket`, {
      method: 'POST',
      headers: this._headers(),
    });
    if (!res.ok) {
      throw apiError(`Falha ao obter ticket do stream (HTTP ${res.status}).`, res.status);
    }
    const body = await res.json();
    if (!body?.ticket) {
      throw apiError('Resposta do ticket do stream sem ticket.', res.status);
    }
    return body.ticket;
  }

  /**
   * Abre o stream ao vivo (SSE) pra um draft. onMessage recebe
   * { draftId, data, sourceClientId }. Retorna um handle com close().
   *
   * Cada conexão pede um ticket novo antes de abrir o EventSource. Queda
   * curta: o EventSource nativo tenta de novo na mesma URL (ticket ainda
   * vale dentro do TTL). Ticket vencido: o servidor responde 401, o
   * EventSource fecha de vez (não reconecta em erro HTTP) e este método
   * reabre com ticket novo, com backoff. Só para quando close() é chamado.
   */
  async openStream(draftId, onMessage, onError) {
    if (!this.mesaKey) {
      throw new Error('Chave da mesa não configurada.');
    }

    const state = { source: null, timer: null, closed: false, attempts: 0 };

    const scheduleReconnect = () => {
      if (state.closed || state.timer) return;
      const delay = Math.min(30_000, 2000 * 2 ** Math.min(state.attempts, 4));
      state.attempts += 1;
      state.timer = setTimeout(() => {
        state.timer = null;
        void reconnect();
      }, delay);
    };

    const open = (ticket) => {
      const url = `${this.baseUrl}/api/drafts/${draftId}/stream?ticket=${encodeURIComponent(ticket)}`;
      const source = new EventSource(url);
      state.source = source;
      source.onopen = () => {
        state.attempts = 0;
      };
      source.onmessage = (event) => {
        try {
          onMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('Arthinfo Fichas | Erro ao processar evento do stream:', err);
        }
      };
      // event: roll é evento SSE nomeado — onmessage só recebe o default
      // (atualização de ficha). Sem este listener a rolagem da ficha nunca
      // chega no chat do Foundry.
      source.addEventListener('roll', (event) => {
        try {
          onMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('Arthinfo Fichas | Erro ao processar rolagem do stream:', err);
        }
      });
      // event: item-equip é outro evento SSE nomeado, mesmo motivo do 'roll'
      // acima — equipar/desequipar pelo site não é uma atualização de ficha
      // (onmessage padrão), é um comando pro Foundry aplicar no Ator.
      source.addEventListener('item-equip', (event) => {
        try {
          onMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('Arthinfo Fichas | Erro ao processar comando de equipar item do stream:', err);
        }
      });
      // event: item-cast — mesmo motivo do item-equip acima: comando de
      // conjurar magia, não atualização de ficha.
      source.addEventListener('item-cast', (event) => {
        try {
          onMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('Arthinfo Fichas | Erro ao processar comando de conjurar magia do stream:', err);
        }
      });
      // event: rest / spell-slot — comandos do site (descanso, ajuste de slot).
      for (const eventName of ['rest', 'spell-slot']) {
        source.addEventListener(eventName, (event) => {
          try {
            onMessage(JSON.parse(event.data));
          } catch (err) {
            console.error(`Arthinfo Fichas | Erro ao processar comando ${eventName} do stream:`, err);
          }
        });
      }
      source.onerror = (event) => {
        onError?.(event);
        if (source.readyState === EventSource.CLOSED && state.source === source && !state.closed) {
          source.close();
          state.source = null;
          scheduleReconnect();
        }
      };
    };

    const reconnect = async () => {
      if (state.closed) return;
      let ticket;
      try {
        ticket = await this.requestStreamTicket(draftId);
      } catch (error) {
        if (state.closed) return;
        onError?.(error);
        // 403/404: sem acesso ou ficha apagada — insistir não muda nada.
        if (error?.status === 403 || error?.status === 404) return;
        scheduleReconnect();
        return;
      }
      if (!state.closed) open(ticket);
    };

    // A primeira conexão propaga erro pro chamador (ex: chave inválida) em
    // vez de agendar retry silencioso — startListening mostra a notificação.
    open(await this.requestStreamTicket(draftId));

    return {
      close() {
        state.closed = true;
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        state.source?.close();
        state.source = null;
      },
    };
  }
}
