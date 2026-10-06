//#region \0rolldown/runtime.js
var e = (e, t, n) => () => {
	if (n) throw n[0];
	try {
		return e && (t = e(e = 0)), t;
	} catch (e) {
		throw n = [e], e;
	}
}, t = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports);
//#endregion
//#region src/api-client.js
function n(e, t) {
	let n = Error(e);
	return n.status = t, n;
}
var r, i = e((() => {
	r = class {
		constructor({ mesaKey: e, baseUrl: t, syncKey: n } = {}) {
			this.mesaKey = typeof e == "string" ? e.trim() : "", this.baseUrl = String(t || "").replace(/\/+$/, ""), this.syncKey = typeof n == "string" ? n.trim() : "", this.clientId = foundry.utils.randomID();
		}
		_headers(e = {}) {
			if (!this.mesaKey) throw Error("Chave da mesa não configurada.");
			return {
				"X-Mesa-Key": this.mesaKey,
				Authorization: `Bearer ${this.mesaKey}`,
				...e
			};
		}
		async listDrafts() {
			let e = await fetch(`${this.baseUrl}/api/drafts`, { headers: this._headers() });
			if (!e.ok) throw n(`Falha ao listar fichas (HTTP ${e.status}).`, e.status);
			return e.json();
		}
		async getDraft(e) {
			let t = await fetch(`${this.baseUrl}/api/drafts/${e}`, { headers: this._headers() });
			if (t.status === 404) return null;
			if (!t.ok) throw Error(`Falha ao buscar a ficha (HTTP ${t.status}).`);
			return t.json();
		}
		async putCompendiumItemsBatch(e) {
			if (!this.syncKey && !this.mesaKey) throw Error("Configure a chave de sincronização de compêndio ou a chave da mesa.");
			let t = { "Content-Type": "application/json" };
			this.mesaKey && (t["X-Mesa-Key"] = this.mesaKey), this.syncKey && (t["X-Sync-Key"] = this.syncKey);
			let n = await fetch(`${this.baseUrl}/api/compendium/items`, {
				method: "PUT",
				headers: t,
				body: JSON.stringify({ items: e })
			});
			if (!n.ok) throw Error(`Falha ao sincronizar itens de compêndio (HTTP ${n.status}).`);
			return n.json();
		}
		async saveDraft(e, t) {
			let { assignedUserId: r, ...i } = t || {}, a = typeof i.updatedAt == "string" ? i.updatedAt.trim() : "", o = await fetch(`${this.baseUrl}/api/drafts/${e}`, {
				method: "PUT",
				headers: this._headers({
					"Content-Type": "application/json",
					"X-Client-Id": this.clientId,
					...a ? { "If-Match": a } : {}
				}),
				body: JSON.stringify(i)
			});
			if (o.status === 409) {
				let e = null;
				try {
					e = await o.json();
				} catch {
					e = null;
				}
				let t = n(e?.error || "Ficha foi modificada por outra origem desde a última leitura.", 409);
				throw t.current = e?.current ?? null, t;
			}
			if (!o.ok) throw n(`Falha ao salvar a ficha (HTTP ${o.status}).`, o.status);
			return o.json();
		}
		async patchDraft(e, t, r) {
			let i = await fetch(`${this.baseUrl}/api/drafts/${e}`, {
				method: "PATCH",
				headers: this._headers({
					"Content-Type": "application/json",
					"X-Client-Id": this.clientId,
					...r ? { "If-Match": r } : {}
				}),
				body: JSON.stringify(t)
			});
			if (i.ok) return i.json();
			let a = null;
			try {
				a = await i.json();
			} catch {
				a = null;
			}
			if (i.status === 409) {
				let e = n(a?.error || "Ficha foi modificada por outra origem desde a última leitura.", 409);
				throw e.current = a?.current ?? null, e;
			}
			let o = n(a?.error || `Falha ao salvar a ficha (HTTP ${i.status}).`, i.status);
			throw a?.code && (o.code = a.code), o;
		}
		async requestStreamTicket(e) {
			let t = await fetch(`${this.baseUrl}/api/drafts/${e}/stream-ticket`, {
				method: "POST",
				headers: this._headers()
			});
			if (!t.ok) throw n(`Falha ao obter ticket do stream (HTTP ${t.status}).`, t.status);
			let r = await t.json();
			if (!r?.ticket) throw n("Resposta do ticket do stream sem ticket.", t.status);
			return r.ticket;
		}
		async openStream(e, t, n) {
			if (!this.mesaKey) throw Error("Chave da mesa não configurada.");
			let r = {
				source: null,
				timer: null,
				closed: !1,
				attempts: 0
			}, i = () => {
				if (r.closed || r.timer) return;
				let e = Math.min(3e4, 2e3 * 2 ** Math.min(r.attempts, 4));
				r.attempts += 1, r.timer = setTimeout(() => {
					r.timer = null, o();
				}, e);
			}, a = (a) => {
				let o = `${this.baseUrl}/api/drafts/${e}/stream?ticket=${encodeURIComponent(a)}`, s = new EventSource(o);
				r.source = s, s.onopen = () => {
					r.attempts = 0;
				}, s.onmessage = (e) => {
					try {
						t(JSON.parse(e.data));
					} catch (e) {
						console.error("Arthinfo Fichas | Erro ao processar evento do stream:", e);
					}
				}, s.addEventListener("roll", (e) => {
					try {
						t(JSON.parse(e.data));
					} catch (e) {
						console.error("Arthinfo Fichas | Erro ao processar rolagem do stream:", e);
					}
				}), s.addEventListener("item-equip", (e) => {
					try {
						t(JSON.parse(e.data));
					} catch (e) {
						console.error("Arthinfo Fichas | Erro ao processar comando de equipar item do stream:", e);
					}
				}), s.addEventListener("item-cast", (e) => {
					try {
						t(JSON.parse(e.data));
					} catch (e) {
						console.error("Arthinfo Fichas | Erro ao processar comando de conjurar magia do stream:", e);
					}
				});
				for (let e of ["rest", "spell-slot"]) s.addEventListener(e, (n) => {
					try {
						t(JSON.parse(n.data));
					} catch (t) {
						console.error(`Arthinfo Fichas | Erro ao processar comando ${e} do stream:`, t);
					}
				});
				s.onerror = (e) => {
					n?.(e), s.readyState === EventSource.CLOSED && r.source === s && !r.closed && (s.close(), r.source = null, i());
				};
			}, o = async () => {
				if (r.closed) return;
				let t;
				try {
					t = await this.requestStreamTicket(e);
				} catch (e) {
					if (r.closed || (n?.(e), e?.status === 403 || e?.status === 404)) return;
					i();
					return;
				}
				r.closed || a(t);
			};
			return a(await this.requestStreamTicket(e)), { close() {
				r.closed = !0, r.timer &&= (clearTimeout(r.timer), null), r.source?.close(), r.source = null;
			} };
		}
	};
}));
//#endregion
//#region src/module-id.js
function a(e, t) {
	return e?.getFlag?.(s, t) ?? e?.flags?.[c]?.[t];
}
async function o(e, t) {
	await e.unsetFlag(s, t), e.flags?.["runarcana-sync"]?.[t] !== void 0 && await e.update({ [`flags.${c}.-=${t}`]: null });
}
var s, c, l = e((() => {
	s = "arthinfo-fichas-sync", c = "runarcana-sync";
}));
//#endregion
//#region src/draft-selector.js
function u(e) {
	return String(e ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function d(e) {
	return `${e?.concept?.name || e?.title || "Sem Nome"} (${e?.classBuild?.classId || "Sem Classe"})${e?.assignedUserId ? " — atribuída a um jogador" : ""}`;
}
function f(e, t) {
	let n = /* @__PURE__ */ new Set();
	for (let r of e ?? []) {
		if (r.id === t) continue;
		let e = a(r, "draftId");
		e && n.add(e);
	}
	return n;
}
function p(e) {
	return e?.status === 401 ? "<p>Chave da mesa inválida ou revogada.</p>\n      <p>Gere uma nova na página da mesa no site e cole em Configurações do módulo &rsaquo; Chave da mesa.</p>" : `<p>Erro ao carregar fichas: ${u(e?.message || "Erro desconhecido.")}</p>
    <p>Verifique se a chave da mesa e a URL do backend estão configuradas corretamente nas configurações do módulo e
    se o servidor (arthinfo-fichas-api) está no ar.</p>`;
}
var m, h = e((() => {
	l(), m = class {
		constructor(e, t, n) {
			this.apiClient = e, this.actor = t, this.syncManager = n;
		}
		async render(e = !0) {
			let { DialogV2: t } = foundry.applications.api;
			try {
				let e = await this.apiClient.listDrafts(), n = f(game.actors, this.actor.id), r = "<form><div class=\"form-group\"><label>Ficha:</label><select name=\"draftId\">";
				return e.length === 0 ? r += "<option value=\"\">Nenhuma ficha encontrada</option>" : e.forEach((e) => {
					let t = n.has(e.id), i = t ? `${d(e)} (vinculado a outro Ator)` : d(e);
					r += `<option value="${u(e.id)}" ${t ? "disabled" : ""}>${u(i)}</option>`;
				}), r += "</select></div></form>", t.wait({
					window: { title: "Vincular Ficha Arthinfo" },
					content: r,
					buttons: [{
						action: "link",
						label: "Vincular",
						icon: "fas fa-link",
						callback: async (e, t, n) => {
							let r = n.element.querySelector("[name=\"draftId\"]"), i = r.value, a = r.selectedOptions?.[0];
							i && !a?.disabled && (await this.actor.setFlag(s, "draftId", i), ui.notifications.info(`Actor vinculado à ficha ${i}`), this.syncManager && this.syncManager.startListening(this.actor));
						}
					}]
				});
			} catch (e) {
				return t.prompt({
					window: { title: "Erro" },
					content: p(e),
					ok: { label: "Fechar" }
				});
			}
		}
	};
}));
//#endregion
//#region src/compendium-sync.js
function g() {
	return game.packs.filter((e) => e.documentName === "Item");
}
async function _(e) {
	let t = new Set((e || []).filter(Boolean)), n = /* @__PURE__ */ new Map();
	if (t.size === 0) return n;
	for (let e of g()) {
		let r;
		try {
			r = await e.getIndex({ fields: [`flags.${s}.catalogKey`, `flags.${c}.catalogKey`] });
		} catch (t) {
			console.warn(`Arthinfo Fichas | Falha ao ler índice do compêndio ${e.collection}:`, t);
			continue;
		}
		for (let i of r) {
			let r = i.flags?.["arthinfo-fichas-sync"]?.catalogKey ?? i.flags?.["runarcana-sync"]?.catalogKey;
			r && t.has(r) && !n.has(r) && n.set(r, {
				packId: e.collection,
				foundryId: i._id
			});
		}
	}
	return n;
}
function v(e) {
	if (!e) return e;
	try {
		return new URL(e, window.location.origin).href;
	} catch {
		return e;
	}
}
function ee(e, t) {
	let n = [];
	for (let r = 0; r < e.length; r += t) n.push(e.slice(r, r + t));
	return n;
}
async function te(e, t, n) {
	let r = [], i = [];
	for (let e of t) {
		let t = game.packs.get(e);
		if (!t) continue;
		let n = (await t.getDocuments()).map((t) => ({
			packId: e,
			foundryId: t.id,
			name: t.name,
			img: v(t.img),
			itemType: t.type,
			catalogKey: a(t, "catalogKey") ?? null,
			system: t.toObject().system
		}));
		r.push(...n), i.push({
			packId: e,
			label: t.metadata.label,
			count: n.length
		});
	}
	let o = ee(r, y);
	for (let t = 0; t < o.length; t++) await e.putCompendiumItemsBatch(o[t]), n?.(t + 1, o.length);
	return {
		totalSynced: r.length,
		packSummaries: i
	};
}
var y, b = e((() => {
	l(), y = 50;
}));
//#endregion
//#region src/compendium-sync-dialog.js
function ne(e) {
	return !!e?.querySelector?.("input[name=\"ackPublish\"]:checked");
}
function x(e) {
	return String(e ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function re(e) {
	let t = e.metadata ?? {};
	if (t.packageType === "module") {
		let e = typeof game < "u" ? game.modules?.get(t.packageName) : void 0;
		return {
			id: `module:${t.packageName}`,
			label: e?.title || t.packageName || "Módulo"
		};
	}
	if (t.packageType === "system") {
		let e = (typeof game < "u" ? game.system?.title : void 0) || t.packageName || t.system || "Sistema", n = /\(SRD\)/i.test(t.label ?? "");
		return {
			id: `system:${t.packageName || t.system}${n ? ":srd" : ""}`,
			label: n ? `${e} (Legacy)` : e
		};
	}
	return {
		id: "world",
		label: "Compêndios do mundo"
	};
}
function ie(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) {
		let e = re(n);
		t.has(e.id) || t.set(e.id, {
			id: e.id,
			label: e.label,
			packs: []
		}), t.get(e.id).packs.push(n);
	}
	return Array.from(t.values()).map((e) => ({
		...e,
		packs: e.packs.slice().sort((e, t) => (e.metadata.label ?? "").localeCompare(t.metadata.label ?? "", "pt-BR"))
	})).sort((e, t) => e.label.localeCompare(t.label, "pt-BR"));
}
function ae(e) {
	let t = e.querySelector("input[data-action=\"toggleGroup\"]");
	if (!t) return;
	let n = Array.from(e.querySelectorAll("input[data-action=\"toggleItem\"]")), r = n.filter((e) => e.checked).length;
	t.checked = r > 0 && r === n.length, t.indeterminate = r > 0 && r < n.length;
}
function oe(e, t) {
	let n = t.closest("[data-pack-group]");
	if (!n) return;
	let r = t.checked;
	n.querySelectorAll("input[data-action=\"toggleItem\"]").forEach((e) => {
		e.disabled = !r, e.checked = r;
	}), t.indeterminate = !1;
}
function se(e, t) {
	let n = t.closest("[data-pack-group]");
	n && ae(n);
}
var S, C, w, ce = e((() => {
	b(), l(), S = "compendiumSyncSelection", C = "\n  .rs-compendium-sync .rs-group-toggle {\n    position: relative;\n    width: 16px;\n    height: 16px;\n    flex: 0 0 auto;\n    border: 1px solid var(--color-border-light-tertiary, #7a7971);\n    border-radius: 3px;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n  }\n  .rs-compendium-sync .rs-group-toggle input[type=\"checkbox\"] {\n    position: absolute;\n    inset: 0;\n    margin: 0;\n    opacity: 0;\n    cursor: pointer;\n  }\n  .rs-compendium-sync .rs-group-toggle::after {\n    content: \"\";\n    font-weight: 900;\n    font-size: 12px;\n    line-height: 1;\n    color: #1b1a17;\n    pointer-events: none;\n  }\n  .rs-compendium-sync .rs-group-toggle:has(input:checked),\n  .rs-compendium-sync .rs-group-toggle:has(input:indeterminate) {\n    background: #c9a227;\n  }\n  .rs-compendium-sync .rs-group-toggle:has(input:checked)::after {\n    content: \"\\2713\";\n  }\n  .rs-compendium-sync .rs-group-toggle:has(input:indeterminate)::after {\n    content: \"\\2212\";\n  }\n", w = class {
		constructor(e) {
			this.apiClient = e;
		}
		async render() {
			let { DialogV2: e } = foundry.applications.api, t = g();
			if (t.length === 0) return e.prompt({
				window: { title: "Sincronizar Compêndio de Itens" },
				content: "<p>Nenhum compêndio do tipo Item foi encontrado neste mundo.</p>",
				ok: { label: "Fechar" }
			});
			let n = [];
			try {
				n = game.settings.get("arthinfo-fichas-sync", S) ?? [];
			} catch {
				n = [];
			}
			let r = new Set(n), i = ie(t), a = `
      <style>${C}</style>
      <form class="rs-compendium-sync">
        <p>Escolha os compêndios de itens a sincronizar (ex: um compêndio próprio,
        curado com os itens liberados na sua mesa):</p>
        <div style="max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; column-count: 1; column-width: auto;">`;
			for (let e of i) {
				let t = e.packs.filter((e) => r.has(e.collection)).length, n = t > 0 && t === e.packs.length;
				a += `
          <fieldset data-pack-group style="border:0;margin:0 0 12px 0;padding:0;break-inside:avoid;-webkit-column-break-inside:avoid;">
            <label style="display:flex;align-items:center;gap:6px;font-weight:700;text-transform:uppercase;font-size:0.85em;letter-spacing:0.02em;border-bottom:1px solid var(--color-border-light-tertiary, #7a7971);padding-bottom:4px;margin-bottom:6px;cursor:pointer;">
              <span class="rs-group-toggle">
                <input type="checkbox" data-action="toggleGroup" ${n ? "checked" : ""} />
              </span>
              ${x(e.label)}
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;">`;
				for (let t of e.packs) {
					let e = r.has(t.collection) ? "checked" : "";
					a += `
              <label style="display:block;margin:2px 0;">
                <input type="checkbox" name="pack" data-action="toggleItem" value="${x(t.collection)}" ${e} />
                ${x(t.metadata.label)}
              </label>`;
				}
				a += "\n            </div>\n          </fieldset>";
			}
			a += "\n        </div>\n        <label style=\"display:flex;align-items:flex-start;gap:8px;margin-top:12px;font-size:0.9em;line-height:1.4;\">\n          <input type=\"checkbox\" name=\"ackPublish\" style=\"margin-top:3px;\" />\n          <span>Entendo que o conteúdo enviado pode aparecer no site da mesa e, se eu usar a chave de catálogo compartilhado, no Compêndio público. Jogadores da mesa só consomem a ficha; não republicam o pack.</span>\n        </label>\n      </form>";
			let o = this.apiClient;
			return e.wait({
				window: { title: "Sincronizar Compêndio de Itens" },
				content: a,
				actions: {
					toggleGroup: oe,
					toggleItem: se
				},
				buttons: [{
					action: "sync",
					label: "Sincronizar Selecionados",
					icon: "fas fa-sync",
					default: !0,
					callback: async (e, t, n) => {
						let r = n.element.querySelectorAll("input[name=\"pack\"]:checked"), i = Array.from(r).map((e) => e.value);
						if (i.length === 0) {
							ui.notifications.warn("Arthinfo Fichas: selecione ao menos um compêndio.");
							return;
						}
						if (!ne(n.element)) {
							ui.notifications.warn("Arthinfo Fichas: confirme que o conteúdo pode aparecer no site antes de sincronizar.");
							return;
						}
						await game.settings.set(s, S, i);
						try {
							let e = await te(o, i, (e, t) => {
								ui.notifications.info(`Arthinfo Fichas: sincronizando lote ${e} de ${t}...`);
							});
							ui.notifications.info(`Arthinfo Fichas: ${e.totalSynced} itens sincronizados de ${e.packSummaries.length} compêndio(s).`);
						} catch (e) {
							console.error("Arthinfo Fichas | Erro ao sincronizar compêndio:", e), ui.notifications.error(`Arthinfo Fichas: erro ao sincronizar compêndio: ${e.message}`);
						}
					}
				}, {
					action: "cancel",
					label: "Cancelar"
				}]
			});
		}
	};
}));
//#endregion
//#region src/draft-link.js
function le(e, t) {
	return (typeof e?.getFlag == "function" ? a(e, "draftId") : void 0) || (t?.flags?.["arthinfo-fichas-sync"]?.draftId ?? t?.flags?.["runarcana-sync"]?.draftId);
}
function ue(e, t, n) {
	return t ? f(e, n).has(t) : !1;
}
function de(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e ?? []) {
		let e = a(n, "draftId");
		e && (t.has(e) || t.set(e, []), t.get(e).push(n));
	}
	return [...t.values()].filter((e) => e.length > 1);
}
function fe(e) {
	return [...e].sort((e, t) => (e._stats?.createdTime ?? 0) - (t._stats?.createdTime ?? 0));
}
function pe() {
	return {
		[`flags.${s}.-=draftId`]: null,
		[`flags.${c}.-=draftId`]: null
	};
}
var me = e((() => {
	h(), l();
}));
//#endregion
//#region src/data-mapper.js
function he(e) {
	return e ? Array.isArray(e) ? e.filter(Boolean).map(String) : e instanceof Set ? [...e].filter(Boolean).map(String) : typeof e == "object" ? Object.keys(e).filter((t) => e[t]) : [] : [];
}
function T(e) {
	if (!e) return [];
	let t = he(e.value ?? (Array.isArray(e) || e instanceof Set ? e : null)), n = typeof e.custom == "string" ? e.custom.split(/[;,\n]/).map((e) => e.trim()).filter(Boolean) : [];
	return [.../* @__PURE__ */ new Set([...t, ...n])];
}
function E(e) {
	try {
		let t = globalThis.dnd5e?.documents?.Trait?.keyLabel?.(e, { trait: "tool" });
		return typeof t == "string" && t ? t : e;
	} catch {
		return e;
	}
}
function ge(e) {
	let t = e.system?.tools ?? {}, n = /* @__PURE__ */ new Set(), r = [];
	for (let [e, i] of Object.entries(t)) {
		if ((i?.value ?? 0) <= 0) continue;
		n.add(e);
		let t = typeof i?.total == "number" ? i.total : void 0;
		r.push(t === void 0 ? { label: E(e) } : {
			label: E(e),
			modifier: t
		});
	}
	for (let t of T(e.system?.traits?.toolProf)) n.has(t) || (n.add(t), r.push({ label: E(t) }));
	return r;
}
function _e(e) {
	let t = e.system?.attributes?.senses ?? {}, n = t.ranges ?? {}, r = {};
	for (let e of we) {
		let i = n[e] ?? t[e];
		typeof i == "number" && i > 0 && (r[e] = i);
	}
	return t.units && (r.units = t.units), typeof t.special == "string" && t.special.trim() && (r.special = t.special.trim()), r;
}
function ve(e) {
	let t = e.system?.traits ?? {};
	return {
		senses: _e(e),
		damageResistances: T(t.dr),
		damageImmunities: T(t.di),
		damageVulnerabilities: T(t.dv),
		armorProficiencies: T(t.armorProf),
		weaponProficiencies: T(t.weaponProf),
		toolProficiencies: ge(e),
		conditionImmunities: T(t.ci),
		languages: T(t.languages)
	};
}
function D(e) {
	return e ? Array.isArray(e) ? e : typeof e.length == "number" || typeof e[Symbol.iterator] == "function" ? [...e] : typeof e == "object" ? Object.values(e) : [] : [];
}
function O(e, t) {
	let n = D(e.itemTypes?.[t]);
	return n.length > 0 ? n : D(e.items?.contents ?? e.items).filter((e) => e?.type === t);
}
function k(e) {
	return e ? typeof e == "string" ? e : e.name || "" : "";
}
function ye(e) {
	let t = e?.system?.hd?.denomination ?? e?.system?.hitDice ?? e?.system?.hitDie;
	if (typeof t == "number" && t > 0) return `d${t}`;
	if (typeof t == "string" && t.trim()) {
		let e = t.trim();
		return e.startsWith("d") ? e : `d${e}`;
	}
	return "";
}
function be(e) {
	let t = e.system?.attributes?.hd;
	if (!t) return {
		value: 0,
		max: 0
	};
	let n = Number(t.value), r = Number(t.max);
	return {
		value: Number.isFinite(n) ? n : 0,
		max: Number.isFinite(r) ? r : 0
	};
}
function A(e) {
	let t = O(e, "class"), n = D(e.classes), r = /* @__PURE__ */ new Set(), i = [];
	for (let e of [...t, ...n]) {
		let t = e?.id || e?.name;
		t && !r.has(t) && (r.add(t), i.push(e));
	}
	let a = O(e, "race")[0], o = O(e, "background")[0], s = O(e, "subclass")[0], c = be(e), l = e.system?.traits?.size || "";
	return {
		classes: i.map((e) => ({
			name: e.name || "",
			identifier: e.system?.identifier || e.identifier || "",
			levels: Number(e.system?.levels) || 0,
			hitDie: ye(e)
		})),
		subclassName: s?.name || "",
		raceName: a?.name || k(e.system?.details?.race),
		backgroundName: o?.name || k(e.system?.details?.background),
		size: l,
		hitDie: i.map(ye).find(Boolean) || "",
		hitDiceValue: c.value,
		hitDiceMax: c.max
	};
}
function j(e) {
	return typeof e == "string" ? e.trim() : "";
}
function xe(e) {
	let t = e.system?.details ?? {}, n = {}, r = {}, i = j(t.appearance), a = j(t.age), o = j(t.gender), s = j(t.height), c = j(t.weight), l = j(t.eyes), u = j(t.hair), d = j(t.skin);
	i && (n.appearance = i), a && (n.age = a), o && (n.sex = o), s && (n.height = s), c && (n.weight = c), l && (n.eyes = l), u && (n.hair = u), d && (n.skin = d);
	let f = j(t.alignment), p = j(t.faith), m = j(t.ideal), h = j(t.bond), g = j(t.flaw), _ = j(t.trait), v = j(t.biography?.value);
	return f && (r.alignment = f), p && (r.faith = p), m && (r.ideal = m), h && (r.bond = h), g && (r.flaw = g), _ && (r.trait = _), v && (r.backstory = v), {
		identity: n,
		description: r
	};
}
function Se(e) {
	return e >= 2 ? "expertise" : e >= 1 || e >= .5 && "half";
}
function Ce(e) {
	return e === "expertise" ? 2 : e === "half" ? .5 : +!!e;
}
var M, N, P, we, F, I, L = e((() => {
	M = {
		name: "concept.name",
		"system.abilities.str.value": "attributes.scores.strength",
		"system.abilities.dex.value": "attributes.scores.dexterity",
		"system.abilities.con.value": "attributes.scores.constitution",
		"system.abilities.int.value": "attributes.scores.intelligence",
		"system.abilities.wis.value": "attributes.scores.wisdom",
		"system.abilities.cha.value": "attributes.scores.charisma",
		"system.attributes.hp.max": "derivedStats.maxHp",
		"system.attributes.hp.value": "derivedStats.currentHp",
		"system.attributes.hp.temp": "derivedStats.tempHp",
		"system.attributes.ac.value": "derivedStats.ac",
		"system.attributes.init.total": "derivedStats.initiative",
		"system.currency.cp": "currency.cp",
		"system.currency.sp": "currency.sp",
		"system.currency.ep": "currency.ep",
		"system.currency.gp": "currency.gp",
		"system.currency.pp": "currency.pp",
		"system.spells.spell1.value": "spellSlots.level1.current",
		"system.spells.spell1.max": "spellSlots.level1.max",
		"system.spells.spell2.value": "spellSlots.level2.current",
		"system.spells.spell2.max": "spellSlots.level2.max",
		"system.spells.spell3.value": "spellSlots.level3.current",
		"system.spells.spell3.max": "spellSlots.level3.max",
		"system.spells.spell4.value": "spellSlots.level4.current",
		"system.spells.spell4.max": "spellSlots.level4.max",
		"system.spells.spell5.value": "spellSlots.level5.current",
		"system.spells.spell5.max": "spellSlots.level5.max",
		"system.spells.spell6.value": "spellSlots.level6.current",
		"system.spells.spell6.max": "spellSlots.level6.max",
		"system.spells.spell7.value": "spellSlots.level7.current",
		"system.spells.spell7.max": "spellSlots.level7.max",
		"system.spells.spell8.value": "spellSlots.level8.current",
		"system.spells.spell8.max": "spellSlots.level8.max",
		"system.spells.spell9.value": "spellSlots.level9.current",
		"system.spells.spell9.max": "spellSlots.level9.max",
		"system.spells.pact.value": "spellSlots.pact.current",
		"system.spells.pact.max": "spellSlots.pact.max",
		"system.resources.primary.value": "resources.primary.current",
		"system.resources.primary.max": "resources.primary.max",
		"system.resources.primary.label": "resources.primary.name",
		"system.resources.secondary.value": "resources.secondary.current",
		"system.resources.secondary.max": "resources.secondary.max",
		"system.resources.secondary.label": "resources.secondary.name",
		"system.resources.tertiary.value": "resources.tertiary.current",
		"system.resources.tertiary.max": "resources.tertiary.max",
		"system.resources.tertiary.label": "resources.tertiary.name",
		"system.attributes.death.success": "derivedStats.deathSaveSuccesses",
		"system.attributes.death.failure": "derivedStats.deathSaveFailures",
		"system.attributes.exhaustion": "derivedStats.exhaustion",
		"system.attributes.movement.walk": "identity.movementSpeed"
	}, N = /* @__PURE__ */ new Set([
		"system.attributes.hp.max",
		"system.attributes.movement.walk",
		"system.attributes.init.total"
	]), P = /* @__PURE__ */ new Set(["name"]), we = [
		"darkvision",
		"blindsight",
		"tremorsense",
		"truesight"
	], F = [
		{
			foundry: "str",
			firebase: "strength"
		},
		{
			foundry: "dex",
			firebase: "dexterity"
		},
		{
			foundry: "con",
			firebase: "constitution"
		},
		{
			foundry: "int",
			firebase: "intelligence"
		},
		{
			foundry: "wis",
			firebase: "wisdom"
		},
		{
			foundry: "cha",
			firebase: "charisma"
		}
	], I = [
		{
			foundry: "acr",
			id: "acrobatics"
		},
		{
			foundry: "ani",
			id: "animal-handling"
		},
		{
			foundry: "arc",
			id: "arcana"
		},
		{
			foundry: "ath",
			id: "athletics"
		},
		{
			foundry: "dec",
			id: "deception"
		},
		{
			foundry: "his",
			id: "history"
		},
		{
			foundry: "ins",
			id: "insight"
		},
		{
			foundry: "itm",
			id: "intimidation"
		},
		{
			foundry: "inv",
			id: "investigation"
		},
		{
			foundry: "med",
			id: "medicine"
		},
		{
			foundry: "nat",
			id: "nature"
		},
		{
			foundry: "prc",
			id: "perception"
		},
		{
			foundry: "prf",
			id: "performance"
		},
		{
			foundry: "per",
			id: "persuasion"
		},
		{
			foundry: "rel",
			id: "religion"
		},
		{
			foundry: "slt",
			id: "sleight-of-hand"
		},
		{
			foundry: "ste",
			id: "stealth"
		},
		{
			foundry: "sur",
			id: "survival"
		}
	];
}));
//#endregion
//#region src/draft-diff.js
function R(e, t) {
	return t.split(".").reduce((e, t) => e?.[t], e);
}
function Te(e, t, n) {
	let r = t.split("."), i = r.pop(), a = e;
	for (let e of r) (a[e] === void 0 || a[e] === null) && (a[e] = {}), a = a[e];
	a[i] = n;
}
function z(e, t) {
	if (e === t) return !0;
	if (e === null || t === null || typeof e != "object" || typeof t != "object" || Array.isArray(e) !== Array.isArray(t)) return !1;
	if (Array.isArray(e)) return e.length === t.length && e.every((e, n) => z(e, t[n]));
	let n = Object.keys(e).filter((t) => e[t] !== void 0), r = Object.keys(t).filter((e) => t[e] !== void 0);
	return n.length === r.length && n.every((n) => z(e[n], t[n]));
}
function Ee(e, t) {
	let n = Array.isArray(e) ? e : [], r = Array.isArray(t) ? t : [];
	if ([...n, ...r].map((e) => e?._id).some((e) => typeof e != "string" || !e) || new Set(r.map((e) => e._id)).size !== r.length) return B;
	let i = new Map(n.map((e) => [e._id, e])), a = new Set(r.map((e) => e._id));
	return {
		upsert: r.filter((e) => !z(i.get(e._id), e)),
		remove: n.filter((e) => !a.has(e._id)).map((e) => e._id)
	};
}
function De(e, t) {
	let n = {};
	for (let r of U) {
		let i = R(t, r);
		i !== void 0 && (z(R(e, r), i) || (n[r] = i));
	}
	for (let r of W) {
		let i = t[r];
		i !== void 0 && (z(e[r], i) || (n[r] = i));
	}
	let r = {};
	if (Object.keys(n).length && (r.set = n), t.items !== void 0 || e.items !== void 0) {
		let n = Ee(e.items, t.items);
		if (n === B) return B;
		(n.upsert.length || n.remove.length) && (r.lists = { items: n });
	}
	return !r.set && !r.lists ? z(e, t) ? null : B : z(Oe(e, r), t) ? r : B;
}
function Oe(e, t) {
	let n = structuredClone(e);
	for (let [e, r] of Object.entries(t.set ?? {})) Te(n, e, structuredClone(r));
	if (t.lists?.items) {
		let { upsert: e = [], remove: r = [] } = t.lists.items, i = new Set(r), a = new Map(e.map((e) => [e._id, e])), o = /* @__PURE__ */ new Set(), s = [];
		for (let e of n.items ?? []) i.has(e._id) || (a.has(e._id) ? (s.push(structuredClone(a.get(e._id))), o.add(e._id)) : s.push(e));
		for (let t of e) o.has(t._id) || s.push(structuredClone(t));
		n.items = s;
	}
	return n;
}
var B, V, H, U, W, ke = e((() => {
	L(), B = Symbol("unsupported"), V = [...Array.from({ length: 9 }, (e, t) => `level${t + 1}`), "pact"], H = [
		"primary",
		"secondary",
		"tertiary"
	], U = [
		...[
			"currentHp",
			"tempHp",
			"maxHp",
			"initiative",
			"ac",
			"deathSaveSuccesses",
			"deathSaveFailures",
			"exhaustion"
		].map((e) => `derivedStats.${e}`),
		...[
			"cp",
			"sp",
			"ep",
			"gp",
			"pp"
		].map((e) => `currency.${e}`),
		...V.flatMap((e) => [`spellSlots.${e}.current`, `spellSlots.${e}.max`]),
		...H.flatMap((e) => [
			`resources.${e}.current`,
			`resources.${e}.max`,
			`resources.${e}.name`
		]),
		"identity.movementSpeed",
		...F.map(({ firebase: e }) => `attributes.scores.${e}`),
		...[
			"appearance",
			"age",
			"sex",
			"height",
			"weight",
			"eyes",
			"hair",
			"skin"
		].map((e) => `identity.${e}`),
		...[
			"alignment",
			"faith",
			"ideal",
			"bond",
			"flaw",
			"trait",
			"backstory"
		].map((e) => `description.${e}`),
		"concept.name",
		"concept.portraitUrl",
		"spellcasting.ability",
		...F.map(({ firebase: e }) => `proficiencies.savingThrows.${e}`),
		...I.map(({ id: e }) => `proficiencies.skills.${e}`)
	], W = [
		"conditions",
		"effects",
		"traits",
		"foundryIdentity"
	];
}));
//#endregion
//#region src/chat-roll.js
function Ae(e) {
	let t = G[e?.kind] ?? "Rolagem", n = typeof e?.label == "string" ? e.label.trim() : "";
	return !n || n === t ? t : `${t} — ${n}`;
}
function je(e) {
	let t = `${Math.max(1, Number(e?.diceCount) || 1)}d${Number(e?.dieSize) || 20}`, n = Number(e?.modifier) || 0;
	return n === 0 ? t : `${t} ${n > 0 ? "+" : "-"} ${Math.abs(n)}`;
}
function Me(e) {
	return Array.isArray(e?.dice) && e.dice.length > 0 ? e.dice.map((e) => Number(e)).filter((e) => Number.isInteger(e) && e > 0) : (Number(e?.diceCount) || 1) === 1 && Number.isInteger(e?.rawRoll) && e.rawRoll > 0 ? [e.rawRoll] : [];
}
function Ne(e) {
	return (game.messages?.contents ?? []).some((t) => a(t, "rollId") === e);
}
function Pe(e) {
	let t = Me(e);
	if (t.length === 0 || typeof Roll != "function" || typeof Roll.fromTerms != "function") return null;
	let n = foundry?.dice?.terms?.Die, r = foundry?.dice?.terms?.OperatorTerm, i = foundry?.dice?.terms?.NumericTerm;
	if (!n) return null;
	let a = Number(e.dieSize) || 20, o = new n({
		number: t.length,
		faces: a,
		results: t.map((e) => ({
			result: e,
			active: !0
		}))
	});
	"_evaluated" in o && (o._evaluated = !0);
	let s = [o], c = Number(e.modifier) || 0;
	if (c !== 0 && r && i) {
		let e = new r({ operator: c > 0 ? "+" : "-" }), t = new i({ number: Math.abs(c) });
		"_evaluated" in e && (e._evaluated = !0), "_evaluated" in t && (t._evaluated = !0), s.push(e, t);
	}
	let l = Roll.fromTerms(s);
	return l._evaluated = !0, l._total = e.total, l;
}
async function Fe(e, t) {
	if (!e || !t?.id || game.user?.id !== game.users?.activeGM?.id || Ne(t.id)) return;
	let n = Ae(t), r = { [s]: {
		rollId: t.id,
		kind: t.kind
	} }, i = typeof ChatMessage.getSpeaker == "function" ? ChatMessage.getSpeaker({ actor: e }) : { alias: e.name }, a = `<div class="dice-roll"><div class="dice-result"><h4 class="dice-total">${t.total}</h4><div class="dice-formula">${je(t)}</div></div></div>`;
	try {
		let e = null;
		try {
			e = Pe(t);
		} catch (e) {
			console.warn("Arthinfo Fichas | não deu pra montar o Roll do Foundry:", e);
		}
		if (e && typeof e.toMessage == "function") try {
			await e.toMessage({
				speaker: i,
				flavor: n,
				flags: r
			});
			return;
		} catch (e) {
			console.warn("Arthinfo Fichas | toMessage falhou, publicando HTML no chat:", e);
		}
		await ChatMessage.create({
			speaker: i,
			flavor: n,
			flags: r,
			content: a
		});
	} catch (e) {
		console.error("Arthinfo Fichas | Falha ao publicar rolagem no chat:", e);
	}
}
var G, Ie = e((() => {
	l(), G = {
		skill: "Perícia",
		save: "Resistência",
		attack: "Ataque",
		ability: "Atributo",
		tool: "Ferramenta",
		initiative: "Iniciativa",
		"hit-die": "Dado de vida",
		damage: "Dano",
		heal: "Cura"
	};
}));
//#endregion
//#region src/consume-hit-die.js
function Le(e, t) {
	let n = e.system?.attributes?.hd?.classes;
	return !n || typeof n.find != "function" ? null : n.find((e) => e.system?.hd?.denomination === t && e.system?.hd?.value) ?? null;
}
async function Re(e, t) {
	if (!e || t?.kind !== "hit-die" || game.user?.id !== game.users?.activeGM?.id) return;
	let n = e.system?.attributes?.hd;
	if (!n) return;
	let r = `d${Number(t.dieSize) || 0}`, i = {}, a = null, o = null;
	if (e.system?.isNPC) {
		if (!n.value) return;
		i["system.attributes.hd.spent"] = (n.spent ?? 0) + 1;
	} else {
		if (a = Le(e, r), !a) return;
		o = { "system.hd.spent": a.system.hd.spent + 1 };
	}
	let s = e.system?.attributes?.hp, c = Math.max(0, Number(t.total) || 0);
	if (s) {
		let t = typeof e.calculateDamage == "function" ? e.calculateDamage([{
			type: "healing",
			value: c
		}], { invertHealing: !1 }) : null, n = t ? t.amount : c, r = Math.max(0, (s.effectiveMax ?? s.max ?? 0) - (s.value ?? 0)), a = Math.min(r, n);
		a > 0 && (i["system.attributes.hp.value"] = (s.value ?? 0) + a);
	}
	try {
		Object.keys(i).length > 0 && await e.update(i), a && o && await a.update(o);
	} catch (e) {
		console.error("Arthinfo Fichas | Falha ao descontar dado de vida no Ator:", e);
	}
}
var ze = e((() => {}));
//#endregion
//#region src/apply-item-equip.js
async function Be(e, t) {
	if (!e || typeof t?.itemId != "string" || typeof t?.equipped != "boolean" || game.user?.id !== game.users?.activeGM?.id) return;
	let { itemId: n, equipped: r } = t, i = e.items.find((e) => (a(e, "sourceId") || e.id) === n);
	if (!i) {
		console.warn(`Arthinfo Fichas | Item ${n} não encontrado em ${e.name} pra (des)equipar.`);
		return;
	}
	if (i.system?.equipped !== r) try {
		await i.update({ "system.equipped": r });
	} catch (e) {
		console.error("Arthinfo Fichas | Falha ao (des)equipar item no Ator:", e);
	}
}
var Ve = e((() => {
	l();
}));
//#endregion
//#region src/apply-item-cast.js
function He(e, t) {
	return e.items.find((e) => (a(e, "sourceId") || e.id) === t);
}
async function Ue(e, t, n) {
	let r = `spell${n}`, i = e.system?.spells?.[r];
	if (!i || (i.value ?? 0) <= 0) {
		console.warn(`Arthinfo Fichas | Sem slot de ${n}º círculo disponível em ${e.name} pra conjurar ${t.name}.`);
		return;
	}
	await e.update({ [`system.spells.${r}.value`]: i.value - 1 });
}
async function We(e) {
	let t = e.system?.uses, n = Number(t?.max), r = t?.spent ?? 0;
	if (!t || !Number.isFinite(n) || r >= n) {
		console.warn(`Arthinfo Fichas | Sem carga própria disponível em ${e.name} pra conjurar de graça.`);
		return;
	}
	await e.update({ "system.uses.spent": r + 1 });
}
async function Ge(e, t) {
	let n = typeof ChatMessage.getSpeaker == "function" ? ChatMessage.getSpeaker({ actor: e }) : { alias: e.name }, r = `<p><strong>${e.name}</strong> quer conjurar <strong>${t.name}</strong> — mecânica complexa demais pra automatizar pela ficha, resolver no Foundry.</p>`;
	await ChatMessage.create({
		speaker: n,
		content: r
	});
}
async function Ke(e, t) {
	if (!e || !t || typeof t.itemId != "string" || game.user?.id !== game.users?.activeGM?.id) return;
	let n = He(e, t.itemId);
	if (!n) {
		console.warn(`Arthinfo Fichas | Item ${t.itemId} não encontrado em ${e.name} pra conjurar.`);
		return;
	}
	try {
		if (t.using === "slot") {
			let r = Number(t.slotLevel);
			if (!Number.isInteger(r) || r < 1 || r > 9) return;
			await Ue(e, n, r);
		} else t.using === "itemUses" ? await We(n) : t.using === "gm" && await Ge(e, n);
	} catch (e) {
		console.error("Arthinfo Fichas | Falha ao aplicar conjuração de magia:", e);
	}
}
var qe = e((() => {
	l();
}));
//#endregion
//#region src/apply-rest.js
async function Je(e, t) {
	if (e && t && game.user?.id === game.users?.activeGM?.id) try {
		t.type === "long" ? await e.longRest({ dialog: !1 }) : t.type === "short" && await e.shortRest({ dialog: !1 });
	} catch (e) {
		console.error("Arthinfo Fichas | Falha ao aplicar descanso:", e);
	}
}
var Ye = e((() => {}));
//#endregion
//#region src/apply-spell-slot.js
async function Xe(e, t) {
	if (!e || !t || game.user?.id !== game.users?.activeGM?.id) return;
	let n = t.level === "pact" ? "pact" : `spell${Number(t.level)}`, r = e.system?.spells?.[n], i = Number(t.value);
	if (!r || !Number.isInteger(i) || i < 0) return;
	let a = Math.min(i, Number(r.max) || 0);
	if (a !== r.value) try {
		await e.update({ [`system.spells.${n}.value`]: a });
	} catch (e) {
		console.error("Arthinfo Fichas | Falha ao ajustar slot de magia:", e);
	}
}
var Ze = e((() => {}));
//#endregion
//#region src/class-hit-points.js
function Qe(e) {
	return e ? Array.isArray(e) ? e.map((e, t) => [String(e?._id ?? t), e]) : Object.entries(e) : [];
}
function $e(e) {
	let t = Qe(e).find(([, e]) => e?.type === K);
	return t ? {
		id: t[0],
		entry: t[1]
	} : null;
}
function et(e, t) {
	if (!e || e.type !== "class" || !(Number(e.system?.levels) >= 1)) return null;
	let n = e.system?.advancement, r = $e(n);
	if (r && r.entry?.value?.[1] !== void 0) return null;
	if (r) return Array.isArray(n) ? { "system.advancement": n.map((e) => e?._id === r.entry._id || e === r.entry ? {
		...e,
		value: {
			...e.value ?? {},
			1: "max"
		}
	} : e) } : { [`system.advancement.${r.id}.value.1`]: "max" };
	let i = t(), a = {
		_id: i,
		type: K,
		configuration: {},
		value: { 1: "max" },
		flags: {},
		hint: ""
	};
	return Array.isArray(n) ? { "system.advancement": [...n, a] } : { [`system.advancement.${i}`]: a };
}
async function tt(e) {
	let t = e.system?.attributes?.hp, n = !(Number(t?.max) > 0), r = 0;
	for (let t of e.items?.contents ?? e.items ?? []) {
		if (t.type !== "class") continue;
		let e = et(t.toObject(), () => foundry.utils.randomID(16));
		e && (await t.update(e), r += 1);
	}
	if (r > 0 && n) {
		let t = e.system?.attributes?.hp;
		Number(t?.max) > 0 && !(Number(t?.value) > 0) && await e.update({ "system.attributes.hp.value": t.max });
	}
	return r;
}
var K, nt = e((() => {
	K = "HitPoints";
}));
//#endregion
//#region src/sync-manager.js
function q(e, t) {
	let n;
	return function(...r) {
		clearTimeout(n), n = setTimeout(() => e.apply(this, r), t);
	};
}
function J(e) {
	let t = foundry.utils.deepClone(e);
	return delete t._stats, delete t.sort, delete t.ownership, delete t.folder, t.flags && (delete t.flags.core, delete t.flags.exportSource), t;
}
function rt(e) {
	if (!e.system || !e.system.activities) return e;
	let t = e.system.activities;
	if (Array.isArray(t)) {
		let n = {};
		t.forEach((e, t) => {
			let r = e._id || foundry.utils.randomID();
			e._id = r, n[r] = e;
		}), e.system.activities = n;
	} else if (typeof t == "object") for (let [e, n] of Object.entries(t)) n._id ||= e;
	return e;
}
function it(e) {
	let t = v(e);
	return !t || String(t).includes("mystery-man") || String(t).includes("icons/svg/item-bag") ? "" : t;
}
function Y(e, t) {
	return typeof game > "u" || !game.actors ? !1 : f(game.actors, e.id).has(t);
}
function at(e) {
	let t = e.statuses;
	return t ? typeof t.size == "number" ? [...t].map(String) : Array.isArray(t) ? t.map(String) : typeof t == "object" ? Object.keys(t) : [] : [];
}
function X(e) {
	if (typeof e.allApplicableEffects == "function") return [...e.allApplicableEffects()];
	let t = e.effects;
	return t?.contents ?? (Array.isArray(t) ? t : []);
}
function Z(e) {
	return e.type === "enchantment" || e.isAppliedEnchantment === !0;
}
function ot(e) {
	let t = e.duration?.label;
	if (!t) return "";
	let n = String(t).trim();
	return !n || /^(none|nenhum|permanent|permanente|indefinid)/i.test(n) ? "" : n;
}
function st(e, t) {
	let n = e.parent;
	return n && n !== t && n.name ? n.name : "";
}
function Q(e, t) {
	let n = { name: e.name }, r = v(e.img || e.icon);
	r && (n.img = r), e.disabled && (n.disabled = !0), e.isSuppressed && (n.isSuppressed = !0), e.isTemporary && (n.isTemporary = !0);
	let i = at(e);
	i.length && (n.statuses = i);
	let a = ot(e);
	a && (n.durationLabel = a);
	let o = st(e, t);
	return o && (n.source = o), n;
}
function ct(e) {
	return X(e).filter((e) => !e.disabled && !e.isSuppressed && e.name && !Z(e)).map((t) => Q(t, e)).filter((e) => {
		let t = e.statuses ?? [];
		return t.length !== 0 && !t.every((e) => e === "exhaustion");
	}).map((e) => {
		let t = {
			name: e.name,
			statuses: e.statuses
		};
		return e.img && (t.img = e.img), t;
	});
}
function lt(e) {
	return X(e).filter((e) => e?.name && !Z(e)).map((t) => Q(t, e));
}
var $, ut, dt = e((() => {
	L(), ke(), b(), Ie(), ze(), h(), Ve(), qe(), Ye(), Ze(), l(), nt(), $ = /* @__PURE__ */ new Set([
		"class",
		"subclass",
		"race",
		"background"
	]), ut = class {
		constructor(e) {
			this.apiClient = e, this.streams = /* @__PURE__ */ new Map(), this.activeSyncs = /* @__PURE__ */ new Set(), this.lastKnownDraft = /* @__PURE__ */ new Map(), this.saveQueues = /* @__PURE__ */ new Map(), this.debouncedActorUpdate = q(this._executeActorUpdate.bind(this), 1e3), this.debouncedItemUpdate = q(this._executeItemUpdate.bind(this), 1e3);
		}
		notifyApiError(e, t, n) {
			console.error(`Arthinfo Fichas | Falha ao ${e} a ficha ${n?.name || n?.id || "desconhecida"}:`, t), ui.notifications.error(`Arthinfo Fichas: erro ao ${e} a ficha ${n?.name || n?.id || ""}: ${t?.message || "erro desconhecido"}`);
		}
		async startListening(e) {
			let t = a(e, "draftId");
			if (t && !this.streams.has(e.id)) {
				if (Y(e, t)) {
					console.warn(`Arthinfo Fichas | ${e.name} não inicia sync: a ficha ${t} já está vinculada a outro Ator.`);
					return;
				}
				this.streams.set(e.id, { close() {} });
				try {
					try {
						let n = await this.apiClient.getDraft(t);
						n && (this.lastKnownDraft.set(e.id, n), await this._applyRemoteDraft(e, n), await this._executeActorUpdate(e, t), await this._executeItemUpdate(e, t));
					} catch (t) {
						this.notifyApiError("carregar", t, e);
					}
					let n = await this.apiClient.openStream(t, async (t) => {
						if (t.roll) {
							await Fe(e, t.roll), await Re(e, t.roll);
							return;
						}
						if (t.itemEquip) {
							await Be(e, t.itemEquip);
							return;
						}
						if (t.itemCast) {
							await Ke(e, t.itemCast);
							return;
						}
						if (t.rest) {
							await Je(e, t.rest);
							return;
						}
						if (t.spellSlot) {
							await Xe(e, t.spellSlot);
							return;
						}
						if (t.sourceClientId === this.apiClient.clientId) {
							this.lastKnownDraft.set(e.id, t.data);
							return;
						}
						this.lastKnownDraft.set(e.id, t.data), this.activeSyncs.add(e.id);
						try {
							await this._applyRemoteDraft(e, t.data);
						} finally {
							this.activeSyncs.delete(e.id);
						}
					}, (e) => {
						console.warn("Arthinfo Fichas | Stream desconectado, tentando reconectar automaticamente:", e);
					});
					this.streams.set(e.id, n);
				} catch (t) {
					this.streams.delete(e.id), this.notifyApiError("conectar ao stream de", t, e);
				}
			}
		}
		stopListening(e) {
			let t = this.streams.get(e.id);
			t && (t.close(), this.streams.delete(e.id)), this.lastKnownDraft.delete(e.id);
		}
		async _applyRemoteDraft(e, t) {
			let n = {}, r = foundry.utils.getProperty(t, "derivedStats.maxHp"), i = typeof r == "number" && r <= 0;
			for (let [r, a] of Object.entries(M)) {
				if (r.startsWith("system.abilities") || N.has(r) || i && r.startsWith("system.attributes.hp.")) continue;
				let o = foundry.utils.getProperty(t, a);
				if (P.has(r) && (typeof o != "string" || !o.trim())) continue;
				let s = foundry.utils.getProperty(e, r);
				o != null && o !== s && (n[r] = o);
			}
			if (F.forEach(({ foundry: r, firebase: i }) => {
				let a = e.system.abilities?.[r]?.value || 0, o = (foundry.utils.getProperty(t, `attributes.scores.${i}`) || 10) + (foundry.utils.getProperty(t, `attributes.originBonuses.${i}`) || 0);
				a !== o && (n[`system.abilities.${r}.value`] = o);
			}), F.forEach(({ foundry: r, firebase: i }) => {
				let a = foundry.utils.getProperty(t, `proficiencies.savingThrows.${i}`);
				if (a === void 0) return;
				let o = +!!a;
				(e.system.abilities?.[r]?.proficient ?? 0) !== o && (n[`system.abilities.${r}.proficient`] = o);
			}), I.forEach(({ foundry: r, id: i }) => {
				let a = foundry.utils.getProperty(t, `proficiencies.skills.${i}`);
				if (a === void 0) return;
				let o = Ce(a);
				(e.system.skills?.[r]?.value ?? 0) !== o && (n[`system.skills.${r}.value`] = o);
			}), Object.keys(n).length > 0 && await e.update(n), t.items && Array.isArray(t.items)) {
				let n = t.items, r = e.items.contents, i = [], o = [], l = [];
				for (let e of n) {
					let t = r.find((t) => a(t, "sourceId") === e._id || t.id === e._id), n = rt(foundry.utils.deepClone(e));
					if (t) {
						let r = J(t.toObject()), i = J(n);
						$.has(r.type) && (r.system && delete r.system.advancement, i.system && delete i.system.advancement), i._id = r._id;
						for (let e of [s, c]) r.flags?.[e] && delete r.flags[e], i.flags?.[e] && delete i.flags[e];
						if (JSON.stringify(r) !== JSON.stringify(i)) {
							let i = n;
							i._id = t.id, $.has(r.type) && i.system && delete i.system.advancement, foundry.utils.setProperty(i, `flags.${s}.sourceId`, e._id), o.push(i);
						}
					} else {
						let t = n;
						foundry.utils.setProperty(t, `flags.${s}.sourceId`, e._id), delete t._id, i.push(t);
					}
				}
				for (let e of r) {
					let t = a(e, "sourceId");
					t && (n.some((e) => e._id === t) || l.push(e.id));
				}
				l.length > 0 && await e.deleteEmbeddedDocuments("Item", l), i.length > 0 && await e.createEmbeddedDocuments("Item", i), o.length > 0 && await e.updateEmbeddedDocuments("Item", o);
			}
			try {
				await tt(e);
			} catch (e) {
				console.warn("Arthinfo Fichas | Não foi possível reparar o PV da classe:", e);
			}
			t.equipment && await this._applyEquipmentFromCompendium(e, t.equipment);
		}
		async _applyEquipmentFromCompendium(e, t) {
			let n = [
				t.armorId,
				...t.weaponIds || [],
				...t.gearIds || []
			].filter(Boolean);
			if (n.length === 0) return;
			let r;
			try {
				r = await _(n);
			} catch (e) {
				console.warn("Arthinfo Fichas | Falha ao procurar itens de equipamento no compêndio:", e);
				return;
			}
			if (r.size === 0) return;
			let i = e.items.contents, o = [];
			for (let [e, t] of r) {
				if (i.some((t) => a(t, "catalogKey") === e)) continue;
				let n = game.packs.get(t.packId), r = n ? await n.getDocument(t.foundryId) : null;
				if (!r) continue;
				let c = r.toObject();
				delete c._id, foundry.utils.setProperty(c, `flags.${s}.catalogKey`, e), o.push(c);
			}
			o.length > 0 && await e.createEmbeddedDocuments("Item", o);
		}
		async handleActorUpdate(e, t) {
			if (this.activeSyncs.has(e.id)) return;
			let n = a(e, "draftId");
			n && (Y(e, n) || this.debouncedActorUpdate(e, n));
		}
		_overlayActorOntoDraft(e, t) {
			let n = !(foundry.utils.getProperty(e, "system.attributes.hp.max") > 0);
			for (let [r, i] of Object.entries(M)) {
				if (r.startsWith("system.abilities") || n && r.startsWith("system.attributes.hp.")) continue;
				let a = foundry.utils.getProperty(e, r);
				a !== void 0 && foundry.utils.setProperty(t, i, a);
			}
			F.forEach(({ foundry: n, firebase: r }) => {
				let i = e.system.abilities?.[n]?.value;
				if (i === void 0) return;
				let a = foundry.utils.getProperty(t, `attributes.originBonuses.${r}`) || 0;
				foundry.utils.setProperty(t, `attributes.scores.${r}`, i - a);
			}), F.forEach(({ foundry: n, firebase: r }) => {
				let i = e.system.abilities?.[n]?.proficient;
				i !== void 0 && foundry.utils.setProperty(t, `proficiencies.savingThrows.${r}`, i >= 1);
			}), I.forEach(({ foundry: n, id: r }) => {
				let i = e.system.skills?.[n]?.value;
				i !== void 0 && foundry.utils.setProperty(t, `proficiencies.skills.${r}`, Se(i));
			});
			let r = e.system.attributes?.spellcasting;
			if (r) {
				let e = F.find(({ foundry: e }) => e === r);
				e && foundry.utils.setProperty(t, "spellcasting.ability", e.firebase);
			}
			foundry.utils.setProperty(t, "concept.portraitUrl", it(e.img)), t.conditions = ct(e), t.effects = lt(e), t.traits = ve(e), t.foundryIdentity = A(e);
			let i = xe(e);
			t.identity = {
				...t.identity ?? {},
				...i.identity
			}, t.description = {
				...t.description ?? {},
				...i.description
			};
		}
		_overlayItemsOntoDraft(e, t) {
			let n = [];
			for (let t of e.items) try {
				let e = t.toObject();
				e._id = a(t, "sourceId") || e._id, e.img = v(e.img);
				let r = J(e);
				[
					"class",
					"subclass",
					"race",
					"background"
				].includes(r.type) && r.system && delete r.system.advancement, n.push(r);
			} catch (e) {
				console.warn(`Arthinfo Fichas | Não foi possível serializar ${t.name} (${t.type}):`, e), n.push({
					_id: a(t, "sourceId") || t.id,
					name: t.name,
					type: t.type,
					img: v(t.img),
					system: t.type === "class" ? { levels: t.system?.levels } : {}
				});
			}
			t.items = n, t.foundryIdentity = A(e), t.conditions = ct(e), t.effects = lt(e);
		}
		_saveDraftFromActor(e, t, n, r) {
			let i = (this.saveQueues.get(e.id) ?? Promise.resolve()).then(() => this._saveDraftFromActorNow(e, t, n, r)), a = i.catch(() => {});
			return this.saveQueues.set(e.id, a), a.then(() => {
				this.saveQueues.get(e.id) === a && this.saveQueues.delete(e.id);
			}), i;
		}
		async _persistDraft(e, t, n) {
			if (this.patchSupported === !1) return this.apiClient.saveDraft(e, n);
			let r = De(t, n);
			if (r === null) return null;
			if (r === B) return this.apiClient.saveDraft(e, n);
			try {
				return await this.apiClient.patchDraft(e, r, t.updatedAt);
			} catch (t) {
				let r = t?.status === 404 && t.code !== "DRAFT_NOT_FOUND" || t?.status === 405;
				if (r && (this.patchSupported = !1), r || t?.status === 400 || t?.status === 413) return console.warn(`Arthinfo Fichas | PATCH recusado (HTTP ${t.status}); enviando a ficha inteira por PUT.`), this.apiClient.saveDraft(e, n);
				throw t;
			}
		}
		async _saveDraftFromActorNow(e, t, n, r) {
			let i = async () => {
				if (!this.lastKnownDraft.has(e.id)) return console.warn(`Arthinfo Fichas | Ignorando atualização de ${e.name}: ainda não temos uma cópia da ficha vinda do backend.`), null;
				let r = this.lastKnownDraft.get(e.id), i = foundry.utils.deepClone(r);
				return n(e, i), this._persistDraft(t, r, i);
			};
			try {
				let t = await i();
				t && this.lastKnownDraft.set(e.id, t);
			} catch (t) {
				if (t?.status === 409 && t.current) {
					this.lastKnownDraft.set(e.id, t.current);
					try {
						let t = await i();
						t && this.lastKnownDraft.set(e.id, t);
						return;
					} catch (t) {
						throw this.notifyApiError(r, t, e), t;
					}
				}
				throw this.notifyApiError(r, t, e), t;
			}
		}
		async _executeActorUpdate(e, t) {
			if (!this.lastKnownDraft.has(e.id)) {
				console.warn(`Arthinfo Fichas | Ignorando atualização de ${e.name}: ainda não temos uma cópia da ficha vinda do backend.`);
				return;
			}
			await this._saveDraftFromActor(e, t, (e, t) => {
				this._overlayActorOntoDraft(e, t);
			}, "salvar");
		}
		async handleItemUpdate(e) {
			if (this.activeSyncs.has(e.id)) return;
			let t = a(e, "draftId");
			t && (Y(e, t) || this.debouncedItemUpdate(e, t));
		}
		async _executeItemUpdate(e, t) {
			if (!this.lastKnownDraft.has(e.id)) {
				console.warn(`Arthinfo Fichas | Ignorando atualização de itens de ${e.name}: ainda não temos uma cópia da ficha vinda do backend.`);
				return;
			}
			await this._saveDraftFromActor(e, t, (e, t) => {
				this._overlayItemsOntoDraft(e, t);
			}, "salvar os itens de");
		}
	};
}));
//#endregion
//#region src/legacy-migration.js
function ft(e) {
	if (typeof e != "string") return e;
	try {
		return JSON.parse(e);
	} catch {
		return e;
	}
}
function pt(e, t) {
	let n = `${c}.${t}`, r = e.settings?.storage?.get?.("world"), i = r?.getSetting?.(n) ?? r?.find?.((e) => e.key === n);
	if (i) return ft(i.value);
}
function mt(e) {
	return e == null || e === "" || Array.isArray(e) && e.length === 0;
}
async function ht(e) {
	if (!e.user?.isGM) return 0;
	let t = 0;
	for (let n of vt) try {
		let r = pt(e, n);
		if (mt(r)) continue;
		let i = e.settings.get(s, n);
		if (!mt(i) && i !== yt[n] || i === r) continue;
		await e.settings.set(s, n, r), t += 1;
	} catch (e) {
		console.warn(`Arthinfo Fichas | Não consegui migrar a configuração "${n}" do módulo antigo.`, e);
	}
	return t;
}
async function gt(e) {
	if (!e.user?.isGM) return 0;
	let t = 0;
	for (let n of e.actors ?? []) {
		let e = n.flags?.[c]?.draftId;
		if (e) try {
			let r = n.getFlag(s, "draftId"), i = { [`flags.${c}.-=draftId`]: null };
			r || (i[`flags.${s}.draftId`] = e), await n.update(i), t += 1;
		} catch (e) {
			console.warn(`Arthinfo Fichas | Não consegui migrar o vínculo de "${n.name}".`, e);
		}
	}
	return t;
}
async function _t(e) {
	let t = await ht(e), n = await gt(e);
	return (t || n) && console.log(`Arthinfo Fichas | Migração do módulo antigo: ${n} vínculo(s) de ficha e ${t} configuração(ões).`), {
		settings: t,
		links: n
	};
}
var vt, yt, bt = e((() => {
	l(), vt = [
		"mesaKey",
		"compendiumSyncKey",
		"backendUrl",
		"compendiumSyncSelection"
	], yt = { backendUrl: "https://api.runarcana.org" };
})), xt = /* @__PURE__ */ t((() => {
	i(), h(), ce(), me(), dt(), bt(), l();
	var e = null, t = null;
	function n(e) {
		let t = game.settings.get(s, e);
		return typeof t == "string" ? t.trim() : "";
	}
	function c() {
		let e = n("compendiumSyncKey"), t = n("mesaKey");
		if (!e && !t) {
			ui.notifications.warn("Cole a chave de sincronização de compêndio (catálogo compartilhado) ou a chave da mesa (homebrew da sua mesa) nas configurações do módulo.");
			return;
		}
		let i = n("backendUrl");
		if (!i) {
			ui.notifications.warn("Configure a URL do backend nas configurações do módulo primeiro.");
			return;
		}
		let a = new r({
			mesaKey: t,
			baseUrl: i,
			syncKey: e
		});
		new w(a).render();
	}
	async function u(e, n) {
		t?.stopListening(e), await o(e, "draftId"), ui.notifications.info(n ?? `${e.name}: desvinculado da ficha.`);
	}
	async function d() {
		if (game.user.isGM) for (let e of de(game.actors)) {
			let [t, ...n] = fe(e);
			for (let e of n) await u(e, `Arthinfo Fichas: ${e.name} estava vinculado à mesma ficha que ${t.name} — desvinculado automaticamente (limpeza de duplicata).`);
			ui.notifications.warn(`Arthinfo Fichas: ${n.length + 1} Atores compartilhavam a mesma ficha; só ${t.name} (o mais antigo) permanece vinculado.`);
		}
	}
	async function p(r) {
		if (!n("mesaKey")) return ui.notifications.warn("Cole a chave da mesa nas configurações do módulo");
		if (!e) return ui.notifications.warn("Configure a URL do backend nas configurações do módulo primeiro.");
		let i = a(r, "draftId");
		if (i) {
			let { DialogV2: e } = foundry.applications.api;
			if (!await e.confirm({
				window: { title: "Ator já vinculado" },
				content: `<p><strong>${r.name}</strong> já está vinculado à ficha <code>${i}</code>.</p>
        <p>Desvincular agora para escolher outra ficha? A sincronização com a ficha atual para.</p>`,
				yes: { label: "Desvincular" },
				no: { label: "Cancelar" }
			})) return;
			await u(r);
		}
		new m(e, r, t).render(!0);
	}
	var g = class extends FormApplication {
		constructor() {
			super({});
		}
		render() {
			return c(), this;
		}
		async _updateObject() {}
	};
	Hooks.once("init", () => {
		game.settings.register(s, "mesaKey", {
			name: "Chave da mesa",
			hint: "Gerada no site, na página da mesa. Cole aqui.",
			scope: "world",
			config: !0,
			type: String,
			default: "",
			requiresReload: !0
		}), game.settings.register(s, "compendiumSyncKey", {
			name: "Chave de Sincronização de Compêndio",
			hint: "Só para enviar itens ao catálogo compartilhado do site (COMPENDIUM_SYNC_KEY). Não é a chave da mesa nem login. Deixe em branco e use só a Chave da mesa (acima) para sincronizar homebrew restrito à sua mesa, em vez do catálogo público.",
			scope: "world",
			config: !0,
			type: String,
			default: ""
		}), game.settings.register(s, "compendiumSyncSelection", {
			scope: "world",
			config: !1,
			type: Array,
			default: []
		}), game.settings.registerMenu(s, "compendiumSyncMenu", {
			name: "Sincronizar Compêndio de Itens",
			label: "Abrir Sincronização",
			hint: "Escolhe quais compêndios de itens do mundo sincronizar com o backend, pra alimentar o seletor de equipamento do site.",
			icon: "fas fa-box-open",
			type: g,
			restricted: !0
		}), game.settings.register(s, "backendUrl", {
			name: "URL do Backend Arthinfo Fichas",
			hint: "URL base do arthinfo-fichas-api. Só altere se estiver hospedando o backend por conta própria.",
			scope: "world",
			config: !0,
			type: String,
			default: "https://arthinfo-api.arthur-paraiso-mar.workers.dev",
			requiresReload: !0
		});
	}), Hooks.once("ready", async () => {
		let i = game.modules.get(s);
		i && (i.api = { openCompendiumSync: c }), await _t(game);
		let a = n("mesaKey"), o = n("backendUrl");
		if (!a) {
			console.warn("Arthinfo Fichas | Chave da mesa não configurada nas configurações do módulo.");
			return;
		}
		if (!o) {
			console.warn("Arthinfo Fichas | URL do backend não configurada nas configurações do módulo.");
			return;
		}
		e = new r({
			mesaKey: a,
			baseUrl: o,
			syncKey: n("compendiumSyncKey")
		}), t = new ut(e), await d(), game.actors.forEach((e) => t.startListening(e)), console.log("Arthinfo Fichas | Backend configurado e ouvindo atores vinculados."), i && (i.api.apiClient = e, i.api.syncManager = t);
	}), Hooks.on("updateActor", (e, n, r, i) => {
		i === game.user.id && t && t.handleActorUpdate(e, n);
	}), Hooks.on("preCreateActor", (e, t, n, r) => {
		if (r !== game.user.id) return;
		let i = le(e, t);
		if (ue(game.actors, i, e.id)) try {
			e.updateSource(pe());
		} catch (e) {
			console.warn("Arthinfo Fichas | Não foi possível tirar o draftId herdado antes da criação:", e);
		}
	}), Hooks.on("createActor", async (e, n, r) => {
		if (r !== game.user.id) return;
		let i = a(e, "draftId");
		i && f(game.actors, e.id).has(i) && (await o(e, "draftId"), t?.stopListening(e), ui.notifications.warn(`Arthinfo Fichas: ${e.name} veio com um vínculo herdado (provavelmente de uma duplicação) de uma ficha já vinculada a outro Ator — desvinculado automaticamente.`));
	}), Hooks.on("deleteActor", (e, n, r) => {
		r === game.user.id && t && t.stopListening(e);
	}), Hooks.on("createItem", (e, n, r) => {
		r === game.user.id && t && e.parent && t.handleItemUpdate(e.parent);
	}), Hooks.on("updateItem", (e, n, r, i) => {
		i === game.user.id && t && e.parent && t.handleItemUpdate(e.parent);
	}), Hooks.on("deleteItem", (e, n, r) => {
		r === game.user.id && t && e.parent && t.handleItemUpdate(e.parent);
	});
	function _(e) {
		let t = e?.parent;
		return t ? t.documentName === "Actor" ? t : t.documentName === "Item" && t.parent?.documentName === "Actor" ? t.parent : null : null;
	}
	Hooks.on("createActiveEffect", (e, n, r) => {
		if (r !== game.user.id || !t) return;
		let i = _(e);
		i && t.handleActorUpdate(i, {});
	}), Hooks.on("updateActiveEffect", (e, n, r, i) => {
		if (i !== game.user.id || !t) return;
		let a = _(e);
		a && t.handleActorUpdate(a, n);
	}), Hooks.on("deleteActiveEffect", (e, n, r) => {
		if (r !== game.user.id || !t) return;
		let i = _(e);
		i && t.handleActorUpdate(i, {});
	}), Hooks.on("getActorSheetHeaderButtons", (e, t) => {
		let n = e.object;
		if (!n || n.documentName !== "Actor") return;
		let r = !!a(n, "draftId");
		t.unshift({
			class: "arthinfo-fichas-sync-btn",
			icon: "fas fa-sync",
			label: r ? "Arthinfo (Vinculado)" : "Arthinfo Fichas Sync",
			onclick: () => p(n)
		});
	}), Hooks.on("getHeaderControlsActorSheetV2", (e, t) => {
		let n = e.document;
		if (!n || n.documentName !== "Actor") return;
		let r = !!a(n, "draftId");
		t.unshift({
			action: "arthinfo-fichas-sync",
			icon: "fas fa-sync",
			label: r ? "Arthinfo (Vinculado)" : "Arthinfo Fichas Sync",
			class: "arthinfo-fichas-sync-btn",
			onClick: () => p(n)
		});
	});
}));
//#endregion
export default xt();
