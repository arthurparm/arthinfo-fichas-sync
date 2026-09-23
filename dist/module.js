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
						console.error("Runarcana Sync | Erro ao processar evento do stream:", e);
					}
				}, s.addEventListener("roll", (e) => {
					try {
						t(JSON.parse(e.data));
					} catch (e) {
						console.error("Runarcana Sync | Erro ao processar rolagem do stream:", e);
					}
				}), s.onerror = (e) => {
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
//#region src/draft-selector.js
function a(e) {
	return String(e ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function o(e) {
	return `${e?.concept?.name || e?.title || "Sem Nome"} (${e?.classBuild?.classId || "Sem Classe"})${e?.assignedUserId ? " — atribuída a um jogador" : ""}`;
}
function s(e, t) {
	let n = /* @__PURE__ */ new Set();
	for (let r of e ?? []) {
		if (r.id === t) continue;
		let e = r.getFlag("runarcana-sync", "draftId");
		e && n.add(e);
	}
	return n;
}
function c(e) {
	return e?.status === 401 ? "<p>Chave da mesa inválida ou revogada.</p>\n      <p>Gere uma nova na página da mesa no site e cole em Configurações do módulo &rsaquo; Chave da mesa.</p>" : `<p>Erro ao carregar fichas: ${a(e?.message || "Erro desconhecido.")}</p>
    <p>Verifique se a chave da mesa e a URL do backend estão configuradas corretamente nas configurações do módulo e
    se o servidor (runarcana-api) está no ar.</p>`;
}
var l, u = e((() => {
	l = class {
		constructor(e, t, n) {
			this.apiClient = e, this.actor = t, this.syncManager = n;
		}
		async render(e = !0) {
			let { DialogV2: t } = foundry.applications.api;
			try {
				let e = await this.apiClient.listDrafts(), n = s(game.actors, this.actor.id), r = "<form><div class=\"form-group\"><label>Ficha:</label><select name=\"draftId\">";
				return e.length === 0 ? r += "<option value=\"\">Nenhuma ficha encontrada</option>" : e.forEach((e) => {
					let t = n.has(e.id), i = t ? `${o(e)} (vinculado a outro Ator)` : o(e);
					r += `<option value="${a(e.id)}" ${t ? "disabled" : ""}>${a(i)}</option>`;
				}), r += "</select></div></form>", t.wait({
					window: { title: "Vincular Ficha Runarcana" },
					content: r,
					buttons: [{
						action: "link",
						label: "Vincular",
						icon: "fas fa-link",
						callback: async (e, t, n) => {
							let r = n.element.querySelector("[name=\"draftId\"]"), i = r.value, a = r.selectedOptions?.[0];
							i && !a?.disabled && (await this.actor.setFlag("runarcana-sync", "draftId", i), ui.notifications.info(`Actor vinculado à ficha ${i}`), this.syncManager && this.syncManager.startListening(this.actor));
						}
					}]
				});
			} catch (e) {
				return t.prompt({
					window: { title: "Erro" },
					content: c(e),
					ok: { label: "Fechar" }
				});
			}
		}
	};
}));
//#endregion
//#region src/compendium-sync.js
function d() {
	return game.packs.filter((e) => e.documentName === "Item");
}
async function f(e) {
	let t = new Set((e || []).filter(Boolean)), n = /* @__PURE__ */ new Map();
	if (t.size === 0) return n;
	for (let e of d()) {
		let r;
		try {
			r = await e.getIndex({ fields: ["flags.runarcana-sync.catalogKey"] });
		} catch (t) {
			console.warn(`Runarcana Sync | Falha ao ler índice do compêndio ${e.collection}:`, t);
			continue;
		}
		for (let i of r) {
			let r = i.flags?.["runarcana-sync"]?.catalogKey;
			r && t.has(r) && !n.has(r) && n.set(r, {
				packId: e.collection,
				foundryId: i._id
			});
		}
	}
	return n;
}
function p(e) {
	if (!e) return e;
	try {
		return new URL(e, window.location.origin).href;
	} catch {
		return e;
	}
}
function m(e, t) {
	let n = [];
	for (let r = 0; r < e.length; r += t) n.push(e.slice(r, r + t));
	return n;
}
async function h(e, t, n) {
	let r = [], i = [];
	for (let e of t) {
		let t = game.packs.get(e);
		if (!t) continue;
		let n = (await t.getDocuments()).map((t) => ({
			packId: e,
			foundryId: t.id,
			name: t.name,
			img: p(t.img),
			itemType: t.type,
			catalogKey: t.getFlag("runarcana-sync", "catalogKey") ?? null,
			system: t.toObject().system
		}));
		r.push(...n), i.push({
			packId: e,
			label: t.metadata.label,
			count: n.length
		});
	}
	let a = m(r, g);
	for (let t = 0; t < a.length; t++) await e.putCompendiumItemsBatch(a[t]), n?.(t + 1, a.length);
	return {
		totalSynced: r.length,
		packSummaries: i
	};
}
var g, _ = e((() => {
	g = 50;
}));
//#endregion
//#region src/compendium-sync-dialog.js
function v(e) {
	return String(e ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function ee(e) {
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
function te(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) {
		let e = ee(n);
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
function y(e) {
	let t = e.querySelector("input[data-action=\"toggleGroup\"]");
	if (!t) return;
	let n = Array.from(e.querySelectorAll("input[data-action=\"toggleItem\"]")), r = n.filter((e) => e.checked).length;
	t.checked = r > 0 && r === n.length, t.indeterminate = r > 0 && r < n.length;
}
function ne(e, t) {
	let n = t.closest("[data-pack-group]");
	if (!n) return;
	let r = t.checked;
	n.querySelectorAll("input[data-action=\"toggleItem\"]").forEach((e) => {
		e.disabled = !r, e.checked = r;
	}), t.indeterminate = !1;
}
function re(e, t) {
	let n = t.closest("[data-pack-group]");
	n && y(n);
}
var b, x, S, C = e((() => {
	_(), b = "compendiumSyncSelection", x = "\n  .rs-compendium-sync .rs-group-toggle {\n    position: relative;\n    width: 16px;\n    height: 16px;\n    flex: 0 0 auto;\n    border: 1px solid var(--color-border-light-tertiary, #7a7971);\n    border-radius: 3px;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n  }\n  .rs-compendium-sync .rs-group-toggle input[type=\"checkbox\"] {\n    position: absolute;\n    inset: 0;\n    margin: 0;\n    opacity: 0;\n    cursor: pointer;\n  }\n  .rs-compendium-sync .rs-group-toggle::after {\n    content: \"\";\n    font-weight: 900;\n    font-size: 12px;\n    line-height: 1;\n    color: #1b1a17;\n    pointer-events: none;\n  }\n  .rs-compendium-sync .rs-group-toggle:has(input:checked),\n  .rs-compendium-sync .rs-group-toggle:has(input:indeterminate) {\n    background: #c9a227;\n  }\n  .rs-compendium-sync .rs-group-toggle:has(input:checked)::after {\n    content: \"\\2713\";\n  }\n  .rs-compendium-sync .rs-group-toggle:has(input:indeterminate)::after {\n    content: \"\\2212\";\n  }\n", S = class {
		constructor(e) {
			this.apiClient = e;
		}
		async render() {
			let { DialogV2: e } = foundry.applications.api, t = d();
			if (t.length === 0) return e.prompt({
				window: { title: "Sincronizar Compêndio de Itens" },
				content: "<p>Nenhum compêndio do tipo Item foi encontrado neste mundo.</p>",
				ok: { label: "Fechar" }
			});
			let n = [];
			try {
				n = game.settings.get("runarcana-sync", b) ?? [];
			} catch {
				n = [];
			}
			let r = new Set(n), i = te(t), a = `
      <style>${x}</style>
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
              ${v(e.label)}
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;">`;
				for (let t of e.packs) {
					let e = r.has(t.collection) ? "checked" : "";
					a += `
              <label style="display:block;margin:2px 0;">
                <input type="checkbox" name="pack" data-action="toggleItem" value="${v(t.collection)}" ${e} />
                ${v(t.metadata.label)}
              </label>`;
				}
				a += "\n            </div>\n          </fieldset>";
			}
			a += "\n        </div>\n      </form>";
			let o = this.apiClient;
			return e.wait({
				window: { title: "Sincronizar Compêndio de Itens" },
				content: a,
				actions: {
					toggleGroup: ne,
					toggleItem: re
				},
				buttons: [{
					action: "sync",
					label: "Sincronizar Selecionados",
					icon: "fas fa-sync",
					default: !0,
					callback: async (e, t, n) => {
						let r = n.element.querySelectorAll("input[name=\"pack\"]:checked"), i = Array.from(r).map((e) => e.value);
						if (i.length === 0) {
							ui.notifications.warn("Runarcana Sync: selecione ao menos um compêndio.");
							return;
						}
						await game.settings.set("runarcana-sync", b, i);
						try {
							let e = await h(o, i, (e, t) => {
								ui.notifications.info(`Runarcana Sync: sincronizando lote ${e} de ${t}...`);
							});
							ui.notifications.info(`Runarcana Sync: ${e.totalSynced} itens sincronizados de ${e.packSummaries.length} compêndio(s).`);
						} catch (e) {
							console.error("Runarcana Sync | Erro ao sincronizar compêndio:", e), ui.notifications.error(`Runarcana Sync: erro ao sincronizar compêndio: ${e.message}`);
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
//#region src/data-mapper.js
function ie(e) {
	return e ? Array.isArray(e) ? e.filter(Boolean).map(String) : e instanceof Set ? [...e].filter(Boolean).map(String) : typeof e == "object" ? Object.keys(e).filter((t) => e[t]) : [] : [];
}
function w(e) {
	if (!e) return [];
	let t = ie(e.value ?? (Array.isArray(e) || e instanceof Set ? e : null)), n = typeof e.custom == "string" ? e.custom.split(/[;,\n]/).map((e) => e.trim()).filter(Boolean) : [];
	return [.../* @__PURE__ */ new Set([...t, ...n])];
}
function T(e) {
	try {
		let t = globalThis.dnd5e?.documents?.Trait?.keyLabel?.(e, { trait: "tool" });
		return typeof t == "string" && t ? t : e;
	} catch {
		return e;
	}
}
function E(e) {
	let t = e.system?.tools ?? {}, n = /* @__PURE__ */ new Set(), r = [];
	for (let [e, i] of Object.entries(t)) {
		if ((i?.value ?? 0) <= 0) continue;
		n.add(e);
		let t = typeof i?.total == "number" ? i.total : void 0;
		r.push(t === void 0 ? { label: T(e) } : {
			label: T(e),
			modifier: t
		});
	}
	for (let t of w(e.system?.traits?.toolProf)) n.has(t) || (n.add(t), r.push({ label: T(t) }));
	return r;
}
function ae(e) {
	let t = e.system?.attributes?.senses ?? {}, n = t.ranges ?? {}, r = {};
	for (let e of L) {
		let i = n[e] ?? t[e];
		typeof i == "number" && i > 0 && (r[e] = i);
	}
	return t.units && (r.units = t.units), typeof t.special == "string" && t.special.trim() && (r.special = t.special.trim()), r;
}
function D(e) {
	let t = e.system?.traits ?? {};
	return {
		senses: ae(e),
		damageResistances: w(t.dr),
		damageImmunities: w(t.di),
		damageVulnerabilities: w(t.dv),
		armorProficiencies: w(t.armorProf),
		weaponProficiencies: w(t.weaponProf),
		toolProficiencies: E(e),
		conditionImmunities: w(t.ci),
		languages: w(t.languages)
	};
}
function O(e) {
	return e ? Array.isArray(e) ? e : typeof e.length == "number" || typeof e[Symbol.iterator] == "function" ? [...e] : typeof e == "object" ? Object.values(e) : [] : [];
}
function k(e, t) {
	let n = O(e.itemTypes?.[t]);
	return n.length > 0 ? n : O(e.items?.contents ?? e.items).filter((e) => e?.type === t);
}
function A(e) {
	return e ? typeof e == "string" ? e : e.name || "" : "";
}
function j(e) {
	let t = e?.system?.hd?.denomination ?? e?.system?.hitDice ?? e?.system?.hitDie;
	if (typeof t == "number" && t > 0) return `d${t}`;
	if (typeof t == "string" && t.trim()) {
		let e = t.trim();
		return e.startsWith("d") ? e : `d${e}`;
	}
	return "";
}
function M(e) {
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
function N(e) {
	let t = k(e, "class"), n = O(e.classes), r = /* @__PURE__ */ new Set(), i = [];
	for (let e of [...t, ...n]) {
		let t = e?.id || e?.name;
		t && !r.has(t) && (r.add(t), i.push(e));
	}
	let a = k(e, "race")[0], o = k(e, "background")[0], s = k(e, "subclass")[0], c = M(e), l = e.system?.traits?.size || "";
	return {
		classes: i.map((e) => ({
			name: e.name || "",
			identifier: e.system?.identifier || e.identifier || "",
			levels: Number(e.system?.levels) || 0,
			hitDie: j(e)
		})),
		subclassName: s?.name || "",
		raceName: a?.name || A(e.system?.details?.race),
		backgroundName: o?.name || A(e.system?.details?.background),
		size: l,
		hitDie: i.map(j).find(Boolean) || "",
		hitDiceValue: c.value,
		hitDiceMax: c.max
	};
}
function P(e) {
	return typeof e == "string" ? e.trim() : "";
}
function oe(e) {
	let t = e.system?.details ?? {}, n = {}, r = {}, i = P(t.appearance), a = P(t.age), o = P(t.gender), s = P(t.height), c = P(t.weight), l = P(t.eyes), u = P(t.hair), d = P(t.skin);
	i && (n.appearance = i), a && (n.age = a), o && (n.sex = o), s && (n.height = s), c && (n.weight = c), l && (n.eyes = l), u && (n.hair = u), d && (n.skin = d);
	let f = P(t.alignment), p = P(t.faith), m = P(t.ideal), h = P(t.bond), g = P(t.flaw), _ = P(t.trait), v = P(t.biography?.value);
	return f && (r.alignment = f), p && (r.faith = p), m && (r.ideal = m), h && (r.bond = h), g && (r.flaw = g), _ && (r.trait = _), v && (r.backstory = v), {
		identity: n,
		description: r
	};
}
function se(e) {
	return e >= 2 ? "expertise" : e >= 1 || e >= .5 && "half";
}
function ce(e) {
	return e === "expertise" ? 2 : e === "half" ? .5 : +!!e;
}
var F, I, L, R, z, B = e((() => {
	F = {
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
	}, I = /* @__PURE__ */ new Set(["system.attributes.hp.max", "system.attributes.movement.walk"]), L = [
		"darkvision",
		"blindsight",
		"tremorsense",
		"truesight"
	], R = [
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
	], z = [
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
//#region src/chat-roll.js
function V(e) {
	let t = G[e?.kind] ?? "Rolagem", n = typeof e?.label == "string" ? e.label.trim() : "";
	return n ? `${t} — ${n}` : t;
}
function H(e) {
	let t = `${Math.max(1, Number(e?.diceCount) || 1)}d${Number(e?.dieSize) || 20}`, n = Number(e?.modifier) || 0;
	return n === 0 ? t : `${t} ${n > 0 ? "+" : "-"} ${Math.abs(n)}`;
}
function U(e) {
	return Array.isArray(e?.dice) && e.dice.length > 0 ? e.dice.map((e) => Number(e)).filter((e) => Number.isInteger(e) && e > 0) : (Number(e?.diceCount) || 1) === 1 && Number.isInteger(e?.rawRoll) && e.rawRoll > 0 ? [e.rawRoll] : [];
}
function W(e) {
	return (game.messages?.contents ?? []).some((t) => t.getFlag?.("runarcana-sync", "rollId") === e);
}
function le(e) {
	let t = U(e);
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
async function ue(e, t) {
	if (!e || !t?.id || game.user?.id !== game.users?.activeGM?.id || W(t.id)) return;
	let n = V(t), r = { "runarcana-sync": {
		rollId: t.id,
		kind: t.kind
	} }, i = typeof ChatMessage.getSpeaker == "function" ? ChatMessage.getSpeaker({ actor: e }) : { alias: e.name }, a = `<div class="dice-roll"><div class="dice-result"><h4 class="dice-total">${t.total}</h4><div class="dice-formula">${H(t)}</div></div></div>`;
	try {
		let e = null;
		try {
			e = le(t);
		} catch (e) {
			console.warn("Runarcana Sync | não deu pra montar o Roll do Foundry:", e);
		}
		if (e && typeof e.toMessage == "function") try {
			await e.toMessage({
				speaker: i,
				flavor: n,
				flags: r
			});
			return;
		} catch (e) {
			console.warn("Runarcana Sync | toMessage falhou, publicando HTML no chat:", e);
		}
		await ChatMessage.create({
			speaker: i,
			flavor: n,
			flags: r,
			content: a
		});
	} catch (e) {
		console.error("Runarcana Sync | Falha ao publicar rolagem no chat:", e);
	}
}
var G, de = e((() => {
	G = {
		skill: "Perícia",
		save: "Resistência",
		attack: "Ataque",
		ability: "Atributo",
		"hit-die": "Dado de vida",
		damage: "Dano",
		heal: "Cura"
	};
}));
//#endregion
//#region src/consume-hit-die.js
function fe(e, t) {
	let n = e.system?.attributes?.hd?.classes;
	return !n || typeof n.find != "function" ? null : n.find((e) => e.system?.hd?.denomination === t && e.system?.hd?.value) ?? null;
}
async function pe(e, t) {
	if (!e || t?.kind !== "hit-die" || game.user?.id !== game.users?.activeGM?.id) return;
	let n = e.system?.attributes?.hd;
	if (!n) return;
	let r = `d${Number(t.dieSize) || 0}`, i = {}, a = null, o = null;
	if (e.system?.isNPC) {
		if (!n.value) return;
		i["system.attributes.hd.spent"] = (n.spent ?? 0) + 1;
	} else {
		if (a = fe(e, r), !a) return;
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
		console.error("Runarcana Sync | Falha ao descontar dado de vida no Ator:", e);
	}
}
var me = e((() => {}));
//#endregion
//#region src/sync-manager.js
function K(e, t) {
	let n;
	return function(...r) {
		clearTimeout(n), n = setTimeout(() => e.apply(this, r), t);
	};
}
function q(e) {
	let t = foundry.utils.deepClone(e);
	return delete t._stats, delete t.sort, delete t.ownership, delete t.folder, t.flags && (delete t.flags.core, delete t.flags.exportSource), t;
}
function he(e) {
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
function ge(e) {
	let t = p(e);
	return !t || String(t).includes("mystery-man") || String(t).includes("icons/svg/item-bag") ? "" : t;
}
function _e(e) {
	let t = e.statuses;
	return t ? typeof t.size == "number" ? [...t].map(String) : Array.isArray(t) ? t.map(String) : typeof t == "object" ? Object.keys(t) : [] : [];
}
function J(e) {
	if (typeof e.allApplicableEffects == "function") return [...e.allApplicableEffects()];
	let t = e.effects;
	return t?.contents ?? (Array.isArray(t) ? t : []);
}
function Y(e) {
	return e.type === "enchantment" || e.isAppliedEnchantment === !0;
}
function ve(e) {
	let t = e.duration?.label;
	if (!t) return "";
	let n = String(t).trim();
	return !n || /^(none|nenhum|permanent|permanente|indefinid)/i.test(n) ? "" : n;
}
function ye(e, t) {
	let n = e.parent;
	return n && n !== t && n.name ? n.name : "";
}
function X(e, t) {
	let n = { name: e.name }, r = p(e.img || e.icon);
	r && (n.img = r), e.disabled && (n.disabled = !0), e.isSuppressed && (n.isSuppressed = !0), e.isTemporary && (n.isTemporary = !0);
	let i = _e(e);
	i.length && (n.statuses = i);
	let a = ve(e);
	a && (n.durationLabel = a);
	let o = ye(e, t);
	return o && (n.source = o), n;
}
function Z(e) {
	return J(e).filter((e) => !e.disabled && !e.isSuppressed && e.name && !Y(e)).map((t) => X(t, e)).filter((e) => {
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
function Q(e) {
	return J(e).filter((e) => e?.name && !Y(e)).map((t) => X(t, e));
}
var $, be = e((() => {
	B(), _(), de(), me(), $ = class {
		constructor(e) {
			this.apiClient = e, this.streams = /* @__PURE__ */ new Map(), this.activeSyncs = /* @__PURE__ */ new Set(), this.lastKnownDraft = /* @__PURE__ */ new Map(), this.debouncedActorUpdate = K(this._executeActorUpdate.bind(this), 1e3), this.debouncedItemUpdate = K(this._executeItemUpdate.bind(this), 1e3);
		}
		notifyApiError(e, t, n) {
			console.error(`Runarcana Sync | Falha ao ${e} a ficha ${n?.name || n?.id || "desconhecida"}:`, t), ui.notifications.error(`Runarcana Sync: erro ao ${e} a ficha ${n?.name || n?.id || ""}: ${t?.message || "erro desconhecido"}`);
		}
		async startListening(e) {
			let t = e.getFlag("runarcana-sync", "draftId");
			if (t && !this.streams.has(e.id)) {
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
							await ue(e, t.roll), await pe(e, t.roll);
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
						console.warn("Runarcana Sync | Stream desconectado, tentando reconectar automaticamente:", e);
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
			let n = {};
			for (let [r, i] of Object.entries(F)) {
				if (r.startsWith("system.abilities") || I.has(r)) continue;
				let a = foundry.utils.getProperty(t, i), o = foundry.utils.getProperty(e, r);
				a != null && a !== o && (n[r] = a);
			}
			if (R.forEach(({ foundry: r, firebase: i }) => {
				let a = e.system.abilities?.[r]?.value || 0, o = (foundry.utils.getProperty(t, `attributes.scores.${i}`) || 10) + (foundry.utils.getProperty(t, `attributes.originBonuses.${i}`) || 0);
				a !== o && (n[`system.abilities.${r}.value`] = o);
			}), R.forEach(({ foundry: r, firebase: i }) => {
				let a = foundry.utils.getProperty(t, `proficiencies.savingThrows.${i}`);
				if (a === void 0) return;
				let o = +!!a;
				(e.system.abilities?.[r]?.proficient ?? 0) !== o && (n[`system.abilities.${r}.proficient`] = o);
			}), z.forEach(({ foundry: r, id: i }) => {
				let a = foundry.utils.getProperty(t, `proficiencies.skills.${i}`);
				if (a === void 0) return;
				let o = ce(a);
				(e.system.skills?.[r]?.value ?? 0) !== o && (n[`system.skills.${r}.value`] = o);
			}), Object.keys(n).length > 0 && await e.update(n), t.items && Array.isArray(t.items)) {
				let n = t.items, r = e.items.contents, i = [], a = [], o = [];
				for (let e of n) {
					let t = r.find((t) => t.getFlag("runarcana-sync", "sourceId") === e._id || t.id === e._id), n = he(foundry.utils.deepClone(e));
					if (t) {
						let r = q(t.toObject()), i = q(n);
						if (i._id = r._id, r.flags?.["runarcana-sync"] && delete r.flags["runarcana-sync"], i.flags?.["runarcana-sync"] && delete i.flags["runarcana-sync"], JSON.stringify(r) !== JSON.stringify(i)) {
							let r = n;
							r._id = t.id, foundry.utils.setProperty(r, "flags.runarcana-sync.sourceId", e._id), a.push(r);
						}
					} else {
						let t = n;
						foundry.utils.setProperty(t, "flags.runarcana-sync.sourceId", e._id), delete t._id, i.push(t);
					}
				}
				for (let e of r) {
					let t = e.getFlag("runarcana-sync", "sourceId");
					t && (n.some((e) => e._id === t) || o.push(e.id));
				}
				o.length > 0 && await e.deleteEmbeddedDocuments("Item", o), i.length > 0 && await e.createEmbeddedDocuments("Item", i), a.length > 0 && await e.updateEmbeddedDocuments("Item", a);
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
				r = await f(n);
			} catch (e) {
				console.warn("Runarcana Sync | Falha ao procurar itens de equipamento no compêndio:", e);
				return;
			}
			if (r.size === 0) return;
			let i = e.items.contents, a = [];
			for (let [e, t] of r) {
				if (i.some((t) => t.getFlag("runarcana-sync", "catalogKey") === e)) continue;
				let n = game.packs.get(t.packId), r = n ? await n.getDocument(t.foundryId) : null;
				if (!r) continue;
				let o = r.toObject();
				delete o._id, foundry.utils.setProperty(o, "flags.runarcana-sync.catalogKey", e), a.push(o);
			}
			a.length > 0 && await e.createEmbeddedDocuments("Item", a);
		}
		async handleActorUpdate(e, t) {
			if (this.activeSyncs.has(e.id)) return;
			let n = e.getFlag("runarcana-sync", "draftId");
			n && this.debouncedActorUpdate(e, n);
		}
		_overlayActorOntoDraft(e, t) {
			for (let [n, r] of Object.entries(F)) {
				if (n.startsWith("system.abilities")) continue;
				let i = foundry.utils.getProperty(e, n);
				i !== void 0 && foundry.utils.setProperty(t, r, i);
			}
			R.forEach(({ foundry: n, firebase: r }) => {
				let i = e.system.abilities?.[n]?.value;
				if (i === void 0) return;
				let a = foundry.utils.getProperty(t, `attributes.originBonuses.${r}`) || 0;
				foundry.utils.setProperty(t, `attributes.scores.${r}`, i - a);
			}), R.forEach(({ foundry: n, firebase: r }) => {
				let i = e.system.abilities?.[n]?.proficient;
				i !== void 0 && foundry.utils.setProperty(t, `proficiencies.savingThrows.${r}`, i >= 1);
			}), z.forEach(({ foundry: n, id: r }) => {
				let i = e.system.skills?.[n]?.value;
				i !== void 0 && foundry.utils.setProperty(t, `proficiencies.skills.${r}`, se(i));
			});
			let n = e.system.attributes?.spellcasting;
			if (n) {
				let e = R.find(({ foundry: e }) => e === n);
				e && foundry.utils.setProperty(t, "spellcasting.ability", e.firebase);
			}
			foundry.utils.setProperty(t, "concept.portraitUrl", ge(e.img)), t.conditions = Z(e), t.effects = Q(e), t.traits = D(e), t.foundryIdentity = N(e);
			let r = oe(e);
			t.identity = {
				...t.identity ?? {},
				...r.identity
			}, t.description = {
				...t.description ?? {},
				...r.description
			};
		}
		_overlayItemsOntoDraft(e, t) {
			let n = [];
			for (let t of e.items) try {
				let e = t.toObject();
				e._id = t.getFlag("runarcana-sync", "sourceId") || e._id, e.img = p(e.img);
				let r = q(e);
				[
					"class",
					"subclass",
					"race",
					"background"
				].includes(r.type) && r.system && delete r.system.advancement, n.push(r);
			} catch (e) {
				console.warn(`Runarcana Sync | Não foi possível serializar ${t.name} (${t.type}):`, e), n.push({
					_id: t.getFlag("runarcana-sync", "sourceId") || t.id,
					name: t.name,
					type: t.type,
					img: p(t.img),
					system: t.type === "class" ? { levels: t.system?.levels } : {}
				});
			}
			t.items = n, t.foundryIdentity = N(e), t.conditions = Z(e), t.effects = Q(e);
		}
		async _saveDraftFromActor(e, t, n, r) {
			let i = async () => {
				if (!this.lastKnownDraft.has(e.id)) return console.warn(`Runarcana Sync | Ignorando atualização de ${e.name}: ainda não temos uma cópia da ficha vinda do backend.`), null;
				let r = foundry.utils.deepClone(this.lastKnownDraft.get(e.id));
				return n(e, r), this.apiClient.saveDraft(t, r);
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
				console.warn(`Runarcana Sync | Ignorando atualização de ${e.name}: ainda não temos uma cópia da ficha vinda do backend.`);
				return;
			}
			await this._saveDraftFromActor(e, t, (e, t) => {
				this._overlayActorOntoDraft(e, t);
			}, "salvar");
		}
		async handleItemUpdate(e) {
			if (this.activeSyncs.has(e.id)) return;
			let t = e.getFlag("runarcana-sync", "draftId");
			t && this.debouncedItemUpdate(e, t);
		}
		async _executeItemUpdate(e, t) {
			if (!this.lastKnownDraft.has(e.id)) {
				console.warn(`Runarcana Sync | Ignorando atualização de itens de ${e.name}: ainda não temos uma cópia da ficha vinda do backend.`);
				return;
			}
			await this._saveDraftFromActor(e, t, (e, t) => {
				this._overlayItemsOntoDraft(e, t);
			}, "salvar os itens de");
		}
	};
})), xe = /* @__PURE__ */ t((() => {
	i(), u(), C(), be();
	var e = null, t = null;
	function n(e) {
		let t = game.settings.get("runarcana-sync", e);
		return typeof t == "string" ? t.trim() : "";
	}
	function a() {
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
		new S(a).render();
	}
	async function o(e, n) {
		t?.stopListening(e), await e.unsetFlag("runarcana-sync", "draftId"), ui.notifications.info(n ?? `${e.name}: desvinculado da ficha.`);
	}
	async function c() {
		if (!game.user.isGM) return;
		let e = /* @__PURE__ */ new Map();
		for (let t of game.actors) {
			let n = t.getFlag("runarcana-sync", "draftId");
			n && (e.has(n) || e.set(n, []), e.get(n).push(t));
		}
		for (let t of e.values()) {
			if (t.length <= 1) continue;
			let [e, ...n] = [...t].sort((e, t) => (e._stats?.createdTime ?? 0) - (t._stats?.createdTime ?? 0));
			for (let t of n) await o(t, `Runarcana Sync: ${t.name} estava vinculado à mesma ficha que ${e.name} — desvinculado automaticamente (limpeza de duplicata).`);
		}
	}
	async function d(r) {
		if (!n("mesaKey")) return ui.notifications.warn("Cole a chave da mesa nas configurações do módulo");
		if (!e) return ui.notifications.warn("Configure a URL do backend nas configurações do módulo primeiro.");
		let i = r.getFlag("runarcana-sync", "draftId");
		if (i) {
			let { DialogV2: e } = foundry.applications.api;
			if (!await e.confirm({
				window: { title: "Ator já vinculado" },
				content: `<p><strong>${r.name}</strong> já está vinculado à ficha <code>${i}</code>.</p>
        <p>Desvincular agora para escolher outra ficha? A sincronização com a ficha atual para.</p>`,
				yes: { label: "Desvincular" },
				no: { label: "Cancelar" }
			})) return;
			await o(r);
		}
		new l(e, r, t).render(!0);
	}
	var f = class extends FormApplication {
		constructor() {
			super({});
		}
		render() {
			return a(), this;
		}
		async _updateObject() {}
	};
	Hooks.once("init", () => {
		game.settings.register("runarcana-sync", "mesaKey", {
			name: "Chave da mesa",
			hint: "Gerada no site, na página da mesa. Cole aqui.",
			scope: "world",
			config: !0,
			type: String,
			default: "",
			requiresReload: !0
		}), game.settings.register("runarcana-sync", "compendiumSyncKey", {
			name: "Chave de Sincronização de Compêndio",
			hint: "Só para enviar itens ao catálogo compartilhado do site (COMPENDIUM_SYNC_KEY). Não é a chave da mesa nem login. Deixe em branco e use só a Chave da mesa (acima) para sincronizar homebrew restrito à sua mesa, em vez do catálogo público.",
			scope: "world",
			config: !0,
			type: String,
			default: ""
		}), game.settings.register("runarcana-sync", "compendiumSyncSelection", {
			scope: "world",
			config: !1,
			type: Array,
			default: []
		}), game.settings.registerMenu("runarcana-sync", "compendiumSyncMenu", {
			name: "Sincronizar Compêndio de Itens",
			label: "Abrir Sincronização",
			hint: "Escolhe quais compêndios de itens do mundo sincronizar com o backend, pra alimentar o seletor de equipamento do site.",
			icon: "fas fa-box-open",
			type: f,
			restricted: !0
		}), game.settings.register("runarcana-sync", "backendUrl", {
			name: "URL do Backend Runarcana",
			hint: "URL base do runarcana-api. Só altere se estiver hospedando o backend por conta própria.",
			scope: "world",
			config: !0,
			type: String,
			default: "https://api.runarcana.org",
			requiresReload: !0
		});
	}), Hooks.once("ready", async () => {
		let i = game.modules.get("runarcana-sync");
		i && (i.api = { openCompendiumSync: a });
		let o = n("mesaKey"), s = n("backendUrl");
		if (!o) {
			console.warn("Runarcana Sync | Chave da mesa não configurada nas configurações do módulo.");
			return;
		}
		if (!s) {
			console.warn("Runarcana Sync | URL do backend não configurada nas configurações do módulo.");
			return;
		}
		e = new r({
			mesaKey: o,
			baseUrl: s,
			syncKey: n("compendiumSyncKey")
		}), t = new $(e), await c(), game.actors.forEach((e) => t.startListening(e)), console.log("Runarcana Sync | Backend configurado e ouvindo atores vinculados."), i && (i.api.apiClient = e, i.api.syncManager = t);
	}), Hooks.on("updateActor", (e, n, r, i) => {
		i === game.user.id && t && t.handleActorUpdate(e, n);
	}), Hooks.on("createActor", (e, t, n) => {
		if (n !== game.user.id) return;
		let r = e.getFlag("runarcana-sync", "draftId");
		r && s(game.actors, e.id).has(r) && (e.unsetFlag("runarcana-sync", "draftId"), ui.notifications.warn(`Runarcana Sync: ${e.name} veio com um vínculo herdado (provavelmente de uma duplicação) de uma ficha já vinculada a outro Ator — desvinculado automaticamente.`));
	}), Hooks.on("deleteActor", (e, n, r) => {
		r === game.user.id && t && t.stopListening(e);
	}), Hooks.on("createItem", (e, n, r) => {
		r === game.user.id && t && e.parent && t.handleItemUpdate(e.parent);
	}), Hooks.on("updateItem", (e, n, r, i) => {
		i === game.user.id && t && e.parent && t.handleItemUpdate(e.parent);
	}), Hooks.on("deleteItem", (e, n, r) => {
		r === game.user.id && t && e.parent && t.handleItemUpdate(e.parent);
	});
	function p(e) {
		let t = e?.parent;
		return t ? t.documentName === "Actor" ? t : t.documentName === "Item" && t.parent?.documentName === "Actor" ? t.parent : null : null;
	}
	Hooks.on("createActiveEffect", (e, n, r) => {
		if (r !== game.user.id || !t) return;
		let i = p(e);
		i && t.handleActorUpdate(i, {});
	}), Hooks.on("updateActiveEffect", (e, n, r, i) => {
		if (i !== game.user.id || !t) return;
		let a = p(e);
		a && t.handleActorUpdate(a, n);
	}), Hooks.on("deleteActiveEffect", (e, n, r) => {
		if (r !== game.user.id || !t) return;
		let i = p(e);
		i && t.handleActorUpdate(i, {});
	}), Hooks.on("getActorSheetHeaderButtons", (e, t) => {
		let n = e.object;
		if (!n || n.documentName !== "Actor") return;
		let r = !!n.getFlag("runarcana-sync", "draftId");
		t.unshift({
			class: "runarcana-sync-btn",
			icon: "fas fa-sync",
			label: r ? "Runarcana (Vinculado)" : "Runarcana Sync",
			onclick: () => d(n)
		});
	}), Hooks.on("getHeaderControlsActorSheetV2", (e, t) => {
		let n = e.document;
		if (!n || n.documentName !== "Actor") return;
		let r = !!n.getFlag("runarcana-sync", "draftId");
		t.unshift({
			action: "runarcana-sync",
			icon: "fas fa-sync",
			label: r ? "Runarcana (Vinculado)" : "Runarcana Sync",
			class: "runarcana-sync-btn",
			onClick: () => d(n)
		});
	});
}));
//#endregion
export default xe();
