// foundry-module/src/api-client.js
// Cliente HTTP para o backend Runarcana (runarcana-api), substituindo o
// acesso direto ao Firestore. Autenticação continua via Firebase Auth
// (firebaseClient) — só o ID token é usado, para chamar a API.

const TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000; // Firebase ID token expira em ~1h

export class RunarcanaApiClient {
  constructor(firebaseClient, baseUrl) {
    this.firebaseClient = firebaseClient;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    // Identifica esta sessão do módulo pra ignorar o próprio eco quando o
    // stream SSE devolver uma mudança que este mesmo cliente acabou de enviar.
    this.clientId = foundry.utils.randomID();
  }

  async getIdToken() {
    const user = this.firebaseClient.auth?.currentUser;
    if (!user) {
      throw new Error('Usuário não autenticado no Firebase.');
    }
    return user.getIdToken();
  }

  async listDrafts() {
    const token = await this.getIdToken();
    const res = await fetch(`${this.baseUrl}/api/drafts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Falha ao listar fichas (HTTP ${res.status}).`);
    }
    return res.json();
  }

  async getDraft(draftId) {
    const token = await this.getIdToken();
    const res = await fetch(`${this.baseUrl}/api/drafts/${draftId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Falha ao buscar a ficha (HTTP ${res.status}).`);
    }
    return res.json();
  }

  /**
   * Envia um lote de itens de compêndio pro backend. Autenticado por segredo
   * compartilhado (não pelo login do Firebase) — ver COMPENDIUM_SYNC_KEY.
   */
  async putCompendiumItemsBatch(items, syncKey) {
    const res = await fetch(`${this.baseUrl}/api/compendium/items`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Key': syncKey,
      },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      throw new Error(`Falha ao sincronizar itens de compêndio (HTTP ${res.status}).`);
    }
    return res.json();
  }

  async saveDraft(draftId, payload) {
    const token = await this.getIdToken();
    const res = await fetch(`${this.baseUrl}/api/drafts/${draftId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Client-Id': this.clientId,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Falha ao salvar a ficha (HTTP ${res.status}).`);
    }
    return res.json();
  }

  /**
   * Abre o stream ao vivo (SSE) pra um draft. onMessage recebe
   * { draftId, data, sourceClientId }. Retorna um handle com close().
   */
  async openStream(draftId, onMessage, onError) {
    let source = null;
    let refreshTimer = null;
    let closed = false;

    const connect = async () => {
      if (closed) return;
      const token = await this.getIdToken();
      const url = `${this.baseUrl}/api/drafts/${draftId}/stream?token=${encodeURIComponent(token)}`;
      source = new EventSource(url);
      source.onmessage = (event) => {
        try {
          onMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('Runarcana Sync | Erro ao processar evento do stream:', err);
        }
      };
      source.onerror = (event) => {
        onError?.(event);
      };
    };

    await connect();

    // Reabre periodicamente com um token novo, já que o EventSource nativo
    // reconecta sozinho após queda de conexão, mas sempre com o token da URL
    // original — que expira.
    refreshTimer = setInterval(() => {
      source?.close();
      connect();
    }, TOKEN_REFRESH_INTERVAL_MS);

    return {
      close() {
        closed = true;
        clearInterval(refreshTimer);
        source?.close();
      },
    };
  }
}
