// ==UserScript==
// @name         PokeIdle — Analisador de Party e Depot
// @namespace    codex.local/pokeidle-analyzer
// @version      1.10.1
// @updateURL    https://raw.githubusercontent.com/M0abl1/pokeidlem0abl1/main/pokeidle-party-depot-analyzer.user.js
// @downloadURL  https://raw.githubusercontent.com/M0abl1/pokeidlem0abl1/main/pokeidle-party-depot-analyzer.user.js
// @description  Analisa Party/Depot, protege Coleção, troca hunts medidas e automatiza a captura manual por conta.
// @author       Codex
// @match        https://poke.idleworld.online/*
// @match        https://*.poke.idleworld.online/*
// @match        https://pokeidle.io/app*
// @match        https://www.pokeidle.io/app*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const APP_ID = 'piw-party-depot-analyzer';
  const DB_KEY = `${APP_ID}:history:v1`;
  const PREF_KEY = `${APP_ID}:prefs:v1`;
  const MAX_HISTORY = 2500;
  const P_BONUS = Object.freeze({ P1: 0, P2: 0.05, P3: 0.10, P4: 0.25, P5: 1.00 });
  const IV_KEYS = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'spd'];
  const state = {
    records: new Map(),
    socketRecords: [],
    open: false,
    filterSpecies: '',
    filterOrigin: 'ALL',
    search: '',
    inventoryCalculation:false, inventoryResults:[], inventoryStatus:'',
    lastScanAt: 0,
    scanTimer: 0,
    observer: null,
    renderPending: false,
    hunts: new Map(), creatures: new Map(), liveParty: [], hasLiveParty: false,
    farmPokemon: '', farmGoal: 'safe', trainerLevel: null, attackType: '',
    farmStatus: 'Abra o mapa e a Party, ou clique em Carregar hunts.', farmLoading: false,
    collectionRunning: false, collectionStop: false,
    evaluating:false, evaluationStop:false, activePokemon:null, activeSignature:'',
    evaluationCache: {}, protectScore:9, combatCache:new Map(),
    ioRaw:new Map(), ioFields:{}, ioCatalog:new Map(), ioHunts:[], ioModules:null,
    autoCollection:true, farmAlerts:true, alertThreshold:15, autoTimer:0,
    ioSocket:null, ioComplete:false, collectionPending:null, autoError:'',
    collectionBlocked:new Set(), alertTimes:{}, lastAlert:'',
    autoHunts:false, xpPriority:50, farmSamples:new Map(), sampleKey:'', measuringSlug:'',
    huntPending:null, lastHuntChange:Date.now(), lastCombat:Date.now(), huntPauseUntil:0, huntStatus:'Aguardando medições reais.',
    autoCapture:false, ballCatalog:[], captureMobs:new Map(), captureScene:'', capturePending:null,
    captureTimer:0, captureLastThrow:0, captureStatus:'Captura pausada.',
    captureInflight:new Map(),
  };

  const SELECTORS = Object.freeze({
    partyRoots: [
      '[data-guide="party"]', '[data-guide*="party" i]', '.phud-party',
      '[class*="party-list" i]', '[class*="team-list" i]', '[data-tab="party"]'
    ],
    depotRoots: [
      '[data-guide="depot"]', '[data-guide*="depot" i]', '[class*="depot" i]',
      '[class*="pokemon-box" i]', '[class*="poke-box" i]', '[data-tab="pokemon"]'
    ],
    cards: [
      '[data-pokemon-id]', '[data-poke-id]', '[data-species]', '.phud-mon',
      '[class*="pokemon-card" i]', '[class*="poke-card" i]', '[class*="pokemon-row" i]'
    ],
    details: [
      '[role="dialog"]', '[aria-modal="true"]', '[class*="pokemon-detail" i]',
      '[class*="poke-detail" i]', '[class*="pokemon-info" i]', '[class*="poke-info" i]'
    ],
  });

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const normText = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const fold = value => normText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value == null || value === '') return null;
    let s = String(value).trim().replace(/\s/g, '');
    if (/^-?\d{1,3}(?:\.\d{3})*,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    else if (/^-?\d{1,3}(?:[.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
    else s = s.replace(/,/g, '');
    const n = Number(s.replace(/[^\d.+-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const pick = (...values) => values.find(v => v !== undefined && v !== null && v !== '');
  const keyOf = p => String(p.id || `${fold(p.species)}|${p.origin}|${p.level ?? '?'}|${p.quality ?? '?'}|${p.ivTotal ?? '?'}|${IV_KEYS.map(k => p.ivs[k] ?? '?').join('-')}`);
  const loadJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const saveJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { console.warn(`[${APP_ID}] Não foi possível salvar:`, error); } };

  function normalizedQuality(value) {
    const q = num(value);
    if (q == null) return null;
    return q > 10 ? q / 1000 : q;
  }

  function normalizeP(value) {
    const match = String(value ?? '').toUpperCase().match(/\bP\s*([1-5])\b/);
    return match ? `P${match[1]}` : null;
  }

  function objectValue(obj, paths) {
    for (const path of paths) {
      let cur = obj;
      for (const part of path.split('.')) cur = cur?.[part];
      if (cur !== undefined && cur !== null) return cur;
    }
    return null;
  }

  function normalizePokemon(raw, originHint = 'DEPOT', source = 'DOM') {
    if (!raw || typeof raw !== 'object') return null;
    const stats = pick(raw.ivs, raw.iv, raw.stats?.ivs, raw.stats, {}) || {};
    const species = normText(pick(raw.species, raw.nome, raw.name, raw.pokemonName, raw.pokeName, raw.title));
    if (!species || /^(party|equipe|team|depot|box|pokemon|pokémon)$/i.test(species)) return null;
    const ivs = {
      hp: num(pick(stats.hp, stats.HP, raw.ivHp, raw.hpIv)),
      atk: num(pick(stats.atk, stats.attack, stats.ATK, raw.ivAtk, raw.attackIv)),
      def: num(pick(stats.def, stats.defense, stats.DEF, raw.ivDef, raw.defenseIv)),
      spAtk: num(pick(stats.spAtk, stats.spatk, stats.specialAttack, stats['SP.ATK'], raw.ivSpAtk)),
      spDef: num(pick(stats.spDef, stats.spdef, stats.specialDefense, stats['SP.DEF'], raw.ivSpDef)),
      spd: num(pick(stats.spd, stats.speed, stats.SPD, raw.ivSpeed, raw.speedIv)),
    };
    let ivTotal = num(pick(raw.ivTotal, raw.totalIv, raw.totalIV, raw.growth));
    if (ivTotal == null && IV_KEYS.every(k => ivs[k] != null)) ivTotal = IV_KEYS.reduce((sum, k) => sum + ivs[k], 0);
    let types = pick(raw.types, raw.tipos, raw.type, [raw.type1, raw.type2]);
    if (!Array.isArray(types)) types = String(types || '').split(/[,/|]/);
    types = [...new Set(types.map(normText).filter(Boolean))].slice(0, 2);
    const teamFlag = pick(raw.team, raw.inTeam, raw.party);
    const origin = teamFlag === true ? 'PARTY' : (teamFlag === false ? 'DEPOT' : originHint);
    const p = normalizeP(pick(raw.p, raw.pTier, raw.potential, raw.rank, raw.potencia ? `P${raw.potencia}` : null));
    const record = {
      id: pick(raw.id, raw._id, raw.pokeId, raw.pokemonId, raw.uid),
      species, level: num(pick(raw.level, raw.lvl)), types, p,
      quality: normalizedQuality(pick(raw.quality, raw.qualityMultiplier, raw.q)),
      ivTotal, power: num(pick(raw.power, raw.poder, raw.combatPower, raw.cp)),
      combatHp: num(pick(raw.combatHp, raw.currentHp, raw.hpCurrent, raw.battleHp, raw.hp)),
      n: num(pick(raw.n, raw.N, raw.nValue)), ivs, origin, source,
      leader: Boolean(raw.leader), slot: num(raw.slot),
      moves:Array.isArray(raw.moves) ? raw.moves : [], combatStats:raw.combatStats || raw.stats || {}, gameScore:num(raw.gameScore),
      shiny: Boolean(raw.shiny || raw.isShiny),
      capturedAt: new Date().toISOString(),
    };
    return enrich(record);
  }

  function textField(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  function parseTextBlock(input, originHint = 'MANUAL') {
    const text = normText(input.replace(/[•;]/g, ' · '));
    if (!text) return [];
    const chunks = input.split(/\n\s*(?=(?:Shiny\s+)?[A-ZÀ-Ú][\wÀ-ÿ.' -]{1,35}\s*(?:\/|[-—]|Nv|Lv))/i).filter(s => s.trim());
    return chunks.map(chunk => {
      const clean = normText(chunk);
      const species = normText(textField(clean, [
        /^(?:#\d+\s*)?((?:Shiny\s+)?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.' -]*?)(?=\s*(?:\/|[-—]|·|\||Nv\.?|Lv\.?|Nível|Level)\s*)/i,
        /(?:Espécie|Species|Pokémon)\s*[:=-]\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.' -]+)/i,
      ]));
      const raw = {
        species,
        level: textField(clean, [/(?:Nv\.?|Nível|Lv\.?|Level)\s*[:=-]?\s*(\d+)/i]),
        p: textField(clean, [/\b(P\s*[1-5])\b/i]),
        quality: textField(clean, [/(?:Qualidade|Quality|\bQ)\s*[:=×x-]?\s*([\d.,]+)/i]),
        ivTotal: textField(clean, [/(?:IV\s*(?:Total|somado)?|Total\s*IV)\s*[:=-]?\s*(\d{1,3})/i]),
        power: textField(clean, [/(?:Poder|Power)\s*[:=-]?\s*([\d.,]+)/i]),
        combatHp: textField(clean, [/(?:HP\s*(?:de\s*combate|combate|atual)|Combat\s*HP)\s*[:=-]?\s*([\d.,]+)/i]),
        n: textField(clean, [/\bN\s*[:=-]\s*([\d.,]+)/i]),
        types: (textField(clean, [/(?:Tipos?|Types?)\s*[:=-]\s*([A-Za-zÀ-ÿ /,|-]+)/i]) || '').split(/[,/|]/),
        ivs: {
          hp: textField(clean, [/(?:IV\s*)?HP\s*[:=-]?\s*(\d{1,2})/i]),
          atk: textField(clean, [/(?:IV\s*)?(?:ATK|Ataque)(?!\s*Esp)\s*[:=-]?\s*(\d{1,2})/i]),
          def: textField(clean, [/(?:IV\s*)?(?:DEF|Defesa)(?!\s*Esp)\s*[:=-]?\s*(\d{1,2})/i]),
          spAtk: textField(clean, [/(?:SP\.?\s*ATK|SpAtk|Ataque\s*Especial)\s*[:=-]?\s*(\d{1,2})/i]),
          spDef: textField(clean, [/(?:SP\.?\s*DEF|SpDef|Defesa\s*Especial)\s*[:=-]?\s*(\d{1,2})/i]),
          spd: textField(clean, [/(?:SPD|Speed|Velocidade)\s*[:=-]?\s*(\d{1,2})/i]),
        },
      };
      return normalizePokemon(raw, originHint, 'MANUAL');
    }).filter(Boolean);
  }

  function extractJsonCandidates(node) {
    const out = [];
    for (const attr of ['data-pokemon', 'data-poke', 'data-record', 'data-json']) {
      const value = node.getAttribute?.(attr);
      if (!value) continue;
      try { out.push(JSON.parse(value)); } catch { /* texto será lido abaixo */ }
    }
    if (node.dataset) {
      const d = node.dataset;
      if (d.pokemonId || d.pokeId || d.species) out.push({ ...d });
    }
    return out;
  }

  function parseCard(card, origin) {
    for (const candidate of extractJsonCandidates(card)) {
      const parsed = normalizePokemon(candidate, origin, 'DOM');
      if (parsed) {
        const textParsed = parseTextBlock(card.innerText || card.textContent || '', origin)[0];
        return enrich(mergeRecords(parsed, textParsed));
      }
    }
    return parseTextBlock(card.innerText || card.textContent || '', origin)[0] || null;
  }

  // Adapter for the actual IO Depot: cards contain compact P/IV/Q/N badges.
  function parseIOCard(card, origin = 'DEPOT') {
    const text = normText(card.innerText || card.textContent);
    const name = text.match(/^(.+?)\s*Nv\s*(\d+)/i);
    if (!name || (text.match(/\bNv\s*\d+/gi) || []).length !== 1) return null;
    const p = text.match(/\bP([1-5])\b/i);
    const iv = text.match(/\bIV\s*(?:somado|total)?\s*[:=]?\s*(\d{1,3})/i);
    const q = text.match(/(?:\bQ|qualidade)\s*[:=]?\s*([\d.,]+)/i);
    if (!p || !iv || !q) return null;
    const raw = { id:card.dataset?.chave || card.dataset?.pokemonId || card.dataset?.pokeId, species:name[1], level:name[2], p:`P${p[1]}`, quality:q[1], ivTotal:iv[1],
      power:textField(text, [/poder\s*[⚔:]?\s*([\d.,]+)/i]),
      n:textField(text, [/\bN\s*[:=]?\s*([\d.,]+)/i]), types:[], ivs:{} };
    for (const type of Object.keys(TYPE_CHART)) if (text.toUpperCase().includes(type.toUpperCase())) raw.types.push(type);
    for (const [key, label] of Object.entries({hp:'HP',atk:'ATK',def:'DEF',spAtk:'SP\\.?\\s*ATK',spDef:'SP\\.?\\s*DEF',spd:'SPD'})) {
      const match = text.match(new RegExp(`(?:^|[^A-Z.])${label}\\s*\\d+\\s*IV\\s*(\\d{1,2})`, 'i'));
      raw.ivs[key] = match ? match[1] : null;
    }
    return normalizePokemon(raw, origin, 'IO-DOM');
  }

  function readCombatDetails(p, node) {
    const text = normText(node.innerText || node.textContent);
    p.combatStats = {};
    for (const [key,label] of Object.entries({hp:'HP',atk:'ATK',def:'DEF',spAtk:'SP\\.?\\s*ATK',spDef:'SP\\.?\\s*DEF',spd:'SPD'})) {
      const match = text.match(new RegExp(`(?:^|[^A-Z.])${label}\\s*[:=]?\\s*(\\d+)\\s*IV\\s*(\\d{1,2})`, 'i'));
      if (match) { p.combatStats[key] = Number(match[1]); p.ivs[key] = Number(match[2]); }
    }
    p.combatHp = num(textField(text, [/HP de combate\s*[:=]?\s*([\d.,]+)/i])) ?? p.combatHp;
    p.moves = [];
    node.querySelectorAll('[data-move], [data-move-id], .golpe-card, .move-card, .fi-golpe').forEach(move => {
      const d = move.dataset;
      const t = normText(move.innerText || move.textContent);
      const types = creatureTypes({type:d.type || textField(t,[/(?:tipo|type)\s*[:=]\s*([a-z]+)/i])});
      const category = fold(d.category || textField(t,[/(fisico|físico|especial|physical|special)/i]) || '');
      const cooldown = num(d.cooldown || textField(t,[/(?:cooldown|recarga|CD)\s*[:=]?\s*([\d.,]+)\s*s/i]));
      const damage = num(d.damage || textField(t,[/(?:dano|damage)\s*[:=]?\s*([\d.,]+)/i]));
      const power = num(d.power || textField(t,[/(?:poder|power)\s*[:=]?\s*([\d.,]+)/i]));
      if (d.equipped === 'false' || move.classList.contains('unequipped')) return;
      if (types.length && cooldown > 0 && (damage > 0 || power > 0)) p.moves.push({name:d.name || t,type:types[0],category,cooldown,damage,power});
    });
    return enrich(p);
  }

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(read, ms = 3500) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const result = read(); if (result) return result; await pause(120); }
    throw new Error('A interface não respondeu a tempo.');
  }
  function ownMarketCards() { return [...document.querySelectorAll('.mk-grade .mk-card[data-chave]')]; }
  async function openEvaluationMarket() {
    if (!ownMarketCards().length) {
      const market = document.querySelector('button[data-modal="market"], [data-i18n="menu.market"]');
      if (!market) throw new Error('Botão do Market não encontrado. Abra Venda Pokémons.');
      market.click();
      await waitFor(() => document.querySelector('.mk-aba[data-aba="pokemons"]'));
      document.querySelector('.mk-aba[data-aba="pokemons"]').click();
    }
    return waitFor(() => ownMarketCards().length ? ownMarketCards() : null);
  }
  function addEvaluationBadges() {
    for (const card of ownMarketCards()) {
      const cached = state.evaluationCache[card.dataset.chave];
      if (!cached) continue;
      let badge = card.querySelector('.pa-native-score');
      const text = `${cached.score >= state.protectScore ? '★ ' : ''}Nota do jogo ${fmt(cached.score,3)}/10`;
      if (!badge) { badge = document.createElement('small'); badge.className = 'pa-native-score'; card.appendChild(badge); }
      if (badge.textContent !== text) badge.textContent = text;
    }
  }
  async function evaluateAutomatic() {
    if (state.evaluating || state.collectionRunning) return;
    state.evaluating = true; state.evaluationStop = false;
    let count = 0;
    const processed = new Set();
    try {
      while (!state.evaluationStop) {
        const cards = await openEvaluationMarket();
        const card = cards.find(c => !processed.has(c.dataset.chave)
          && state.evaluationCache[c.dataset.chave]?.signature !== normText(c.querySelector('.mk-sub')?.textContent));
        if (!card) break;
        const id = card.dataset.chave;
        if (cards.filter(c => c.dataset.chave === id).length !== 1) throw new Error('Identificador duplicado.');
        processed.add(id);
        const signature = normText(card.querySelector('.mk-sub')?.textContent);
        const name = normText(card.querySelector('.mk-nome')?.textContent);
        const info = card.querySelector('.mk-ficha-btn, button[title*="ficha" i]');
        if (!info) continue;
        if (document.querySelector('#fi-calc')) throw new Error('Feche a ficha aberta antes de iniciar a avaliação.');
        info.click();
        const calc = await waitFor(() => document.querySelector('#fi-calc, button.fi-calc, .fi-calc'));
        const ficha = calc.closest('[role="dialog"], .modal, .fi-modal, #modal-ficha, .ficha') || calc.parentElement;
        const detail = parseIOCard(ficha, 'MANUAL') || parseTextBlock(ficha.innerText || ficha.textContent,'MANUAL')[0];
        if (!detail || creatureKey(detail.species) !== creatureKey(name.replace(/Nv\s*\d+.*/i,''))) throw new Error('Não foi possível confirmar a identidade da ficha.');
        readCombatDetails(detail,ficha);
        state.combatCache.set(collectionFingerprint(detail), {moves:detail.moves,combatStats:detail.combatStats});
        calc.click();
        const scoreEl = await waitFor(() => document.querySelector('#calc-valor, .calc-nota-valor b'));
        const score = num(scoreEl.textContent);
        if (score == null || score < 0 || score > 10) throw new Error('Nota da calculadora inválida.');
        detail.gameScore = score;
        addRecords([detail]);
        const close = [...ficha.querySelectorAll('button')].filter(b => /^(fechar|close|×|✕|x)$/i.test(normText(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent)));
        if (close.length !== 1) throw new Error('Ficha lida. Feche a janela manualmente; botão de fechar ambíguo.');
        close[0].click();
        await waitFor(() => !calc.isConnected || !calc.getClientRects().length);
        const refreshed = await openEvaluationMarket();
        const current = refreshed.filter(c => c.dataset.chave === id);
        if (current.length !== 1) throw new Error('A lista mudou durante a avaliação.');
        if (score >= state.protectScore) {
          const lock = current[0].querySelector('.mk-cadeado');
          if (lock && !current[0].classList.contains('mk-travado') && !lock.classList.contains('on')) {
            lock.click();
            await waitFor(() => current[0].classList.contains('mk-travado') || lock.classList.contains('on'));
          }
        }
        state.evaluationCache[id] = {score,signature,species:detail.species,at:new Date().toISOString()};
        saveJSON(`${APP_ID}:evaluation:v1`, state.evaluationCache);
        count++; addEvaluationBadges(); updateStatus(`${count} ficha(s) avaliada(s).`);
      }
      updateStatus(`Avaliação encerrada: ${count} novas fichas. Notas do jogo salvas; proteção a partir de ${state.protectScore}/10.`);
    } catch (e) { updateStatus(`Avaliação parada: ${e.message}`); }
    finally { state.evaluating = false; scheduleScan(); }
  }

  function readActivePokemon() {
    if (state.ioRaw.size) return;
    const node = document.querySelector('#ativo-card, .ativo-card');
    if (!node) { state.activePokemon = null; return; }
    const p = parseIOCard(node,'PARTY') || parseTextBlock(node.innerText || node.textContent,'PARTY')[0];
    if (!p) { state.activePokemon = null; return; }
    readCombatDetails(p,node);
    const cached = state.combatCache.get(collectionFingerprint(p));
    if (cached && !p.moves.length) p.moves = cached.moves || [];
    if (cached && !Object.keys(p.combatStats).length) p.combatStats = cached.combatStats || {};
    const saved = [...state.records.values()].filter(r => creatureKey(r.species) === creatureKey(p.species)
      && r.level === p.level && (p.quality == null || r.quality === p.quality));
    if (saved.length === 1) {
      if (!p.moves.length) p.moves = saved[0].moves || [];
      if (!Object.keys(p.combatStats).length) p.combatStats = saved[0].combatStats || {};
      p.types = p.types.length ? p.types : saved[0].types;
    }
    state.activePokemon = p;
  }

  function ioCards() {
    if (!/(^|\.)pokeidle\.io$/.test(location.hostname)) return [];
    const nodes = new Set();
    // Start at visible compact badges, then find the smallest ancestor holding
    // a single complete Pokémon. Never infer an action from a screen coordinate.
    document.querySelectorAll('span,small,b,strong,div').forEach(badge => {
      if (badge.closest(`#${APP_ID}-host`) || !/^IV\s*\d{1,3}(?:\/192)?$/i.test(normText(badge.textContent))) return;
      let node = badge.parentElement;
      for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
        if (!node.getClientRects().length) continue;
        const p = parseIOCard(node);
        if (p) { nodes.add(node); break; }
      }
    });
    return [...nodes].map(card => {
      // Ascend only while still containing the same single Pokémon to include
      // hover action controls alongside the badges.
      while (card.parentElement && parseIOCard(card.parentElement)
        && collectionFingerprint(parseIOCard(card.parentElement)) === collectionFingerprint(parseIOCard(card))
        && !card.parentElement.closest(`#${APP_ID}-host`)) card = card.parentElement;
      const ownText = fold(card.innerText || card.textContent);
      let origin = 'DEPOT';
      for (let parent = card.parentElement, depth = 0; parent && depth < 5; parent = parent.parentElement, depth++) {
        const text = fold(parent.innerText || parent.textContent);
        if (/^(equipe|party|team)\b/.test(text) && !text.includes('depot')) { origin = 'PARTY'; break; }
      }
      return {card, p:parseIOCard(card, origin), ownText};
    }).filter((entry, i, all) => entry.p && all.findIndex(e => e.card === entry.card) === i);
  }

  function collectionLabel(button) {
    return fold([button.getAttribute('title'),button.getAttribute('aria-label'),button.getAttribute('data-tooltip'),button.textContent].filter(Boolean).join(' '));
  }
  function collectionAction(card) {
    const buttons = [...card.querySelectorAll('button,[role="button"]')].filter(b => {
      const label = collectionLabel(b);
      return /enviar para (?:a )?colecao/.test(label) && !/vender|ofertar|retirar|voltar/.test(label)
        && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
    });
    return buttons.length === 1 ? buttons[0] : null;
  }
  function collectionFingerprint(p) {
    return [creatureKey(p.species),p.level,p.p,p.quality,p.ivTotal,p.power,p.n].join('|');
  }
  function collectionPlan(entries = ioCards()) {
    const groups = new Map();
    for (const entry of entries) {
      const key = creatureKey(entry.p.species);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const plan = [];
    for (const group of groups.values()) {
      // Avoid comparing mixed missing role IVs: collection uses the same known
      // inputs for everyone (quality strongly weighted, total IV and P).
      const geneticScore = p => p.quality * (1 + (P_BONUS[p.p] || 0)) ** .25 * (1 + p.ivTotal / 192 * .25);
      group.sort((a,b) => geneticScore(b.p) - geneticScore(a.p));
      const best = group[0];
      const unique = group.filter(e => collectionFingerprint(e.p) === collectionFingerprint(best.p)).length === 1;
      const tied = group.length > 1 && Math.abs(geneticScore(group[1].p) - geneticScore(best.p)) < .00001;
      if (unique && !tied && best.p.origin === 'DEPOT' && collectionAction(best.card)) plan.push(best);
    }
    return plan;
  }
  async function sendBestToCollection() {
    if (state.collectionRunning || state.evaluating) return;
    const plan = collectionPlan();
    if (!plan.length) { updateStatus('Nenhum envio seguro disponível. Abra Depot; a seta precisa ter o rótulo Enviar para a Coleção. Empates não são enviados.'); return; }
    const summary = plan.map(e => `${e.p.species} Nv${e.p.level} ${e.p.p} Q${e.p.quality} IV${e.p.ivTotal}`).join('\n');
    if (!confirm(`Enviar estes ${plan.length} melhores lidos no Depot para a Coleção?\n\n${summary}\n\nA comparação cobre apenas os cards carregados. Revise o Depot inteiro antes de iniciar. Party e Coleção não serão movidas.`)) return;
    state.collectionRunning = true; state.collectionStop = false;
    let moved = 0;
    try {
      for (const original of plan) {
        if (state.collectionStop) break;
        const fresh = ioCards();
        const matches = fresh.filter(e => collectionFingerprint(e.p) === collectionFingerprint(original.p));
        const stillBest = collectionPlan(fresh).some(e => collectionFingerprint(e.p) === collectionFingerprint(original.p));
        if (matches.length !== 1 || !stillBest || !matches[0].card.isConnected) throw new Error('A lista mudou ou o Pokémon não é identificável de forma única.');
        const card = matches[0].card;
        const button = collectionAction(card);
        if (!button) throw new Error('Seta de Coleção indisponível.');
        button.click();
        // One click only. Never approve another dialog or retry an uncertain move.
        const deadline = Date.now() + 4500;
        let verified = false;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 200));
          if (!card.isConnected || [...card.querySelectorAll('button,[role="button"]')].some(b => /(?:enviar|voltar|retornar) (?:para |ao )?(?:o )?depot/.test(collectionLabel(b)))) { verified = true; break; }
        }
        if (!verified) throw new Error('O jogo não confirmou a atualização do card. Confira o resultado no Depot/Coleção antes de continuar.');
        moved++;
      }
      updateStatus(`${moved} envio(s) com atualização do card observada. Confira a aba Coleção.${state.collectionStop ? ' Lote interrompido.' : ''}`);
    } catch (error) { updateStatus(`Lote parado após ${moved} envio(s): ${error.message}`); }
    finally { state.collectionRunning = false; scheduleScan(); }
  }

  function mergeRecords(a, b) {
    if (!a) return b;
    if (!b) return a;
    const merged = { ...a };
    for (const field of ['id', 'species', 'level', 'p', 'quality', 'ivTotal', 'power', 'combatHp', 'n']) {
      if (merged[field] == null || merged[field] === '') merged[field] = b[field];
    }
    if (!merged.types?.length) merged.types = b.types || [];
    for (const field of ['moves','combatStats','gameScore']) if (merged[field] == null) merged[field] = b[field];
    merged.ivs = { ...b.ivs, ...Object.fromEntries(Object.entries(a.ivs || {}).filter(([, v]) => v != null)) };
    return merged;
  }

  function inferProfile(p) {
    const v = p.ivs;
    const known = IV_KEYS.filter(k => v[k] != null);
    if (!known.length) return 'INDEFINIDO';
    const physical = (v.atk ?? 0) + (v.def ?? 0) * 0.25;
    const special = (v.spAtk ?? 0) + (v.spDef ?? 0) * 0.25;
    const tank = (v.hp ?? 0) + (v.def ?? 0) + (v.spDef ?? 0);
    const fast = (v.spd ?? 0) * 2.35;
    const candidates = [
      ['FÍSICO', physical], ['ESPECIAL', special], ['TANK', tank / 2], ['RÁPIDO', fast]
    ].sort((a, b) => b[1] - a[1]);
    const first = candidates[0];
    const second = candidates[1];
    return second[1] >= first[1] * 0.88 ? `${first[0]}/${second[0]}` : first[0];
  }

  function scorePokemon(p) {
    const q = p.quality == null ? 0.8 : p.quality;
    const qMax = q > 1.8 || p.shiny ? 4 : 1.8;
    const qualityScore = clamp((q - 0.8) / (qMax - 0.8), 0, 1) * 55;
    const ivTotal = p.ivTotal ?? IV_KEYS.reduce((sum, k) => sum + (p.ivs[k] ?? 0), 0);
    const ivScore = clamp(ivTotal / 192, 0, 1) * 20;
    const pScore = (P_BONUS[p.p] ?? 0) / P_BONUS.P5 * 10;
    const profile = inferProfile(p);
    const v = p.ivs;
    let relevant;
    if (profile.startsWith('ESPECIAL')) relevant = [v.spAtk, v.spDef, v.spd];
    else if (profile.startsWith('TANK')) relevant = [v.hp, v.def, v.spDef];
    else if (profile.startsWith('RÁPIDO')) relevant = [v.spd, v.atk, v.spAtk];
    else relevant = [v.atk, v.def, v.spd];
    const known = relevant.filter(x => x != null);
    const roleScore = known.length ? (known.reduce((a, b) => a + b, 0) / (known.length * 32)) * 15 : 0;
    return Math.round((qualityScore + ivScore + pScore + roleScore) * 10) / 10;
  }

  function enrich(p) {
    if (!p) return null;
    p.profile = inferProfile(p);
    p.score = scorePokemon(p);
    const values = IV_KEYS.filter(k => p.ivs[k] != null).map(k => [k, p.ivs[k]]).sort((a, b) => b[1] - a[1]);
    const label = { hp: 'HP', atk: 'ATK', def: 'DEF', spAtk: 'SP.ATK', spDef: 'SP.DEF', spd: 'SPD' };
    p.strengths = values.slice(0, 2).map(([k, v]) => `${label[k]} ${v}`);
    p.weaknesses = values.slice(-2).reverse().map(([k, v]) => `${label[k]} ${v}`);
    if (p.ivs.spd != null) p.cooldownReduction = +(p.ivs.spd * 0.01).toFixed(2);
    return p;
  }

  function decide(p, group, rank) {
    const completeEnough = p.quality != null && p.ivTotal != null;
    const q = p.quality ?? 0;
    const iv = p.ivTotal ?? 0;
    const gap = group.length > 1 ? (group[0].score - p.score) : 0;
    const refineEligible = completeEnough && rank === 1 && q >= 1.35 && iv >= 130;
    let primary;
    if (rank === 1 && (p.score >= 70 || group.length === 1)) primary = p.level >= 20 ? 'UPAR' : 'GUARDAR';
    else if (rank <= 2 && gap <= 8 && p.score >= 58) primary = 'GUARDAR';
    else if (group.length >= 2 && rank >= 3 && gap >= 12) primary = 'VENDER-OFERTAR';
    else primary = 'GUARDAR';
    return {
      primary,
      refine: refineEligible ? 'REFINAR' : 'NÃO REFINAR',
      reason: !completeEnough
        ? 'Dados incompletos: decisão conservadora.'
        : refineEligible
          ? 'Melhor da espécie, qualidade e IV fortes. SPD nunca entra no refino.'
          : 'Refino conservador; preserve recursos e nunca tente refinar SPD.',
    };
  }

  function rankAll(records) {
    const groups = new Map();
    records.forEach(p => {
      const key = fold(p.species);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    for (const group of groups.values()) {
      group.sort((a, b) => b.score - a.score || (b.quality ?? -1) - (a.quality ?? -1) || (b.ivTotal ?? -1) - (a.ivTotal ?? -1));
      group.forEach((p, index) => {
        p.rank = index + 1;
        p.sameSpeciesCount = group.length;
        p.decision = decide(p, group, index + 1);
      });
    }
    return records.sort((a, b) => fold(a.species).localeCompare(fold(b.species)) || a.rank - b.rank);
  }

  function addRecords(records, persist = true) {
    let changed = false;
    for (const record of records.filter(Boolean)) {
      const enriched = enrich(record);
      const key = keyOf(enriched);
      const old = state.records.get(key);
      const merged = enrich(mergeRecords(enriched, old));
      if (!old || JSON.stringify(old) !== JSON.stringify(merged)) changed = true;
      state.records.set(key, merged);
    }
    rankAll([...state.records.values()]);
    if (persist && records.length && changed) saveHistory();
    if (changed) scheduleRender();
  }

  function saveHistory() {
    const current = [...state.records.values()].map(p => ({ ...p, capturedAt: p.capturedAt || new Date().toISOString() }));
    const prior = loadJSON(DB_KEY, []);
    const byKey = new Map([...prior, ...current].map(p => [keyOf(p), p]));
    saveJSON(DB_KEY, [...byKey.values()].slice(-MAX_HISTORY));
  }

  function rootsFor(origin) {
    const selectors = origin === 'PARTY' ? SELECTORS.partyRoots : SELECTORS.depotRoots;
    return [...new Set(selectors.flatMap(s => [...document.querySelectorAll(s)]))]
      .filter(node => !node.closest(`#${APP_ID}-host`));
  }

  const TYPE_CHART = {
    normal:{rock:.5,ghost:0,steel:.5},fire:{fire:.5,water:.5,grass:2,ice:2,bug:2,rock:.5,dragon:.5,steel:2},
    water:{fire:2,water:.5,grass:.5,ground:2,rock:2,dragon:.5},electric:{water:2,electric:.5,grass:.5,ground:0,flying:2,dragon:.5},
    grass:{fire:.5,water:2,grass:.5,poison:.5,ground:2,flying:.5,bug:.5,rock:2,dragon:.5,steel:.5},
    ice:{fire:.5,water:.5,grass:2,ice:.5,ground:2,flying:2,dragon:2,steel:.5},
    fighting:{normal:2,ice:2,poison:.5,flying:.5,psychic:.5,bug:.5,rock:2,ghost:0,dark:2,steel:2,fairy:.5},
    poison:{grass:2,poison:.5,ground:.5,rock:.5,ghost:.5,steel:0,fairy:2},ground:{fire:2,electric:2,grass:.5,poison:2,flying:0,bug:.5,rock:2,steel:2},
    flying:{electric:.5,grass:2,fighting:2,bug:2,rock:.5,steel:.5},psychic:{fighting:2,poison:2,psychic:.5,dark:0,steel:.5},
    bug:{fire:.5,grass:2,fighting:.5,poison:.5,flying:.5,psychic:2,ghost:.5,dark:2,steel:.5,fairy:.5},
    rock:{fire:2,ice:2,fighting:.5,ground:.5,flying:2,bug:2,steel:.5},ghost:{normal:0,psychic:2,ghost:2,dark:.5},
    dragon:{dragon:2,steel:.5,fairy:0},dark:{fighting:.5,psychic:2,ghost:2,dark:.5,fairy:.5},
    steel:{fire:.5,water:.5,electric:.5,ice:2,rock:2,steel:.5,fairy:2},fairy:{fire:.5,fighting:2,poison:.5,dragon:2,dark:2,steel:.5}
  };
  const TYPE_ALIASES = {fogo:'fire',agua:'water',planta:'grass',grama:'grass',eletrico:'electric',gelo:'ice',lutador:'fighting',luta:'fighting',veneno:'poison',terra:'ground',voador:'flying',psiquico:'psychic',inseto:'bug',pedra:'rock',fantasma:'ghost',dragao:'dragon',sombrio:'dark',aco:'steel',fada:'fairy'};
  const typeKey = t => TYPE_ALIASES[fold(t)] || fold(t);
  function creatureKey(name) { return fold(name).replace(/\bshiny\b/g, '').replace(/[^a-z0-9]/g, ''); }
  function creatureTypes(raw) {
    const values = Array.isArray(raw?.types) ? raw.types : [raw?.type1 || raw?.type_1, raw?.type2 || raw?.type_2, raw?.type];
    return [...new Set(values.filter(Boolean).flatMap(v => String(v).split(/[,/|]/)).map(typeKey).filter(t => TYPE_CHART[t]))];
  }
  function farmTypes(p) { return creatureTypes(p).length ? creatureTypes(p) : creatureTypes(state.creatures.get(creatureKey(p.species))); }
  function huntMultiplier(attacks, defenders) {
    const base = Math.max(...attacks.map(a => defenders.reduce((m, d) => m * (TYPE_CHART[a]?.[d] ?? 1), 1)));
    return base > 1 ? 1 + (base - 1) * 1.5 : base > 0 && base < 1 ? base / 1.5 : base;
  }
  function normalizeHunt(raw) {
    const enemy = raw.pokemon || raw.creature || {};
    const name = normText(pick(raw.huntName, raw.name, raw.title, raw.slug));
    if (!name || /city|cidade|boss|raid/i.test(String(raw.kind || raw.category || raw.type || ''))) return null;
    const species = normText(pick(raw.pokemonName, raw.creatureName, enemy.name, raw.species, name.replace(/\[.*?\]|\(.*?\)/g, '')));
    const creature = state.creatures.get(creatureKey(species));
    const types = creatureTypes(enemy).length ? creatureTypes(enemy) : creatureTypes(raw).length ? creatureTypes(raw) : creatureTypes(creature);
    return { name, species, types, slug:raw.slug || raw.huntSlug || name,
      level:num(pick(raw.pokemonLevel, raw.creatureLevel, raw.level, enemy.level)),
      minLevel:num(pick(raw.minLevel, raw.requiredLevel, raw.levelRequired, raw.requirements?.level)),
      xp:num(pick(raw.xp, raw.exp, raw.experience, raw.rewardXp, enemy.xp, creature?.xp)),
      gold:num(pick(raw.gold, raw.money, raw.rewardGold)),
      hp:num(pick(raw.combatHp,raw.hp,enemy.combatHp,enemy.hp)),
      respawnSeconds:num(raw.respawnSeconds), killSeconds:num(raw.killSeconds),
      locked:raw.locked === true || raw.accessible === false,
      raw };
  }
  function indexHunts(list) {
    if (!Array.isArray(list)) return;
    list.forEach(raw => { const h = normalizeHunt(raw); if (h) state.hunts.set(String(h.slug), h); });
  }
  async function loadFarmData() {
    if (state.farmLoading) return;
    if (!/(^|\.)poke\.idleworld\.online$/.test(location.hostname)) {
      state.farmStatus = state.ioRaw.size ? 'Dados recebidos automaticamente; atualizando catálogo.' : 'Recarregue o jogo uma vez para receber a conexão inicial. Não é necessário abrir o mapa.';
      await loadIOCatalog();
      scheduleRender();
      return;
      if (state.evaluating || state.collectionRunning) return;
      state.farmLoading = true;
      try {
        if (!document.querySelector('button.marcador[data-slug]')) {
          const map = document.querySelector('button[data-modal="mapa"]');
          if (!map) throw new Error('Abra o mapa; botão não encontrado.');
          map.click(); await waitFor(() => document.querySelector('button.marcador[data-slug]'));
        }
        scanHuntsDOM();
        const regions = [...document.querySelectorAll('button.mapa-area[data-regiao]')];
        const previous = regions.find(b => b.classList.contains('on'))?.dataset.regiao;
        for (const region of regions) {
          if (!region.isConnected || region.disabled) continue;
          region.click();
          await waitFor(() => document.querySelector('.mapa-area.on')?.dataset.regiao === region.dataset.regiao);
          await pause(250); scanHuntsDOM();
        }
        const restore = [...document.querySelectorAll('button.mapa-area[data-regiao]')].find(b => b.dataset.regiao === previous);
        if (restore) restore.click();
        state.farmStatus = `${state.hunts.size} locais lidos do mapa. Locais sem dados suficientes precisam de Importar hunts.`;
      } catch(e) { state.farmStatus = `Leitura do mapa: ${e.message}`; }
      finally { state.farmLoading = false; scheduleRender(); }
      return;
    }
    state.farmLoading = true; state.farmStatus = 'Lendo dados de hunts…'; scheduleRender();
    const get = async url => {
      const response = await fetch(url, { method:'GET', credentials:'same-origin', signal:AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };
    const results = await Promise.allSettled([get('/game/creatures.json'), get('/api/game/map-markers')]);
    if (results[0].status === 'fulfilled') {
      const data = results[0].value;
      const list = Array.isArray(data) ? data : data.creatures;
      if (Array.isArray(list)) list.forEach(c => { if (c?.name) state.creatures.set(creatureKey(c.name), c); });
    }
    if (results[1].status === 'fulfilled') {
      const data = results[1].value;
      indexHunts(Array.isArray(data) ? data : data.markers || data.hunts || data.data?.markers || data.data?.hunts || data.data);
    }
    // Atualiza também hunts já lidas antes do catálogo de espécies.
    for (const [id, h] of state.hunts) state.hunts.set(id, normalizeHunt(h.raw));
    state.farmLoading = false;
    state.farmStatus = `${state.hunts.size} locais lidos. ${results.some(r => r.status === 'rejected') ? 'Parte dos dados indisponível; abra o mapa ou importe hunts.' : 'Selecione o Pokémon e o objetivo.'}`;
    scheduleRender();
  }
  function scanHuntsDOM() {
    if (state.ioModules && state.ioHunts.length) return;
    const rows = document.querySelectorAll('button.marcador[data-slug], .map-window [data-guide^="hunt-"], [data-hunt-slug], [data-hunt], .ha-window [data-hunt-name]');
    rows.forEach(node => {
      if (node.closest(`#${APP_ID}-host`)) return;
      const t = normText(node.innerText || node.textContent);
      const d = node.dataset;
      const full = `${t} ${node.title || ''}`;
      indexHunts([{...d, slug:d.huntSlug || d.slug || d.guide?.replace(/^hunt-/, ''),
        types:[...node.querySelectorAll('[data-type], .tipo, .type, .badge-type')].map(el => typeKey(el.dataset.type || el.textContent)).filter(t => TYPE_CHART[t]),
        name:d.huntName || node.querySelector('[class*="name"]')?.textContent || full.split(/Nv|Lv|Nível|Level|XP|EXP/i)[0],
        level:d.level || textField(full, [/(?:Nv|Lv|Nível|Level)\s*[:.]?\s*(\d+)/i]),
        minLevel:d.minLevel || textField(t, [/(?:Requer|Requires|Min)\s*(?:Nv|Lv|Level)?\s*[:.]?\s*(\d+)/i]),
        xp:d.xp || textField(full, [/(?:XP|EXP)\s*[:=]?\s*([\d.,]+)/i]),
        gold:d.gold || textField(full, [/(?:Gold|Dinheiro)\s*[:=]?\s*([\d.,]+)/i]),
        locked:node.disabled || node.getAttribute('aria-disabled') === 'true' || node.classList.contains('locked')}]);
    });
  }
  function farmParty() {
    return state.hasLiveParty ? state.liveParty : [...state.records.values()].filter(p => p.origin === 'PARTY');
  }
  function moveDps(p, enemyTypes) {
    const valid = (p.moves || []).filter(m => TYPE_CHART[m.type] && m.damage > 0 && m.cooldown > 0);
    if (!valid.length) return null;
    // Final neutral damage must already reflect level and physical/special stats.
    // Never apply SPD twice to an effective cooldown read from the game.
    return valid.reduce((sum,m) => sum + m.damage * huntMultiplier([m.type],enemyTypes) / m.cooldown,0);
  }
  function rankFarms(p, hunts, goal = state.farmGoal) {
    const modelKey=JSON.stringify([p?.id,p?.level,p?.types,p?.moves,p?.combatStats,state.ioAmplification]);
    if(state.guideModelKey!==modelKey||state.guideModelCatalog!==state.ioCatalog){state.guideModelKey=modelKey;state.guideModelCatalog=state.ioCatalog;state.guideModelCache=new Map();}
    const playerTypes = farmTypes(p);
    const moveTypes = [...new Set((p.moves || []).map(m => m.type).filter(t => TYPE_CHART[t]))];
    const attacks = state.attackType ? [state.attackType] : moveTypes.length ? moveTypes : playerTypes;
    if (!playerTypes.length || !attacks.length || !(p.level > 0)) return [];
    return hunts.filter(h => h && h.types.length && h.level > 0 && !h.locked
      && !(h.minLevel != null && state.trainerLevel != null && h.minLevel > state.trainerLevel))
      .map(h => {
        const spawns = h.raw?.especies?.map(e => ({esp:state.ioCatalog.get(e.pokeId),weight:Number(e.pontos)||0})).filter(e => e.esp && e.weight > 0);
        const total = spawns?.reduce((sum,e) => sum+e.weight,0) || 0;
        const matchup = (at,def) => state.ioTypeTable && state.ioModules
          ? Math.max(...at.map(a => state.ioModules.farm.efetividadeHunt(a.toUpperCase(),def[0]?.toUpperCase(),def[1]?.toUpperCase(),state.ioTypeTable,state.ioAmplification)))
          : huntMultiplier(at,def);
        const outgoing = total ? spawns.reduce((sum,e) => sum + e.weight * matchup(attacks,creatureTypes(e.esp)),0)/total : huntMultiplier(attacks,h.types);
        const incoming = total ? spawns.reduce((sum,e) => sum + e.weight * matchup(creatureTypes(e.esp),playerTypes),0)/total : huntMultiplier(h.types,playerTypes);
        const ratio = h.level / p.level;
        const risk = incoming >= 2.5 || ratio > 1.2 ? 'ALTO' : incoming > 1 || ratio > .9 ? 'MÉDIO' : 'MENOR';
        // Índice de adequação, não simulação de dano nem produção por hora.
        const moves = (p.moves || []).filter(m => m.power > 0 && m.cooldown > 0);
        // Combat suitability only: power is NOT final damage. Global cooldown limits summed throughput.
        const attackFit = total && moves.length ? spawns.reduce((sum,e) => {
          const offense = moves.reduce((s,m) => {
            const special = /special|especial/i.test(m.category || '');
            const stat = Number(p.combatStats?.[special ? 'spAtk' : 'atk']) || 1;
            const defense = Number(e.esp[special ? 'baseSpDef' : 'baseDef']) || 1;
            return s + m.power * stat / defense * matchup([m.type],creatureTypes(e.esp)) / m.cooldown;
          },0);
          const frequency = moves.reduce((s,m) => s + 1/m.cooldown,0);
          return sum + e.weight * offense * Math.min(1, (1/.9)/frequency);
        },0)/total : outgoing;
        const fit = attackFit / Math.max(.35, incoming) / Math.max(.45, ratio * ratio);
        const dps = moveDps(p,h.types);
        const seconds = h.killSeconds > 0 ? h.killSeconds : dps > 0 && h.hp > 0 ? h.hp / dps : null;
        const cycle = seconds != null ? seconds + (h.respawnSeconds ?? 0) : null;
        const estimateKey=String(h.slug)+'|'+h.level;
        if(!state.guideModelCache.has(estimateKey))state.guideModelCache.set(estimateKey,window.PokeIdleHuntModel?.estimateHunt({pokemon:p,hunt:h,catalog:state.ioCatalog,matchup,types:creatureTypes}));
        const estimate=state.guideModelCache.get(estimateKey);
        return {h, outgoing, incoming, risk, fit, score:fit, seconds, cycle,
          projection:window.PokeIdleGuideAnalysis?.huntProjection(h,estimate),
          guideEstimate:estimate,
          model:h.killSeconds > 0 ? 'tempo medido informado' : 'modelo de golpes em paralelo',
          unconfirmed:h.minLevel == null || state.trainerLevel == null};
      }).filter(r => r.outgoing > 0).map(r => {
        const reward = goal === 'xp' ? r.h.xp : goal === 'gold' ? r.h.gold : null;
        const hourly=r.projection?(goal==='xp'?r.projection.xpPerHour:goal==='gold'?r.projection.grossGoldPerHour:null):null;
        r.rate = r.projection ? hourly==null?null:hourly/3600 : reward > 0 && r.cycle > 0 ? reward / r.cycle : null;
        r.score = goal === 'safe' ? r.fit : reward != null && reward > 0 ? r.rate ?? r.fit * reward : null;
        return r;
      }).filter(r => r.score != null).sort((a,b) => Number(b.rate != null) - Number(a.rate != null) || b.score - a.score);
  }
  function renderFarm(host) {
    const party = farmParty().sort((a,b) => Number(b.leader) - Number(a.leader) || (a.slot ?? 99) - (b.slot ?? 99));
    const select = host.querySelector('[data-role="farm-pokemon"]');
    select.innerHTML = party.map(p => `<option value="${esc(keyOf(p))}">${esc(p.species)} · Nv ${fmt(p.level)}${p.leader ? ' · líder' : ''}</option>`).join('');
    if (!party.some(p => keyOf(p) === state.farmPokemon)) state.farmPokemon = party[0] ? keyOf(party[0]) : '';
    select.value = state.farmPokemon;
    const p = state.activePokemon || party.find(p => keyOf(p) === state.farmPokemon);
    host.querySelector('[data-role="farm-status"]').textContent = state.farmStatus;
    const list = host.querySelector('[data-role="farm-list"]');
    if (!p) { list.textContent = 'Abra a Party ou importe seu Pokémon com origem Party.'; return; }
    const ranks = rankFarms(p, [...state.hunts.values()]);
    const notice = state.activePokemon ? `Em campo: ${p.species} Nv${p.level}. ` : 'Ativo não identificado: seleção manual/histórico. ';
    if (!ranks.length) { list.textContent = `${notice}Faltam tipos/níveis dos Pokémon ou recompensas para este objetivo. Carregue hunts ou use Importar hunts.`; return; }
    const formatRanks = entries => entries.slice(0,5).map((r,i) =>
      `<div class="pa-farm-row"><b>${i === 0 ? '★ ' : `${i+1}. `}${esc(r.h.name)}</b><span>${esc(r.h.species)} · Nv ${fmt(r.h.level)} · ${esc(r.h.types.join('/'))}</span><span>Ataque ×${fmt(r.outgoing,2)} · Recebido ×${fmt(r.incoming,2)} · Risco ${r.risk} · Índice ${fmt(r.score,2)}</span><small>XP ${fmt(r.h.xp)} · Dinheiro ${fmt(r.h.gold)} · ${r.unconfirmed ? 'Acesso não confirmado' : 'Dentro do nível de treinador informado'}</small>${r.projection?`<small>Estimativa: XP/h ${fmt(r.projection.xpPerHour)} · gold bruto/h ${fmt(r.projection.grossGoldPerHour)} · abates/h ${fmt(r.projection.killsPerHour)} · abates/vida ${fmt(r.projection.killsPerLife,1)} · ${r.projection.safe?'Passa filtro conservador sem poções':'Não passa filtro conservador'}</small>`:'<small>Simulação indisponível: dados de combate insuficientes.</small>'}</div>`).join('');
    list.innerHTML = `<p>${esc(notice)}${p.moves?.length || 0} golpes lidos. ${p.moves?.length ? esc(p.moves.map(m => `${m.name}: ${m.type}, ${m.category || 'categoria desconhecida'}, CD ${m.cooldown}s`).join(' | ')) : 'Aguardando catálogo de golpes.'} Onde caçar: projeções pelo modelo conservador quando há stats/golpes completos; caso contrário, somente índice de adequação. Recompensa média por abate, sem garantia de XP/gold por hora. Cura, boosts, AoE e geometria real não incluídos.</p>`;
    for (const goal of ['xp','gold']) {
      const ranked = rankFarms(p,[...state.hunts.values()],goal);
      list.innerHTML += `<h3>${goal === 'xp' ? 'Melhor XP' : 'Melhor gold'}</h3>` + (ranked.length ? formatRanks(ranked) : '<p>Recompensas/dados insuficientes.</p>');
      const best = ranked.find(r=>r.projection?.safe&&!r.unconfirmed);
      if(best?.projection)list.innerHTML+=`<p><b>Onde caçar · opção conservadora: ${esc(best.h.name)}</b> · ≈ ${fmt(best.projection.xpPerHour)} XP/h · ≈ ${fmt(best.projection.grossGoldPerHour)} gold bruto/h · ≈ ${fmt(best.projection.killsPerHour)} abates/h · ≈ ${fmt(best.projection.killsPerLife,1)} abates/vida sem poção. Gold líquido indisponível: custos de poções/bolas, loot, boosts e venda não incluídos. Não é medição real.</p>`;
      else list.innerHTML+='<p>Não foi possível confirmar uma opção segura com os dados disponíveis.</p>';
    }
    if (state.farmGoal === 'safe') list.innerHTML += '<h3>Mais adequado / segurança relativa</h3>' + formatRanks(ranks);
  }

  function scanDOM() {
    if (!document.body) return;
    // Live socket data is authoritative; no full DOM scan during closed-panel combat.
    if(state.ioComplete&&!state.open)return;
    const found = [];
    readActivePokemon();
    addEvaluationBadges();
    const io = ioCards();
    found.push(...io.map(e => e.p));
    for (const origin of ['PARTY', 'DEPOT']) {
      for (const root of rootsFor(origin)) {
        const cards = [...new Set(SELECTORS.cards.flatMap(s => [...root.querySelectorAll(s)]))];
        if (!cards.length) {
          const single = parseCard(root, origin);
          if (single) found.push(single);
        } else cards.forEach(card => { const p = parseCard(card, origin); if (p) found.push(p); });
      }
    }
    // Lê fichas que o usuário abriu. Não clica em cards: em algumas versões do
    // Depot, clicar no Pokémon pode movê-lo, portanto a abertura automática não é segura.
    const detailNodes = [...new Set(SELECTORS.details.flatMap(s => [...document.querySelectorAll(s)]))]
      .filter(node => !node.closest(`#${APP_ID}-host`));
    detailNodes.forEach(node => {
      const detailText = node.innerText || node.textContent || '';
      if (!/(?:IV|Qualidade|Quality).*(?:ATK|DEF|SPD|Speed)/is.test(detailText)) return;
      const origin = rootsFor('PARTY').some(root => root.contains(node)) ? 'PARTY'
        : rootsFor('DEPOT').some(root => root.contains(node)) ? 'DEPOT' : 'MANUAL';
      const parsed = parseCard(node, origin);
      if (parsed) found.push(parsed);
    });
    if (state.socketRecords.length) found.push(...state.socketRecords);
    scanHuntsDOM();
    state.lastScanAt = Date.now();
    addRecords(state.ioRaw.size ? found.filter(p => p.source === 'SOCKET' || !state.ioRaw.has(Number(p.id))) : found);
    updateStatus(`${found.length} registro(s) lido(s) nesta varredura.`);
    scheduleRender();
  }

  function scheduleScan(delay = 500) {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(scanDOM, delay);
  }

  async function loadIOCatalog() {
    if (state.ioLoading) return state.ioLoading;
    state.ioLoading = (async () => {
      try {
        const [farm, special, tm, sheets, outland, inherit, orre] = await Promise.all([
          import('/hunt-analyser.mjs'), import('/shared/golpes-especiais.mjs'),
          import('/shared/tm-elemental.mjs'), import('/shared/golpes-planilhas.mjs'),
          import('/shared/outland.mjs'), import('/shared/herdar-base-outland.mjs'),
          import('/shared/herdar-golpes-orre.mjs')
        ]);
        const files = await Promise.all(['/assets/creatures.json','/assets/creatures-novos.json','/assets/creatures-outland-novos.json'].map(async path => {
          const response = await fetch(path, {credentials:'omit'});
          if (!response.ok) throw new Error(`Catálogo HTTP ${response.status}`);
          const data = await response.json(); return Array.isArray(data) ? data : data.creatures || [];
        }));
        const list = files.flat();
        const reference=window.pokeidleLauncher?.huntReference;
        if(reference&&window.PokeIdleHuntReference){
          const referenceSpecies=new Map(reference.creatures.map(c=>[c.pokeId,c]));
          for(let i=0;i<list.length;i++)list[i]=window.PokeIdleHuntReference.fillMissing(list[i],referenceSpecies.get(list[i].pokeId));
          // Only species already advertised by the live game's hunts can be added.
          const known=new Set(list.map(c=>c.pokeId));
          for(const h of state.ioHunts)for(const e of h.especies||[]){const c=referenceSpecies.get(e.pokeId);if(c&&!known.has(e.pokeId)){list.push({...c,referenceSource:reference.source});known.add(e.pokeId);}}
        }
        outland.aplicarRemapOutlandLista(list);
        const auditResponse = await fetch('/assets/creatures-audit-overrides.json',{credentials:'omit'});
        if (auditResponse.ok) {
          const audit = await auditResponse.json();
          for (const override of audit.overrides || []) {
            const c = list.find(e => e.pokeId === override.pokeId);
            if (!c) continue;
            for (const key of ['baseHp','baseAtk','baseDef','baseSpAtk','baseSpDef','baseSpeed']) if (typeof override[key] === 'number') c[key] = override[key];
            if (Array.isArray(override.attacks)) c.attacks = override.attacks.map(a => ({...a}));
          }
        }
        sheets.aplicarGolpesDasPlanilhas(id => list.filter(c => c.pokeId === id));
        inherit.herdarBaseOutland(list);
        list.forEach(c => special.injetarGolpesEspeciais(c));
        orre.herdarGolpesOrre(list);
        state.ioCatalog = new Map(list.map(c => [c.pokeId,c]));
        list.forEach(c => state.creatures.set(creatureKey(c.name || c.nome),c));
        state.ioModules = {farm,tm};
        try {
          const [nota,lineage]=await Promise.all([import('/shared/nota-pokemon.mjs'),import('/shared/linhagem-nota.mjs')]);
          lineage.anotarLinhagemDaNota(list,id=>state.ioCatalog.get(id));
          state.ioModules.nota=nota;
        } catch { /* Calculations remain explicitly labelled heuristic if official module is unavailable. */ }
        rebuildIOData();
      } catch (error) {
        state.farmStatus = `Coleta automática: ${error.message}. Os dados da conexão continuam disponíveis; tente Carregar hunts novamente.`;
        scheduleRender();
      } finally { state.ioLoading = null; }
    })();
    return state.ioLoading;
  }

  function rebuildIOData() {
    const locked = new Set(state.ioFields.automation?.pokemonTravado || []);
    state.socketRecords = [...state.ioRaw.values()].map(raw => {
      const esp = state.ioCatalog.get(raw.speciesId);
      const moves = (esp?.attacks || []).filter(a => (a.learnLevel || 1) <= raw.level);
      const elemental = raw.tmElemental && state.ioModules?.tm.golpeTmElemental(raw.tmElemental);
      if (elemental) moves.push(elemental);
      const origin = raw.slot != null ? 'PARTY' : locked.has(raw.id) ? 'COLLECTION' : 'DEPOT';
      return normalizePokemon({...raw, moves:moves.map(a => ({
        name:a.name || a.nome || 'Golpe', type:typeKey(a.type), category:a.category,
        power:Number(a.power) || 0,
        cooldown:Math.max(400,(Number(a.cooldownMs) || 2000) - clamp(Number(raw.ivs?.speed) || 1,1,32)*10)/1000,
      }))},origin,'SOCKET');
    }).filter(Boolean);
    state.hasLiveParty = true;
    state.liveParty = state.socketRecords.filter(p => p.origin === 'PARTY');
    state.activePokemon = state.socketRecords.find(p => String(p.id) === String(state.ioFields.activeId)) || null;
    state.trainerLevel = num(state.ioFields.level);
    trackSessionCaptures();
    addRecords(state.socketRecords);
    if(state.inventoryCalculation)calculateInventory();
    if (state.ioModules && state.ioHunts.length && !state.huntsCatalogBuilt) {
      state.hunts.clear();
      state.ioHunts.forEach(raw => {
        const reference=window.pokeidleLauncher?.huntReference;
        const extra=reference?.hunts.find(h=>h.slug===raw.slug);
        if(extra&&window.PokeIdleHuntReference)raw=window.PokeIdleHuntReference.fillMissing(raw,extra);
        if (!raw.especies?.length) return;
        const reward = state.ioModules.farm.mediaPorKill(raw,state.ioCatalog);
        const enemies = raw.especies.map(e => state.ioCatalog.get(e.pokeId)).filter(Boolean);
        const h = normalizeHunt({...raw,name:raw.nome,level:raw.nivel,minLevel:raw.nivel,
          types:[...new Set(enemies.flatMap(creatureTypes))],xp:reward.xp,gold:reward.gold});
        if (h) { h.raw = raw; state.hunts.set(String(h.slug),h); }
      });
      state.farmStatus = `${state.hunts.size} hunts completas · ${state.ioRaw.size} Pokémon · atualização automática pela conexão do jogo.`;
      const reference=window.pokeidleLauncher?.huntReference;
      if(reference)state.farmStatus+=` Referência complementar: pokedex.lotuz.tech (${reference.builtAt||'data desconhecida'}${reference.stale?', cache desatualizado':''}); jogo atual tem prioridade.`;
      state.huntsCatalogBuilt=true;
    } else if(!state.huntsCatalogBuilt) state.farmStatus = 'Conexão recebida; carregando catálogo de espécies e recompensas…';
    scheduleRender();
    scheduleAutomation();
  }

  function readIOMessage(message) {
    if(message?.t==='erro' && state.capturePending){
      stopCapturePending();state.autoCapture=false;
      const code=typeof message.chave==='string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(message.chave)?message.chave:'recusa sem código';
      state.captureStatus=`Captura pausada: servidor retornou ${code}.`;saveAutomationPrefs();reportLauncherStatus();scheduleRender();return;
    }
    if (message?.t==='campo' || message?.t==='campo.init') { readCaptureField(message);return; }
    if (message?.t === 'batalha') {
      for (const e of message.ev || []) {
        if (e.k === 'colecao') acknowledgeCollection(e);
        if (e.k === 'bola') acknowledgeCapture(e);
        measureBattle(e);
      }
      scheduleAutomation();
      return;
    }
    if (message?.t !== 'welcome' && message?.t !== 'estado') return;
    if (message.t === 'welcome') {
      state.huntsCatalogBuilt=false;
      state.ioHunts = Array.isArray(message.hunts) ? message.hunts : [];
      state.ioTypeTable = message.tabelaTipos;
      state.ioAmplification = message.ampliacaoHunt ?? 1.5;
      state.ballCatalog=Array.isArray(message.catalogoBolas)?message.catalogoBolas:[];
    }
    const delta = message.estado;
    if (!delta || typeof delta !== 'object') return;
    if (delta.cheio || Array.isArray(delta.pokemons)) {
      state.ioComplete = true;
      state.ioRaw = new Map((delta.pokemons || []).map(p => [p.id,p]));
      if (delta.cheio) state.ioFields = {};
    }
    const previousHunt=state.ioFields.huntSlug;
    for(const platform of ['twitch','kick'])if(platform in delta){
      const source=delta[platform];
      state.ioFields[platform]=source&&typeof source==='object'?{oficiais:source.oficiais,lives:source.lives}:null;
      state.partnersObservedAt=Date.now();
    }
    for (const key of ['activeId','level','automation','huntSlug','noCentro','boss','mistico','pvp','campeonato','casa','balls','items']) if (key in delta) state.ioFields[key] = delta[key];
    if (previousHunt!==state.ioFields.huntSlug || state.ioFields.noCentro) {
      if(state.capturePending)stopCapturePending();
      state.measuringSlug='';state.lastHuntChange=Date.now();
      if(state.captureScene!==state.ioFields.huntSlug){state.captureMobs.clear();state.captureScene='';}
    }
    for (const p of delta.pkMud || []) state.ioRaw.set(p.id,p);
    for (const id of delta.pkFora || []) { state.ioRaw.delete(id); state.records.delete(String(id)); }
    // Coalesce expensive inventory work outside the incoming packet/capture path.
    if(!state.ioRebuildTimer)state.ioRebuildTimer=setTimeout(()=>{
      state.ioRebuildTimer=0;rebuildIOData();
    },1000);
    if(message.t==='welcome')requireCaptureField();
    if (state.huntPending && state.ioFields.huntSlug === state.huntPending.slug) {
      clearTimeout(state.huntPending.timer); state.huntPending=null;
      state.lastHuntChange=Date.now(); state.huntStatus='Troca de hunt confirmada pelo servidor.';
    }
  }

  function readCaptureField(message) {
    if(message.t==='campo.init'){
      stopCapturePending();state.captureLastThrow=Date.now();
      state.captureMobs.clear();state.captureScene=message.slug || '';
    }
    for(const raw of message.mobs || []){
      if(!Number.isInteger(raw.s))continue;
      // Compact field packets omit false shiny flags; this is an ordinary target.
      const prior=state.captureMobs.get(raw.s) || {slot:raw.s,shiny:false};
      const mob={...prior};
      if(raw.x!==undefined){
        mob.dead=!!raw.x;
        if(!mob.dead){mob.done=false;mob.nextAt=0;mob.attempts=0;mob.lastAttempt=0;}
      }
      if(raw.sh!==undefined)mob.shiny=!!raw.sh;
      if(raw.xr!==undefined)mob.expires=Date.now()+Math.max(0,Number(raw.xr)||0);
      if(raw.hp!==undefined)mob.hp=Number(raw.hp);
      state.captureMobs.set(raw.s,mob);
    }
    for(const rawSlot of message.fora || []){
      const slot=Number(rawSlot),pending=state.captureInflight.get(slot);
      if(pending){
        clearTimeout(pending.timer);state.captureInflight.delete(slot);
        state.capturePending=[...state.captureInflight.values()][0]||null;
        state.captureStatus='Servidor retirou o alvo do chão; fila liberada. Resultado da captura ainda não confirmado.';
      }
      state.captureMobs.delete(slot);
    }
    runCapture();
    scheduleAutomation();
  }

  function huntExitReady() {
    if(state.captureScene===state.ioFields.huntSlug && state.captureMobs.size
      && [...state.captureMobs.values()].every(m=>m.dead || m.hp===0))return true;
    return Date.now()-state.lastCombat>=3200;
  }

  function captureBall(shiny) {
    const inventory=state.ioFields.balls || {};
    const choices=state.ballCatalog.filter(b=>Number(inventory[b.id])>0 && Number.isSafeInteger(b.id) && Number(b.catchRate)>0);
    // Highest available catalog capture multiplier for every target, including commons.
    choices.sort((a,b)=>Number(b.catchRate)-Number(a.catchRate) || Number(a.priceGold || 0)-Number(b.priceGold || 0) || a.id-b.id);
    return choices[0] || null;
  }

  function scheduleCapture() {
    if(state.captureTimer || !state.autoCapture)return;
    state.captureTimer=setTimeout(()=>{state.captureTimer=0;runCapture();},0);
  }

  function requireCaptureField() {
    if(!state.autoCapture || !state.ioComplete || state.ioSocket?.readyState!==1)return;
    try{state.ioSocket.send(JSON.stringify({t:'cliente.economia',ativo:false}));}
    catch{state.captureStatus='Sem conexão para receber alvos de captura.';}
  }

  function runCapture() {
    if(!state.autoCapture || state.captureInflight.size>=3)return;
    if(!ordinaryHunt() || state.ioSocket?.readyState!==1){
      const e=state.ioFields;
      const reasons=[!state.ioComplete?'inventário incompleto':'',state.ioSocket?.readyState!==1?'socket fechado':'',!e.huntSlug?'sem hunt':'',e.noCentro?'Centro':'',e.boss?.arena?'boss':'',e.mistico?'místico':'',e.pvp?.arena?'PvP':'',e.campeonato?.arena?'campeonato':'',e.casa?.dentro?'casa':''].filter(Boolean);
      state.captureStatus=`Captura bloqueada: ${reasons.join(', ')||'contexto não confirmado'}.`;return;
    }
    if(state.captureScene!==state.ioFields.huntSlug){state.captureStatus='Aguardando dados de campo; modo Eco não pode suspender alvos durante captura.';return;}
    // Do not compete with native VIP automation and never change its flags.
    if(state.ioFields.automation?.autoBallSemParar || state.ioFields.automation?.autoBallAteCapturar){state.captureStatus='Captura nativa ativa: rotina externa não lança bolas.';return;}
    const now=Date.now();
    const targets=[...state.captureMobs.values()].filter(m=>m.dead && !m.done && !state.captureInflight.has(m.slot) && typeof m.shiny==='boolean' && m.expires>now+500 && !(m.nextAt>now));
    // Give every body a first throw before retrying failures; then rotate retries fairly.
    // Shiny priority is retained among targets with the same attempt count.
    targets.sort((a,b)=>(a.attempts||0)-(b.attempts||0)||Number(b.shiny)-Number(a.shiny)||(a.lastAttempt||0)-(b.lastAttempt||0)||a.expires-b.expires);
    const mob=targets.find(m=>captureBall(m.shiny));
    if(!mob){state.captureStatus=targets.length?'Sem bola disponível para esses alvos. Não compra automaticamente.':'Aguardando Pokémon derrotados.';return;}
    const ball=captureBall(mob.shiny),slot=mob.slot;
    const timer=setTimeout(()=>{
      if(!state.captureInflight.has(slot))return;
      state.captureInflight.delete(slot);state.capturePending=[...state.captureInflight.values()][0]||null;
      // Unknown result: do not spend another ball on this body, but do not block other bodies.
      mob.done=true;
      state.captureStatus='Resultado não confirmado para um alvo; sem repetir gasto. Captura continua nos próximos.';
      scheduleCapture();scheduleRender();
    },6000);
    state.capturePending={slot,ballId:ball.id,timer};state.captureLastThrow=now;
    state.captureInflight.set(slot,state.capturePending);
    mob.attempts=(mob.attempts||0)+1;mob.lastAttempt=now;
    state.captureStatus=`Arremesso ${ball.nome || ball.name || ball.id}${mob.shiny?' em shiny':''}: aguardando servidor.`;
    try {state.ioSocket.send(JSON.stringify({t:'ball.throw',ballId:ball.id,slot}));}
    catch {stopCapturePending();state.autoCapture=false;state.captureStatus='Falha de conexão: captura pausada.';saveAutomationPrefs();}
    // Fill the bounded queue now, not one delayed timer per body in a busy renderer.
    if(state.autoCapture&&state.captureInflight.size<3)runCapture();
    scheduleRender();
  }

  function acknowledgeCapture(event) {
    const pending=state.captureInflight.get(Number(event.slot));
    if(pending && event.ballId!=null && Number(event.ballId)!==pending.ballId)return;
    if(pending)clearTimeout(pending.timer);
    state.captureInflight.delete(Number(event.slot));state.capturePending=[...state.captureInflight.values()][0]||null;
    const mob=state.captureMobs.get(Number(event.slot));
    // A failed attempt is not a completed capture. Retry only while field data retains the body.
    if(mob){mob.done=!!event.sucesso;mob.nextAt=0;}
    state.captureStatus=event.sucesso?'Captura confirmada.':'Captura falhou; nova tentativa se o alvo continuar no chão.';
    scheduleCapture();scheduleRender();
  }

  function stopCapturePending(){
    for(const p of state.captureInflight.values())clearTimeout(p.timer);
    if(state.capturePending)clearTimeout(state.capturePending.timer);
    state.captureInflight.clear();state.capturePending=null;
  }

  function farmContextKey() {
    const p=state.activePokemon;
    return p ? JSON.stringify([p.id,p.level,p.p,p.quality,p.ivs,p.combatStats,p.moves]) : '';
  }

  function ordinaryHunt() {
    const e=state.ioFields;
    return state.ioComplete && e.huntSlug && !e.noCentro && !e.boss?.arena && !e.mistico
      && !e.pvp?.arena && !e.campeonato?.arena && !e.casa?.dentro;
  }

  function measureBattle(event) {
    const now=Date.now();
    if (event.k==='ataque') state.lastCombat=now;
    if (event.k==='morte' && event.quem!=='selvagem') {
      state.huntPauseUntil=now+10*60*1000;
      state.huntStatus='Trocas pausadas por 10 minutos após desmaio.';
      state.farmSamples.clear(); return;
    }
    if (event.k!=='morte' || event.quem!=='selvagem' || !ordinaryHunt()) return;
    const context=farmContextKey(); if (!context) return;
    if (state.sampleKey!==context) { state.farmSamples.clear();state.sampleKey=context; }
    const slug=String(state.ioFields.huntSlug);
    let sample=state.farmSamples.get(slug);
    if (state.measuringSlug!==slug) { sample=null;state.measuringSlug=slug; }
    if (!sample) { sample={start:now,last:now,kills:0,xp:0,gold:0,valid:true}; state.farmSamples.set(slug,sample);return; }
    const xp=num(event.xpPokemon ?? event.xp),gold=num(event.ouro);
    if (xp==null || gold==null) sample.valid=false;
    sample.kills++;sample.xp+=Math.max(0,xp || 0);sample.gold+=Math.max(0,gold || 0);sample.last=now;
    // Wall-clock time between deaths includes movement, cooldown and waves.
    state.huntStatus=`${sample.kills} abates medidos · média ${fmt((sample.last-sample.start)/1000/sample.kills,1)} s/abate · ${fmt(sample.xp/Math.max(1,(sample.last-sample.start)/60000),1)} XP/min · ${fmt(sample.gold/Math.max(1,(sample.last-sample.start)/60000),1)} gold/min.`;
  }

  function measuredFarmChoice() {
    if (!ordinaryHunt() || farmContextKey()!==state.sampleKey) return null;
    const now=Date.now(),currentSlug=String(state.ioFields.huntSlug);
    const ready=s => s?.valid && s.kills>=10 && s.last-s.start>=60000 && now-s.last<30*60*1000;
    const current=state.farmSamples.get(currentSlug);
    if (!ready(current)) return null;
    const rates=s => ({xp:s.xp/(s.last-s.start),gold:s.gold/(s.last-s.start)});
    const baseline=rates(current),weight=state.xpPriority/100;
    if ((weight>0 && !(baseline.xp>0)) || (weight<1 && !(baseline.gold>0))) return null;
    const ranked=rankFarms(state.activePokemon,[...state.hunts.values()],'safe');
    const currentRank=ranked.find(r=>String(r.h.slug)===currentSlug);
    if (!currentRank) return null;
    const risks={MENOR:0,'MÉDIO':1,ALTO:2};
    let choice=null;
    for (const [slug,sample] of state.farmSamples) {
      if (slug===currentSlug || !ready(sample)) continue;
      const rank=ranked.find(r=>String(r.h.slug)===slug);
      if (!rank || rank.unconfirmed || risks[rank.risk]>risks[currentRank.risk]) continue;
      const rate=rates(sample);
      const gain=(weight ? weight*rate.xp/baseline.xp : 0)+(weight<1 ? (1-weight)*rate.gold/baseline.gold : 0)-1;
      if (gain>=state.alertThreshold/100 && (!choice || gain>choice.gain)) choice={slug,gain,rate};
    }
    return choice;
  }

  function guideFarmChoice() {
    if(!ordinaryHunt()||farmContextKey()!==state.sampleKey)return null;
    const currentSlug=String(state.ioFields.huntSlug),sample=state.farmSamples.get(currentSlug);
    if(!sample?.valid||sample.kills<10||sample.last-sample.start<60000||Date.now()-sample.last>60000)return null;
    const ranks=rankFarms(state.activePokemon,[...state.hunts.values()],'safe');
    const base=ranks.find(r=>String(r.h.slug)===currentSlug),weight=state.xpPriority/100;
    if(!base?.guideEstimate||!(base.h.xp>0)||!(base.h.gold>0))return null;
    let best=null;
    for(const rank of ranks){
      if(String(rank.h.slug)===currentSlug||rank.unconfirmed||!rank.guideEstimate?.safe||!(rank.h.xp>0)||!(rank.h.gold>0))continue;
      const pace=base.guideEstimate.seconds/rank.guideEstimate.seconds;
      const gain=weight*pace*rank.h.xp/base.h.xp+(1-weight)*pace*rank.h.gold/base.h.gold-1;
      if(gain>=state.alertThreshold/100&&(!best||gain>best.gain))best={slug:String(rank.h.slug),gain,estimated:true};
    }
    return best;
  }

  function autoSwitchHunt() {
    if(state.capturePending || (state.autoCapture && [...state.captureMobs.values()].some(m=>m.dead && !m.done && m.expires>Date.now())))return;
    if (!state.autoHunts || state.huntPending || !ordinaryHunt()) return;
    const now=Date.now();
    if (now<state.huntPauseUntil || now-state.lastHuntChange<5*60*1000 || !huntExitReady()) return;
    const choice=measuredFarmChoice();
    if (!choice || state.ioSocket?.readyState!==1) return;
    const timer=setTimeout(()=>{
      if (state.huntPending?.slug!==choice.slug) return;
      state.huntPending=null;state.autoHunts=false;
      state.huntStatus='Sem confirmação de troca: troca automática pausada.';saveAutomationPrefs();scheduleRender();
    },10000);
    state.huntPending={slug:choice.slug,timer};
    if(choice.estimated)state.huntStatus=`Onde caçar: escolhendo ${choice.slug} por estimativa conservadora calibrada com a sessão; ganho estimado ${fmt(choice.gain*100,1)}%. Não é rendimento medido nessa hunt.`;
    try { state.ioSocket.send(JSON.stringify({t:'hunt.select',slug:choice.slug})); }
    catch {clearTimeout(timer);state.huntPending=null;state.autoHunts=false;saveAutomationPrefs();}
  }

  function autoCollectionCandidates() {
    if (!state.ioComplete || !state.ioFields.automation) return [];
    const groups = new Map();
    for (const p of state.socketRecords) {
      const raw = state.ioRaw.get(p.id);
      if (!raw) continue;
      const key = String(raw.speciesId);
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(p);
    }
    const score = p => p.score;
    const result = [];
    for (const group of groups.values()) {
      // Missing genetic information in ANY rival makes the comparison unsafe.
      if (group.some(p => !(p.quality > 0) || !p.p || !(p.ivTotal > 0) || IV_KEYS.some(k => p.ivs[k]==null))) continue;
      group.sort((a,b) => score(b)-score(a));
      const best = group[0];
      if (group.length > 1 && Math.abs(score(best)-score(group[1])) < .00001) continue;
      if (best.origin === 'DEPOT' && !state.collectionBlocked.has(best.id)
        && Number.isSafeInteger(Number(best.id)) && Number(best.id)>0) result.push(best);
    }
    return result;
  }

  function acknowledgeCollection(event) {
    const pending = state.collectionPending;
    if (!pending || Number(event.id) !== pending.id) return;
    clearTimeout(pending.timer);
    state.collectionPending = null;
    if (event.recusado || !event.naColecao) {
      state.collectionBlocked.add(pending.id);
      state.autoError = 'Envio à Coleção recusado. Esse Pokémon não será reenviado nesta sessão.';
    } else {
      const automation = state.ioFields.automation;
      if (automation) automation.pokemonTravado = [...new Set([...(automation.pokemonTravado || []),pending.id])];
      state.autoError = `${pending.name} protegido na Coleção (confirmado pelo servidor).`;
      rebuildIOData();
    }
    scheduleAutomation();
  }

  function scheduleAutomation() {
    // Throttle rather than debounce: continuous state packets must not starve the work.
    if (state.autoTimer) return;
    state.autoTimer = setTimeout(() => { state.autoTimer=0; runAutomation(); },2000);
  }

  function runAutomation() {
    reportLauncherStatus();
    scheduleCapture();
    autoSwitchHunt();
  }

  function betterFarmAlerts() {
    const p = state.activePokemon;
    const currentSlug = state.ioFields.huntSlug;
    if (!p || !currentSlug || state.ioFields.noCentro || !state.ioComplete) return [];
    const riskOrder={MENOR:0,'MÉDIO':1,ALTO:2};
    const alerts=[];
    for (const goal of ['xp','gold']) {
      const ranks=rankFarms(p,[...state.hunts.values()],goal);
      const current=ranks.find(r => String(r.h.slug)===String(currentSlug));
      if (!current || !(current.score > 0)) continue;
      const best=ranks.find(r => !r.unconfirmed && riskOrder[r.risk]<=riskOrder[current.risk]);
      if (!best || best.h.slug===current.h.slug) continue;
      const improvement=(best.score/current.score-1)*100;
      if (improvement>=state.alertThreshold) alerts.push({goal,best,current,improvement,p});
    }
    return alerts;
  }

  function checkFarmAlerts() {
    if (!state.farmAlerts) return;
    const alerts=betterFarmAlerts().filter(a => {
      const key=[a.p.id,a.goal,a.current.h.slug,a.best.h.slug].join('|');
      if (Date.now()-(state.alertTimes[key] || 0)<15*60*1000) return false;
      state.alertTimes[key]=Date.now(); return true;
    });
    if (!alerts.length) return;
    state.lastAlert=alerts.map(a => `${a.goal.toUpperCase()}: ${a.best.h.name} — índice estimado +${Math.round(a.improvement)}% vs ${a.current.h.name}, risco ${a.best.risk}, para ${a.p.species} Nv${a.p.level}.`).join(' ');
    saveJSON(`${APP_ID}:alert-times`,Object.fromEntries(Object.entries(state.alertTimes).filter(([,t])=>Date.now()-t<24*3600*1000)));
    const host=document.getElementById(`${APP_ID}-host`);
    if (host) {
      let toast=host.querySelector('[data-role="auto-toast"]');
      if (!toast) { toast=document.createElement('button'); toast.dataset.role='auto-toast'; toast.style.cssText='position:fixed;right:14px;bottom:65px;max-width:420px;z-index:2147483601'; host.appendChild(toast); toast.onclick=()=>{state.open=true;toast.hidden=true;render();}; }
      toast.textContent=`Farm melhor disponível: ${state.lastAlert}`; toast.hidden=false;
    }
    if (typeof Notification!=='undefined' && Notification.permission==='granted') {
      try { new Notification('PokeIdle — farm melhor disponível',{body:state.lastAlert,tag:'pokeidle-better-farm'}); } catch { /* in-game alert remains available */ }
    }
    scheduleRender();
  }

  function saveAutomationPrefs() {
    saveJSON(`${APP_ID}:automation`,{autoHunts:state.autoHunts,autoCapture:state.autoCapture,xpPriority:100});
  }

  function reportLauncherStatus() {
    if (typeof window==='undefined' || !window.pokeidleLauncher?.report) return;
    const sample=state.farmSamples.get(String(state.ioFields.huntSlug));
    const minutes=sample && (sample.last-sample.start)/60000;
    const valid=ordinaryHunt() && sample?.valid && minutes>0 && farmContextKey()===state.sampleKey;
    window.pokeidleLauncher.report({
      partners:state.ioSocket?.readyState===1&&state.ioComplete?(window.PokeIdlePartners?.fromGame(state.ioFields.twitch,state.ioFields.kick)||[]):[],
      partnersObservedAt:state.partnersObservedAt||0,
      automationStatus:state.huntStatus || '',
      captureStatus:state.captureStatus || 'Aguardando alvos',
      captureTargets:[...state.captureMobs.values()].filter(m=>m.dead&&!m.done&&m.expires>Date.now()).length,
      connection:state.ioSocket?.readyState===1 ? state.ioComplete?'Conectado':'Aguardando dados' : 'Desconectado / login pendente',
      active:state.activePokemon?`${state.activePokemon.species} Nv${state.activePokemon.level}`:'Ativo não identificado',
      hunt:state.hunts.get(String(state.ioFields.huntSlug))?.name || 'Hunt não identificada',
      ...(valid?{xpPerMin:sample.xp/minutes,goldPerMin:sample.gold/minutes,killsPerMin:sample.kills/minutes}:{})
    });
  }

  // Pokémon that appear after the first complete inventory of this page are this session's captures.
  function trackSessionCaptures() {
    if (!state.ioComplete || !window.pokeidleLauncher?.captures) return;
    if (!state.captureBaseline) { state.captureBaseline=new Set([...state.ioRaw.keys()].map(String)); state.sessionCaptures=new Map(); return; }
    const byId=new Map(state.socketRecords.map(p=>[String(p.id),p])),fresh=[];
    for (const id of [...state.ioRaw.keys()].map(String)) {
      if (state.captureBaseline.has(id)) continue;
      const p=byId.get(id);if(!p)continue; // Not normalized yet: retry on the next rebuild.
      state.captureBaseline.add(id);
      let gameScore=null;const raw=state.ioRaw.get(Number(id))||state.ioRaw.get(id),species=state.ioCatalog.get(raw?.speciesId);
      if(raw&&species&&state.ioModules?.nota){try{const value=state.ioModules.nota.notaDePokemon(raw,species);if(Number.isFinite(value))gameScore=value;}catch{/* Official score unavailable. */}}
      const entry={id,species:p.species,level:p.level,p:p.p,quality:p.quality,ivTotal:p.ivTotal,ivs:p.ivs,score:p.score,gameScore,shiny:p.shiny,profile:p.profile,hunt:state.hunts.get(String(state.ioFields.huntSlug))?.name||''};
      state.sessionCaptures.set(id,entry);fresh.push(entry);
    }
    if (fresh.length) window.pokeidleLauncher.captures(fresh.slice(-50));
  }

  // The panel connection may have been down when a capture happened; the server ignores duplicates.
  function resendSessionCaptures() {
    if (state.sessionCaptures?.size && window.pokeidleLauncher?.captures) window.pokeidleLauncher.captures([...state.sessionCaptures.values()].slice(-50));
  }

  // Reads existing messages; workers allow colecao.mover, hunt.select and manual ball.throw.
  function installPassiveWebSocketReader() {
    const Native = window.WebSocket;
    if (!Native || Native.__piwAnalyzerWrapped) return;
    function Wrapped(url, protocols) {
      const socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
      const parsedURL = new URL(String(url),location.href);
      if (parsedURL.host === location.host) {
        state.ioComplete=false;
        state.ioSocket=socket;
        const nativeSend=socket.send.bind(socket);
        socket.send=data=>{
          if(state.autoCapture && typeof data==='string'){
            try{const message=JSON.parse(data);if(message.t==='cliente.economia' && message.ativo===true)data=JSON.stringify({...message,ativo:false});}catch{}
          }
          return nativeSend(data);
        };
        socket.addEventListener('close',() => {
          if (state.ioSocket!==socket) return;
          if(state.capturePending){stopCapturePending();state.autoCapture=false;state.captureStatus='Conexão perdida com arremessos pendentes: captura pausada.';saveAutomationPrefs();}
          state.ioComplete=false; state.ioSocket=null;
          state.autoError='Conexão fechada: automação aguarda uma nova conexão completa.';
          reportLauncherStatus();
          scheduleRender();
        });
        socket.addEventListener('message', event => {
          if (typeof event.data !== 'string') return;
          try {
            const message = JSON.parse(event.data);
            if (['welcome','estado','batalha','campo','campo.init','erro'].includes(message?.t)) { readIOMessage(message); return; }
            if (message?.type !== 'pokes' || !Array.isArray(message.list)) return;
            state.socketRecords = message.list.map(raw => normalizePokemon(raw, raw.team ? 'PARTY' : 'DEPOT', 'SOCKET')).filter(Boolean);
            state.hasLiveParty = true;
            state.liveParty = state.socketRecords.filter(p => p.origin === 'PARTY');
            addRecords(state.socketRecords);
          } catch { /* mensagem não JSON ou sem relação */ }
        });
      }
      return socket;
    }
    Wrapped.prototype = Native.prototype;
    Object.setPrototypeOf(Wrapped, Native);
    Object.defineProperty(Wrapped, '__piwAnalyzerWrapped', { value: true });
    window.WebSocket = Wrapped;
  }

  function calculateInventory() {
    state.inventoryCalculation=true;
    if(!state.ioComplete){state.inventoryResults=[];state.inventoryStatus='Inventário completo ainda não recebido. Recarregue o jogo com o script instalado; não vou comparar apenas parte dele.';scheduleRender();return;}
    const records=state.socketRecords.filter(p=>p.origin==='DEPOT'||p.origin==='COLLECTION').map(p=>{
      const result=enrich({...p,ivs:{...p.ivs}}),raw=state.ioRaw.get(Number(p.id))||state.ioRaw.get(p.id),species=state.ioCatalog.get(raw?.speciesId);
      result.gameScore=null;
      if(raw && species && state.ioModules?.nota && p.quality!=null && p.ivTotal!=null){
        try{const value=state.ioModules.nota.notaDePokemon(raw,species);if(Number.isFinite(value))result.gameScore=value;}catch{}
      }
      return result;
    });
    const groups=new Map();for(const p of records){const key=fold(p.species);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
    for(const group of groups.values()){
      const official=group.every(p=>p.gameScore!=null);
      group.sort((a,b)=>(official?b.gameScore-a.gameScore:b.score-a.score)||String(a.id).localeCompare(String(b.id)));
      group.forEach((p,i)=>{const value=official?p.gameScore:p.score;p.rank=1+group.filter(r=>(official?r.gameScore:r.score)>value).length;p.sameSpeciesCount=group.length;p.decision=decide(p,group,p.rank);p.decision.primary=p.rank===1?'GUARDAR':p.decision.primary;p.decision.reason=`Comparação atual Depot + Coleção por ${official?'nota oficial do jogo':'índice heurístico (nota oficial indisponível)'}. Empates preservados. ${p.decision.reason}`;});
    }
    state.inventoryResults=records.sort((a,b)=>fold(a.species).localeCompare(fold(b.species))||a.rank-b.rank);
    saveJSON(`${APP_ID}:inventory-calculation`,{at:new Date().toISOString(),records:state.inventoryResults});
    const count=records.filter(p=>p.gameScore!=null).length;
    state.inventoryStatus=`${records.length} calculados: ${records.filter(p=>p.origin==='DEPOT').length} Depot + ${records.filter(p=>p.origin==='COLLECTION').length} Coleção · ${groups.size} espécies · ${count} notas oficiais. Atualiza automaticamente; sem vendas ou movimentações por esta ferramenta.`;
    scheduleRender();
  }

  function visibleRecords() {
    return (state.inventoryCalculation?state.inventoryResults:[...state.records.values()]).filter(p => {
      if (state.filterSpecies && fold(p.species) !== state.filterSpecies) return false;
      if (state.filterOrigin !== 'ALL' && p.origin !== state.filterOrigin) return false;
      if (state.search && !fold(`${p.species} ${p.profile} ${p.decision?.primary}`).includes(fold(state.search))) return false;
      return true;
    });
  }

  function fmt(value, digits = 0) {
    return value == null ? '—' : Number(value).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  function statLine(p) {
    const labels = { hp: 'HP', atk: 'ATK', def: 'DEF', spAtk: 'SP.ATK', spDef: 'SP.DEF', spd: 'SPD' };
    return IV_KEYS.map(k => `${labels[k]} ${fmt(p.ivs[k])}`).join(' · ');
  }

  function renderWorthUsing(p){
    if(!window.PokeIdleGuideAnalysis)return '';
    let gameScore=p.gameScore;
    const raw=state.ioRaw.get(Number(p.id))||state.ioRaw.get(p.id),species=state.ioCatalog.get(raw?.speciesId);
    if(raw&&species&&state.ioModules?.nota){try{const score=state.ioModules.nota.notaDePokemon(raw,species);if(Number.isFinite(score))gameScore=score;}catch{/* Missing official score remains unknown. */}}
    const report=window.PokeIdleGuideAnalysis.assessPokemon({...p,gameScore});
    return `<details><summary>Vale usar? · ${esc(report.verdict)}</summary><p>Critérios de referência HardToCapture; análise independente, sem vendas ou mudanças de equipe.</p>${report.checks.map(c=>`<p>${c.status==='ok'?'✓':c.status==='no'?'✗':c.status==='warn'?'⚠':'?'} ${esc(c.label)}: ${esc(c.detail)}</p>`).join('')}</details>`;
  }

  function scheduleRender() {
    if (state.renderPending) return;
    state.renderPending = true;
    requestAnimationFrame(() => { state.renderPending = false; render(); });
  }

  function render() {
    const host = document.getElementById(`${APP_ID}-host`);
    if (!host) return;
    host.classList.toggle('open', state.open);
    if(!state.open)return; // Do not construct hundreds of hidden cards during combat.
    const plan = collectionPlan();
    const automaticPlan=autoCollectionCandidates();
    host.querySelector('[data-role="collection-preview"]').textContent = state.ioComplete
      ? `Próximos melhores do Depot para Coleção: ${automaticPlan.map(p => `${p.species} #${p.id}`).join(' | ') || 'nenhum'} · Party e Coleção existentes preservadas.`
      : plan.length
      ? `Melhores para proteger na Coleção: ${plan.map(e => `${e.p.species} Nv${e.p.level} ${e.p.p} Q${fmt(e.p.quality,3)} IV${e.p.ivTotal}`).join(' | ')}`
      : 'Abra o Depot para identificar os melhores com seta de Coleção disponível.';
    renderFarm(host);
    const species = [...new Set([...state.records.values()].map(p => p.species))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const select = host.querySelector('[data-role="species"]');
    const old = select.value;
    select.innerHTML = `<option value="">Todas as espécies</option>${species.map(s => `<option value="${esc(fold(s))}">${esc(s)}</option>`).join('')}`;
    select.value = state.filterSpecies || old;
    const autoStatus=host.querySelector('[data-role="auto-status"]');
    if (autoStatus) autoStatus.textContent=`Coleção automática: ${state.autoCollection ? 'ATIVA' : 'PAUSADA'} · Alertas: ${state.farmAlerts ? 'ATIVOS' : 'PAUSADOS'} · ${state.autoError || 'Aguardando dados completos.'} ${state.lastAlert} · Hunt automática: ${state.autoHunts ? 'ATIVA' : 'PAUSADA'} · XP ${state.xpPriority}% / Gold ${100-state.xpPriority}% · ${state.huntStatus}`;
    for (const [role,value] of [['auto-collection',state.autoCollection],['farm-alerts',state.farmAlerts]]) {
      const input=host.querySelector(`[data-role="${role}"]`); if (input) input.checked=value;
    }
    const captureInput=host.querySelector('[data-role="auto-capture"]');if(captureInput)captureInput.checked=state.autoCapture;
    const captureStatus=host.querySelector('[data-role="capture-status"]');if(captureStatus)captureStatus.textContent=state.captureStatus;
    const rows = visibleRecords();
    const inventoryStatus=host.querySelector('[data-role="inventory-status"]');if(inventoryStatus)inventoryStatus.textContent=state.inventoryCalculation?state.inventoryStatus:'';
    host.querySelector('[data-role="count"]').textContent = `${rows.length} exibido(s) · ${state.records.size} no histórico`;
    host.querySelector('[data-role="list"]').innerHTML = rows.length ? rows.map(p => `
      <article class="pa-card ${p.rank === 1 ? 'best' : ''}">
        <div class="pa-rank">${p.rank === 1 ? '★ MELHOR' : `#${p.rank}`}<small>${p.origin}</small></div>
        <div class="pa-main">
          <h3>${esc(p.species)} ${p.shiny ? '✨' : ''}<small>Nv ${fmt(p.level)} · ${esc(p.p || 'P?')} · Q ${fmt(p.quality, 3)} · IV ${fmt(p.ivTotal)}/192</small></h3>
          <div class="pa-chips"><b>${esc(p.profile)}</b><span>Nota ${fmt(p.score, 1)}</span><span>${esc(p.types.join(' / ') || 'Tipo —')}</span></div>
          <p>${esc(statLine(p))}</p>
          ${renderWorthUsing(p)}
          <p>Poder ${fmt(p.power)} · HP combate ${fmt(p.combatHp)} · N ${fmt(p.n, 2)}${p.cooldownReduction != null ? ` · SPD reduz ${fmt(p.cooldownReduction, 2)} s do cooldown` : ''}</p>
          <p class="pa-notes"><strong>Fortes:</strong> ${esc(p.strengths.join(', ') || '—')} · <strong>Fracos:</strong> ${esc(p.weaknesses.join(', ') || '—')}</p>
        </div>
        <div class="pa-decision ${p.decision.primary === 'VENDER-OFERTAR' ? 'sell' : ''}">
          <b>${esc(p.decision.primary)}</b>${p.gameScore != null ? `<span>Nota do jogo ${fmt(p.gameScore,3)}/10</span>` : ''}<span>${esc(p.decision.refine)}</span><small>${esc(p.decision.reason)}</small>
        </div>
      </article>`).join('') : '<div class="pa-empty">Nenhum Pokémon encontrado com estes filtros. Abra Party/Depot e clique em “Varrer tela”, ou use a importação manual.</div>';
  }

  function updateStatus(message) {
    const el = document.querySelector(`#${APP_ID}-host [data-role="status"]`);
    if (el) el.textContent = message;
  }

  function exportData() {
    const blob = new Blob([JSON.stringify([...state.records.values()], null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pokeidle-analise-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function mount() {
    if (!document.body || document.getElementById(`${APP_ID}-host`)) return;
    const host = document.createElement('section');
    host.id = `${APP_ID}-host`;
    host.innerHTML = `
      <button class="pa-fab" type="button" title="Abrir analisador">ANÁLISE</button>
      <div class="pa-panel" role="dialog" aria-label="Analisador de Party e Depot">
        <header><div><h2>Analisador Party + Depot</h2><small data-role="count">0 Pokémon</small></div><button data-action="close" type="button">×</button></header>
        <div class="pa-toolbar">
          <button data-action="scan" type="button">Varrer tela</button>
          <select data-role="species"><option value="">Todas as espécies</option></select>
          <select data-role="origin"><option value="ALL">Todas as origens</option><option value="PARTY">Party</option><option value="DEPOT">Depot</option><option value="COLLECTION">Coleção</option><option value="MANUAL">Manual</option></select>
          <input data-role="search" type="search" placeholder="Buscar perfil/decisão…">
          <button data-action="manual" type="button">Colar texto</button>
          <button data-action="calculate-inventory" type="button">Calcular TODOS — Depot + Coleção</button>
          <button data-action="history-view" type="button">Voltar ao histórico</button>
          <button data-action="evaluate" type="button">Avaliar fichas automaticamente</button>
          <button data-action="evaluation-stop" type="button">Parar avaliação</button>
          <label>Proteger nota ≥ <input data-role="protect-score" type="number" min="0" max="10" step="0.1" value="9" style="width:60px"></label>
          <button data-action="collection-send" type="button">Enviar melhores à Coleção</button>
          <button data-action="collection-stop" type="button">Parar envios</button>
          <label><input data-role="auto-collection" type="checkbox"> Coleção automática</label>
          <label><input data-role="farm-alerts" type="checkbox"> Alertar farm melhor</label>
          <label>Melhoria no índice ≥ <input data-role="alert-threshold" type="number" min="1" max="1000" step="1" style="width:65px">%</label>
          <button data-action="notify-permission" type="button">Ativar notificações do navegador</button>
          <label><input data-role="auto-hunts" type="checkbox"> Trocar hunts automaticamente</label>
          <label><input data-role="auto-capture" type="checkbox"> Capturar todos (ação manual automática)</label>
          <span data-role="capture-status"></span>
          <label>Prioridade XP <input data-role="xp-priority" type="range" min="0" max="100" step="10"> Gold ← 0 / 100 → XP</label>
          <button data-action="export" type="button">Exportar</button>
          <button data-action="clear" class="quiet" type="button">Limpar histórico</button>
        </div>
        <div class="pa-status"><div data-role="status">Coleta pela conexão do jogo; recarregue após instalar.</div><div data-role="inventory-status"></div><div data-role="auto-status"></div><div data-role="collection-preview"></div></div>
        <div class="pa-content">
          <section class="pa-farm"><h3>Melhor farm para a Party</h3>
            <div class="pa-toolbar">
              <select data-role="farm-pokemon" aria-label="Pokémon da Party"></select>
              <select data-role="farm-goal" aria-label="Objetivo"><option value="safe">Segurança / adequação</option><option value="xp">XP</option><option value="gold">Dinheiro</option></select>
              <select data-role="attack-type" aria-label="Tipo do golpe"><option value="">Golpe: estimar pelos tipos</option>${Object.keys(TYPE_CHART).map(t => `<option value="${t}">${t}</option>`).join('')}</select>
              <input data-role="trainer-level" type="number" min="1" placeholder="Nível do treinador" aria-label="Nível do treinador">
              <button data-action="farm-load" type="button">Carregar hunts</button>
              <button data-action="farm-import" type="button">Importar hunts</button>
              <button data-action="combat-import" type="button">Informar golpes do ativo</button>
            </div><p data-role="farm-status"></p><div data-role="farm-list"></div>
          </section>
          <div class="pa-list" data-role="list"></div>
        </div>
        <footer>Nota heurística: qualidade 55%, IV total 20%, IVs do perfil 15%, P 10%. Bônus P: P1 0%, P2 5%, P3 10%, P4 25%, P5 100%. Sp.ATK/Sp.Def só influenciam perfis especiais/tank. SPD não é refinável.</footer>
      </div>
      <div class="pa-modal" data-role="manual-modal" hidden>
        <div><h3>Importação manual</h3><p>Cole um ou mais blocos, um Pokémon por linha/bloco. Ex.: Charmeleon / Nv40 / P1 / Q1,450 / IV132 / HP22 / ATK28 / DEF20 / SP.ATK7 / SP.DEF32 / SPD27</p>
          <label>Origem <select data-role="manual-origin"><option value="MANUAL">Manual</option><option value="PARTY">Party</option><option value="DEPOT">Depot</option></select></label>
          <textarea data-role="manual-text" rows="9"></textarea><div class="pa-actions"><button data-action="manual-cancel" type="button">Cancelar</button><button data-action="manual-import" type="button">Importar</button></div>
        </div>
      </div>`;
    document.body.appendChild(host);
    const setFarmPrefs=detail => {
      if (typeof detail?.autoHunts==='boolean') state.autoHunts=detail.autoHunts;
      if (typeof detail?.autoCapture==='boolean') {const enabled=detail.autoCapture&&!state.autoCapture;state.autoCapture=detail.autoCapture;if(enabled)requireCaptureField();}
      if (typeof detail?.autoCollection==='boolean') { state.autoCollection=detail.autoCollection;if(!state.autoCollection)state.collectionStop=true; }
      if (typeof detail?.farmAlerts==='boolean') state.farmAlerts=detail.farmAlerts;
      if (Number.isFinite(detail?.alertThreshold)) state.alertThreshold=clamp(detail.alertThreshold,1,1000);
      if (Number.isFinite(detail?.xpPriority)) state.xpPriority=clamp(detail.xpPriority,0,100);
      host.querySelector('[data-role="auto-hunts"]').checked=state.autoHunts;
      host.querySelector('[data-role="auto-collection"]').checked=state.autoCollection;
      host.querySelector('[data-role="farm-alerts"]').checked=state.farmAlerts;
      host.querySelector('[data-role="xp-priority"]').value=state.xpPriority;
      host.querySelector('[data-role="alert-threshold"]').value=state.alertThreshold;
      saveAutomationPrefs();scheduleAutomation();render();
    };
    host.querySelector('[data-role="auto-hunts"]').checked=state.autoHunts;
    host.querySelector('[data-role="xp-priority"]').value=state.xpPriority;
    host.querySelector('[data-role="auto-hunts"]').addEventListener('change',e=>setFarmPrefs({autoHunts:e.target.checked}));
    host.querySelector('[data-role="auto-capture"]').addEventListener('change',e=>setFarmPrefs({autoCapture:e.target.checked}));
    host.querySelector('[data-role="xp-priority"]').addEventListener('input',e=>setFarmPrefs({xpPriority:Number(e.target.value)}));
    window.addEventListener('pokeidle-launcher-settings',e=>setFarmPrefs(e.detail));
    window.addEventListener('pokeidle-launcher-action',e=>{if(e.detail==='open'){state.open=true;render();}});
    if (window.pokeidleLauncher) setFarmPrefs(window.pokeidleLauncher.settings);
    host.querySelector('[data-role="alert-threshold"]').value=state.alertThreshold;
    host.querySelector('[data-role="auto-collection"]').addEventListener('change',e => {
      state.autoCollection=e.target.checked; saveAutomationPrefs(); scheduleAutomation(); render();
    });
    host.querySelector('[data-role="farm-alerts"]').addEventListener('change',e => {
      state.farmAlerts=e.target.checked; saveAutomationPrefs(); scheduleAutomation(); render();
    });
    host.querySelector('[data-role="alert-threshold"]').addEventListener('change',e => {
      state.alertThreshold=clamp(num(e.target.value) || 15,1,1000);
      e.target.value=state.alertThreshold; saveAutomationPrefs(); scheduleAutomation();
    });
    host.querySelector('[data-action="notify-permission"]').addEventListener('click',async () => {
      if (typeof Notification==='undefined') { updateStatus('Notificação do navegador indisponível; avisos aparecem no jogo.'); return; }
      try { const permission=await Notification.requestPermission(); updateStatus(permission==='granted' ? 'Notificações do navegador ativadas.' : 'Avisos continuam aparecendo dentro do jogo.'); } catch { updateStatus('Não foi possível ativar notificações; avisos continuam dentro do jogo.'); }
    });
    bindUI(host);
    render();
    state.observer = new MutationObserver(mutations => {
      if (mutations.every(m => m.target.closest?.(`#${APP_ID}-host`))) return;
      scheduleScan(650);
    });
    state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleScan(800);
  }

  function bindUI(host) {
    host.querySelector('[data-action="evaluate"]').addEventListener('click', evaluateAutomatic);
    host.querySelector('[data-action="calculate-inventory"]').addEventListener('click',()=>{state.filterSpecies='';state.filterOrigin='ALL';state.search='';calculateInventory();render();});
    host.querySelector('[data-action="history-view"]').addEventListener('click',()=>{state.inventoryCalculation=false;render();});
    host.querySelector('[data-action="evaluation-stop"]').addEventListener('click', () => { state.evaluationStop = true; updateStatus('Parada solicitada após a ficha em andamento.'); });
    host.querySelector('[data-role="protect-score"]').addEventListener('change', e => { state.protectScore = clamp(num(e.target.value) ?? 9,0,10); });
    host.querySelector('[data-action="combat-import"]').addEventListener('click', () => {
      const p = state.activePokemon;
      if (!p) { updateStatus('Pokémon em campo não identificado. Abra sua ficha e use Colar texto com origem Party.'); return; }
      const text = prompt('Cole JSON com espécie, nível e golpes equipados. damage = dano neutro FINAL por golpe; cooldown = tempo EFETIVO em segundos. Ex.: {"species":"Bulbasaur","level":20,"moves":[{"name":"Golpe","type":"grass","category":"special","damage":30,"cooldown":2}]}');
      if (!text) return;
      try {
        const data = JSON.parse(text);
        if (creatureKey(data.species) !== creatureKey(p.species) || data.level !== p.level || !Array.isArray(data.moves)) throw new Error('Espécie/nível devem corresponder ao ativo.');
        const moves = data.moves.map(m => ({...m,type:typeKey(m.type),damage:num(m.damage),cooldown:num(m.cooldown)}));
        if (!moves.length || moves.some(m => !TYPE_CHART[m.type] || !(m.damage > 0) || !(m.cooldown > 0))) throw new Error('Cada golpe precisa de tipo válido, dano e cooldown positivos.');
        p.moves = moves; state.combatCache.set(collectionFingerprint(p),{moves,combatStats:p.combatStats}); addRecords([p]); render();
      } catch (e) { updateStatus(`Golpes inválidos: ${e.message}`); }
    });
    host.querySelector('[data-action="collection-send"]').addEventListener('click', sendBestToCollection);
    host.querySelector('[data-action="collection-stop"]').addEventListener('click', () => { state.collectionStop = true; state.autoCollection=false; saveAutomationPrefs(); render(); updateStatus('Envios pausados. Uma solicitação já enviada ainda pode ser confirmada.'); });
    host.querySelector('[data-action="farm-load"]').addEventListener('click', loadFarmData);
    host.querySelector('[data-role="farm-pokemon"]').addEventListener('change', e => { state.farmPokemon = e.target.value; render(); });
    host.querySelector('[data-role="farm-goal"]').addEventListener('change', e => { state.farmGoal = e.target.value; render(); });
    host.querySelector('[data-role="attack-type"]').addEventListener('change', e => { state.attackType = e.target.value; render(); });
    host.querySelector('[data-role="trainer-level"]').addEventListener('input', e => { state.trainerLevel = num(e.target.value); render(); });
    host.querySelector('[data-action="farm-import"]').addEventListener('click', () => {
      const text = prompt('Cole um array JSON de hunts: [{"name":"Local","pokemonName":"Oddish","level":20,"minLevel":10,"types":["grass","poison"],"xp":100,"gold":25}]');
      if (!text) return;
      try {
        const data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('Use um array JSON.');
        indexHunts(data); state.farmStatus = `${state.hunts.size} hunts disponíveis após importação.`; render();
      } catch (e) { state.farmStatus = `Importação inválida: ${e.message}`; render(); }
    });
    host.querySelector('.pa-fab').addEventListener('click', () => { state.open = !state.open; render(); if (state.open) scanDOM(); });
    host.querySelector('[data-action="close"]').addEventListener('click', () => { state.open = false; render(); });
    host.querySelector('[data-action="scan"]').addEventListener('click', scanDOM);
    host.querySelector('[data-action="export"]').addEventListener('click', exportData);
    host.querySelector('[data-action="manual"]').addEventListener('click', () => { host.querySelector('[data-role="manual-modal"]').hidden = false; });
    host.querySelector('[data-action="manual-cancel"]').addEventListener('click', () => { host.querySelector('[data-role="manual-modal"]').hidden = true; });
    host.querySelector('[data-action="manual-import"]').addEventListener('click', () => {
      const textarea = host.querySelector('[data-role="manual-text"]');
      const origin = host.querySelector('[data-role="manual-origin"]').value;
      const parsed = parseTextBlock(textarea.value, origin);
      addRecords(parsed);
      updateStatus(`${parsed.length} Pokémon importado(s) manualmente.`);
      if (parsed.length) { textarea.value = ''; host.querySelector('[data-role="manual-modal"]').hidden = true; }
    });
    host.querySelector('[data-action="clear"]').addEventListener('click', () => {
      if (!confirm('Limpar somente o histórico local do analisador? Nada será alterado no jogo.')) return;
      state.records.clear(); localStorage.removeItem(DB_KEY); render(); updateStatus('Histórico local apagado.');
    });
    host.querySelector('[data-role="species"]').addEventListener('change', e => { state.filterSpecies = e.target.value; render(); });
    host.querySelector('[data-role="origin"]').addEventListener('change', e => { state.filterOrigin = e.target.value; render(); });
    host.querySelector('[data-role="search"]').addEventListener('input', e => { state.search = e.target.value; render(); });
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #${APP_ID}-host{--bg:#0b1117;--panel:#111b24;--line:#294052;--gold:#e8b94f;--text:#e8eef3;--muted:#93a6b5;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text);position:relative;z-index:2147483600}
      #${APP_ID}-host *{box-sizing:border-box} #${APP_ID}-host button,#${APP_ID}-host input,#${APP_ID}-host select,#${APP_ID}-host textarea{font:inherit}
      #${APP_ID}-host .pa-fab{position:fixed;right:14px;bottom:14px;border:1px solid #f4cf70;border-radius:999px;background:#172633;color:#ffd86b;font-weight:900;padding:11px 15px;box-shadow:0 5px 22px #0009;cursor:pointer}
      #${APP_ID}-host .pa-panel{display:none;position:fixed;inset:5vh 3vw;background:linear-gradient(145deg,#101c26,#091117);border:1px solid var(--gold);border-radius:12px;box-shadow:0 18px 70px #000c;overflow:hidden;grid-template-rows:auto auto auto 1fr auto}
      #${APP_ID}-host.open .pa-panel{display:grid} #${APP_ID}-host .pa-panel>header{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line)}
      #${APP_ID}-host h2,#${APP_ID}-host h3{margin:0;color:#fff} #${APP_ID}-host header small{color:var(--muted)} #${APP_ID}-host header button{font-size:25px;background:none;border:0;color:#fff;cursor:pointer}
      #${APP_ID}-host .pa-toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #203544} #${APP_ID}-host button,#${APP_ID}-host select,#${APP_ID}-host input,#${APP_ID}-host textarea{border:1px solid var(--line);border-radius:7px;background:#142532;color:var(--text);padding:7px 9px}
      #${APP_ID}-host button{cursor:pointer;color:#ffe18b;font-weight:700} #${APP_ID}-host button.quiet{color:#b8c4cc} #${APP_ID}-host .pa-status{padding:7px 15px;color:#8fc7e8;background:#0b1720}
      #${APP_ID}-host .pa-list{overflow:auto;padding:12px;display:grid;gap:9px} #${APP_ID}-host .pa-card{display:grid;grid-template-columns:75px minmax(350px,1fr) minmax(160px,230px);gap:12px;align-items:center;background:#111d27;border:1px solid #253b4b;border-radius:9px;padding:11px}
      #${APP_ID}-host .pa-content{overflow:auto;min-height:0} #${APP_ID}-host .pa-farm{padding:12px;border-bottom:1px solid var(--gold)} #${APP_ID}-host .pa-farm-row{display:flex;flex-wrap:wrap;gap:8px;padding:9px;margin:5px 0;border:1px solid var(--line);border-radius:7px} #${APP_ID}-host .pa-farm-row small{flex-basis:100%;color:var(--muted)}
      .pa-native-score{display:block;color:#ffe18b;background:#162a35;padding:3px 7px;border-radius:5px;font-weight:bold}
      #${APP_ID}-host .pa-card.best{border-color:var(--gold);box-shadow:inset 3px 0 var(--gold)} #${APP_ID}-host .pa-rank{font-weight:900;color:#f4ca65;text-align:center} #${APP_ID}-host .pa-rank small{display:block;color:var(--muted);font-size:10px;margin-top:4px}
      #${APP_ID}-host .pa-main h3{font-size:16px} #${APP_ID}-host .pa-main h3 small{display:block;font-weight:500;color:#a9bbc7;margin-top:2px} #${APP_ID}-host p{margin:5px 0;color:#b8c6cf} #${APP_ID}-host .pa-notes{color:#96aab8}
      #${APP_ID}-host .pa-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px} #${APP_ID}-host .pa-chips>*{background:#1d3342;border-radius:999px;padding:2px 7px;color:#cce6f7} #${APP_ID}-host .pa-chips b{color:#ffdb78}
      #${APP_ID}-host .pa-decision{display:flex;flex-direction:column;gap:5px;border-left:1px solid #294252;padding-left:12px} #${APP_ID}-host .pa-decision b{color:#76e09a;font-size:15px} #${APP_ID}-host .pa-decision.sell b{color:#ff9a8d} #${APP_ID}-host .pa-decision span{color:#ffd36d} #${APP_ID}-host .pa-decision small{color:#93a5b1}
      #${APP_ID}-host footer{padding:9px 14px;border-top:1px solid #223847;color:#8396a3;font-size:11px} #${APP_ID}-host .pa-empty{padding:30px;text-align:center;color:#9db0bc}
      #${APP_ID}-host .pa-modal{position:fixed;inset:0;background:#000b;display:grid;place-items:center;padding:20px} #${APP_ID}-host .pa-modal[hidden]{display:none} #${APP_ID}-host .pa-modal>div{width:min(720px,95vw);background:#111e28;border:1px solid var(--gold);border-radius:10px;padding:17px} #${APP_ID}-host textarea{display:block;width:100%;resize:vertical;margin:10px 0} #${APP_ID}-host .pa-actions{display:flex;justify-content:flex-end;gap:8px}
      @media(max-width:800px){#${APP_ID}-host .pa-panel{inset:2vh 2vw}#${APP_ID}-host .pa-card{grid-template-columns:55px 1fr}#${APP_ID}-host .pa-decision{grid-column:1/-1;border-left:0;border-top:1px solid #294252;padding:8px 0 0}#${APP_ID}-host .pa-toolbar>*{flex:1 1 140px}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const automationPrefs=loadJSON(`${APP_ID}:automation`,{});
  state.autoCollection=false;
  state.farmAlerts=false;
  state.alertThreshold=15;
  state.autoHunts=automationPrefs.autoHunts===true;
  state.autoCapture=automationPrefs.autoCapture===true;
  state.xpPriority=100;
  state.alertTimes=loadJSON(`${APP_ID}:alert-times`,{});
  installPassiveWebSocketReader();
  state.evaluationCache = loadJSON(`${APP_ID}:evaluation:v1`, {});
  const saved = loadJSON(DB_KEY, []);
  saved.forEach(p => state.records.set(keyOf(p), enrich(p)));
  const start = () => { injectStyles(); mount(); if (/(^|\.)pokeidle\.io$/.test(location.hostname)) loadFarmData(); if (window.pokeidleLauncher?.captures) setInterval(resendSessionCaptures,60000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
