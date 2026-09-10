// Cliente HTTP para o backend Runarcana (runarcana-api).
// Autentica com a chave da mesa (prefixo ra_mesa_), sem Firebase.

// A API não distingue chave inexistente de revogada — as duas respondem 401
// (ver resolveMesaKeyHash em runarcana-api/src/auth.js). Carregar o status no
// erro deixa a UI dizer 'chave inválida' em vez de mostrar um número solto.
function apiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export class RunarcanaApiClient {
  constructor({ mesaKey, baseUrl, syncKey } = {}) {
    this.mesaKey = typeof mesaKey === 'string' ? mesaKey.trim() : '';
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    // Instalações antigas ainda podem ter COMPENDIUM_SYNC_KEY; enviado só
    // no PUT de compêndio, como X-Sync-Key extra por uma versão.
    this.syncKey = typeof syncKey === 'string' ? syncKey.trim() : '';
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
   * Envia um lote de itens de compêndio pro backend. O catálogo é global:
   * autentica só com COMPENDIUM_SYNC_KEY (X-Sync-Key), não com a chave da mesa.
   */
  async putCompendiumItemsBatch(items) {
    if (!this.syncKey) {
      throw new Error('Chave de sincronização de compêndio não configurada.');
    }
    const res = await fetch(`${this.baseUrl}/api/compendium/items`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Key': this.syncKey,
      },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      throw new Error(`Falha ao sincronizar itens de compêndio (HTTP ${res.status}).`);
    }
    return res.json();
  }

  async saveDraft(draftId, payload) {
    const { assignedUserId: _ignored, ...body } = payload || {};
    const res = await fetch(`${this.baseUrl}/api/drafts/${draftId}`, {
      method: 'PUT',
      headers: this._headers({
        'Content-Type': 'application/json',
        'X-Client-Id': this.clientId,
      }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Falha ao salvar a ficha (HTTP ${res.status}).`);
    }
    return res.json();
  }

  /**
   * Abre o stream ao vivo (SSE) pra um draft. onMessage recebe
   * { draftId, data, sourceClientId }. Retorna um handle com close().
   * A chave vai no query `token` porque EventSource não envia headers.
   */
  async openStream(draftId, onMessage, onError) {
    if (!this.mesaKey) {
      throw new Error('Chave da mesa não configurada.');
    }
    const url = `${this.baseUrl}/api/drafts/${draftId}/stream?token=${encodeURIComponent(this.mesaKey)}`;
    const source = new EventSource(url);
    source.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch (err) {
        console.error('Runarcana Sync | Erro ao processar evento do stream:', err);
      }
    };
    // EventSource nativo reconecta sozinho após queda; a chave da mesa não
    // expira como o ID token do Firebase, então não há timer de refresh.
    source.onerror = (event) => {
      onError?.(event);
    };

    return {
      close() {
        source.close();
      },
    };
  }
}
