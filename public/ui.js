import { WEAPONS, EQUIPMENT } from '../shared/weapons.js';
import { MAPS, getMap } from '../shared/map-data.js';
import { SKINS, CRATES, RARITY_LABELS, RARITY_COLORS } from '../shared/cosmetics.js';
import { inZone } from '../shared/physics.js';

const $ = id => document.getElementById(id);
const DEFAULTS = Object.freeze({sensitivity: 1, master: .7, effects: .8, quality: 'medium', fov: 85, showFPS: false, renderScale: 1, reducedFlash: false, showNames: true});
const EQUIPMENT_LABELS = {
  armor: ['Colete', 'Proteção para o tronco'], helmet: ['Capacete + colete', 'Proteção da cabeça e colete completo'],
  kit: ['Kit de desarme', 'Desarme a bomba em 3,5 segundos'], smoke: ['Smoke', '15 segundos de cobertura visual'], flash: ['Flashbang', 'Desoriente os adversários próximos']
};
const WEAPON_HINTS = {glock: '20 projéteis · semi / burst', usp: '12 projéteis · silenciada', ak: '30 projéteis · alto impacto', m4: '30 projéteis · recuo controlável', awp: '5 projéteis · mira de precisão', vector: 'SMG · disparo automático', scatter: 'Escopeta · múltiplos projéteis', pulse: 'Rifle · rajadas de 3 tiros'};
const CONTROLS = [
  ['Movimentar', 'W A S D'], ['Olhar ao redor', 'MOUSE'], ['Pular / dash aéreo', 'ESPAÇO / ESPAÇO + C'], ['Andar em silêncio', 'SHIFT'],
  ['Agachar / deslizar', 'C / CTRL'], ['Atirar', 'MOUSE 1'], ['Mira / modo secundário', 'MOUSE 2'], ['Recarregar', 'R'],
  ['Comprar equipamentos', 'B'], ['Plantar / desarmar', 'E'], ['Rifle / pistola / faca', '1 / 2 / 3'], ['Smoke / Flashbang', '4 / 5'],
  ['Soltar a bomba', 'G'], ['Placar', 'TAB'], ['Menu / liberar mouse', 'ESC'], ['Trocar espectador', 'CLIQUE / ← →']
];
const REASONS = {
  eliminated: 'Todos os adversários foram eliminados.', elimination: 'Todos os adversários foram eliminados.',
  explosion: 'A bomba explodiu. Objetivo concluído.', exploded: 'A bomba explodiu. Objetivo concluído.', bomb: 'A bomba explodiu. Objetivo concluído.',
  defused: 'A bomba foi desarmada.', defuse: 'A bomba foi desarmada.', time: 'O tempo terminou sem plantio.', timeout: 'O tempo terminou sem plantio.',
  disconnect: 'A equipe adversária deixou a partida.'
};

function saved(key, fallback) {
  try { const value = localStorage.getItem(key); return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}
function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsers can deny storage. */ } }
function text(id, value) { const node = $(id); if (node && node.textContent !== String(value)) node.textContent = value; }
function toggle(id, show) { $(id)?.classList.toggle('hidden', !show); }
function money(value) { return `$ ${Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('pt-BR')}`; }
function sanitizeSettings(value) {
  const output = {...DEFAULTS};
  for (const key of ['sensitivity', 'master', 'effects', 'fov', 'renderScale']) {
    if (Number.isFinite(Number(value?.[key]))) output[key] = Number(value[key]);
  }
  output.sensitivity = Math.min(3, Math.max(.3, output.sensitivity));
  output.master = Math.min(1, Math.max(0, output.master)); output.effects = Math.min(1, Math.max(0, output.effects));
  output.fov = Math.min(110, Math.max(65, output.fov)); output.renderScale = Math.min(1.5, Math.max(.5, output.renderScale));
  output.quality = ['low', 'medium', 'high'].includes(value?.quality) ? value.quality : DEFAULTS.quality;
  output.showNames = value?.showNames !== false;
  output.showFPS = !!value?.showFPS; output.reducedFlash = !!value?.reducedFlash;
  return output;
}

/** DOM-only interface. Game, network and WebGL state stay in their own modules. */
export class UI {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this._screen = 'menu'; this._paused = false; this._buyOpen = false; this._scoreOpen = false; this._modal = null;
    this._settings = sanitizeSettings(saved('counter-block.settings', DEFAULTS));
    this._category = 'secondary'; this._localId = null; this._state = null; this._player = null;
    this._settingsReturn = 'menu'; this._controlsReturn = 'menu'; this._lastBuyKey = ''; this._roomKey = '';
    this._profile = null; this._profileKey = ''; this._collectionTab = 'crates'; this._socialReturn = 'menu'; this._openingCrate = false;
    this._toasts = new Set(); this._feedTimers = new Set();
    $('nickname').value = String(saved('counter-block.nickname', '')).slice(0, 18);
    this.bindButtons(); this.bindSocial(); this.bindSettings(); this.renderControls(); this.showScreen('menu');
  }

  get settings() { return {...this._settings}; }
  get nickname() { return $('nickname').value.trim(); }
  get paused() { return this._paused; }
  get buyOpen() { return this._buyOpen; }
  get screen() { return this._screen; }
  get modal() { return this._modal; }

  async invoke(name, ...args) {
    try { return await this.callbacks[name]?.(...args); }
    catch (error) { this.toast(error?.message || 'Não foi possível concluir a ação.'); return null; }
  }

  bindButtons() {
    $('main-play').addEventListener('click', () => this.showScreen('play'));
    $('main-settings').addEventListener('click', () => this.showSettings('menu'));
    $('main-controls').addEventListener('click', () => this.showControls('menu'));
    $('nav-controls').addEventListener('click', () => this.showControls(this._screen));
    $('brand-home').addEventListener('click', event => { event.preventDefault(); this.goHome(); });
    document.querySelectorAll('[data-screen]').forEach(button => button.addEventListener('click', () => this.goHome()));
    document.querySelectorAll('[data-back]').forEach(button => button.addEventListener('click', () => this.showScreen(button.dataset.back)));
    $('nickname').addEventListener('input', () => store('counter-block.nickname', this.nickname));
    $('room-code').addEventListener('input', event => { event.target.value = event.target.value.replace(/[^a-z]/gi, '').toUpperCase(); });
    $('create-room').addEventListener('click', () => this.requestRoom('create'));
    $('join-form').addEventListener('submit', event => { event.preventDefault(); this.requestRoom('join'); });
    $('join-t').addEventListener('click', () => this.invoke('team', 'T'));
    $('join-ct').addEventListener('click', () => this.invoke('team', 'CT'));
    $('ready-button').addEventListener('click', () => this.invoke('ready'));
    $('start-match').addEventListener('click', () => this.invoke('start'));
    $('copy-code').addEventListener('click', async () => {
      if (this.callbacks.copy) { await this.invoke('copy'); return; }
      try { await navigator.clipboard.writeText(this._state?.code || ''); this.toast('Código da sala copiado.'); }
      catch { this.toast(`Código da sala: ${this._state?.code || ''}`); }
    });
    $('lobby-leave').addEventListener('click', () => this.invoke('leave'));
    $('pause-leave').addEventListener('click', () => this.invoke('leave'));
    $('resume-game').addEventListener('click', () => this.invoke('resume'));
    $('pause-settings').addEventListener('click', () => this.showSettings('pause'));
    $('pause-controls').addEventListener('click', () => this.showControls('pause'));
    $('settings-back').addEventListener('click', () => this.closeSettings());
    $('controls-back').addEventListener('click', () => this.closeControls());
    $('buy-close').addEventListener('click', () => { this.showBuy(false); this.invoke('resume'); });
    $('restart-match').addEventListener('click', () => this.invoke('restart'));
    document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
      this._category = button.dataset.category;
      document.querySelectorAll('[data-category]').forEach(tab => tab.classList.toggle('active', tab === button));
      this.renderBuy();
    }));
    // These overlays own Escape even when a slider or select has focus.
    document.addEventListener('keydown', event => {
      if (event.code !== 'Escape' || !['settings', 'controls', 'friends', 'collection'].includes(this._modal)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (this._modal === 'settings') this.closeSettings(); else if (this._modal === 'controls') this.closeControls(); else this.closeSocial();
    }, true);
  }


  bindSocial() {
    $('main-friends').addEventListener('click', () => this.showFriends());
    $('main-collection').addEventListener('click', () => this.showCollection());
    $('pause-friends').addEventListener('click', () => this.showFriends('pause'));
    $('pause-collection').addEventListener('click', () => this.showCollection('pause'));
    $('fullscreen-button').addEventListener('click', () => this.invoke('fullscreen'));
    $('friends-back').addEventListener('click', () => this.closeSocial());
    $('collection-back').addEventListener('click', () => this.closeSocial());
    $('friend-code').addEventListener('input', event => { event.target.value = event.target.value.replace(/[^a-z]/gi, '').toUpperCase(); });
    $('friend-form').addEventListener('submit', async event => {
      event.preventDefault();
      const code = $('friend-code').value.trim().toUpperCase();
      if (!/^[A-Z]{8}$/.test(code)) return this.toast('O código de amigo tem 8 letras.');
      if (!this._profile) return this.toast('Aguarde a conexão com seu perfil.');
      const button = $('friend-form').querySelector('button'); button.disabled = true;
      await this.invoke('friendRequest', code); button.disabled = false;
    });
    $('copy-profile-code').addEventListener('click', async () => {
      if (!this._profile) return;
      try { await navigator.clipboard.writeText(this._profile.id); this.toast('Código de amigo copiado.'); }
      catch { this.toast(`Seu código de amigo: ${this._profile.id}`); }
    });
    for (const type of ['weapon', 'character']) $(`open-${type}-crate`).addEventListener('click', async () => {
      if (this._openingCrate || !this._profile || !(this._profile.crates?.[type] > 0)) return;
      this._openingCrate = true; this.renderCollection();
      await this.invoke('openCrate', type);
      this._openingCrate = false; this.renderCollection();
    });
    document.querySelectorAll('[data-collection]').forEach(button => button.addEventListener('click', () => {
      this._collectionTab = button.dataset.collection; this.renderCollection();
    }));
    const select = $('map-select');
    for (const map of Object.values(MAPS)) {
      const option = document.createElement('option'); option.value = map.id; option.textContent = map.name; select.append(option);
    }
    select.addEventListener('change', () => this.invoke('selectMap', select.value));
    this.renderFriends(); this.renderCollection();
  }

  showFriends(returnTo = this._screen === 'game' ? 'pause' : this._screen) {
    this.closeOverlays(); this._socialReturn = returnTo; this._modal = 'friends';
    toggle('overlay-friends', true); this.renderFriends();
  }

  showCollection(returnTo = this._screen === 'game' ? 'pause' : this._screen) {
    this.closeOverlays(); this._socialReturn = returnTo; this._modal = 'collection';
    toggle('overlay-collection', true); this.renderCollection();
  }

  closeSocial() {
    toggle('overlay-friends', false); toggle('overlay-collection', false); this._modal = null;
    if (this._socialReturn === 'pause') this.showPause(true);
  }

  /** Profile state is owned by the server. Rendering never grants items or friends. */
  updateProfile(profile) {
    this._profile = profile || null;
    const key = JSON.stringify(profile);
    if (key === this._profileKey) return;
    this._profileKey = key;
    text('menu-profile-code', profile?.id || 'CONECTANDO');
    text('friends-count', profile?.friends?.length || 0);
    text('cases-count', (profile?.crates?.weapon || 0) + (profile?.crates?.character || 0));
    this.renderFriends(); this.renderCollection();
  }

  renderFriends() {
    const profile = this._profile;
    text('profile-code', profile?.id || 'CONECTANDO');
    $('friend-form').querySelector('button').disabled = !profile;
    $('copy-profile-code').disabled = !profile;
    text('friend-count', profile?.friends?.length || 0); text('request-count', profile?.requests?.length || 0);
    const list = $('friend-list'), requests = $('friend-requests'); list.replaceChildren(); requests.replaceChildren();
    const empty = (container, value) => { const node = document.createElement('p'); node.className = 'social-empty'; node.textContent = value; container.append(node); };
    if (!profile?.friends?.length) empty(list, 'Sua lista está vazia. Troque códigos para adicionar seus amigos.');
    if (!profile?.requests?.length) empty(requests, 'Nenhuma solicitação pendente.');
    for (const [collection, container, incoming] of [[profile?.friends || [], list, false], [profile?.requests || [], requests, true]]) {
      for (const friend of collection) {
        const row = document.createElement('div'); row.className = `social-row${friend.online ? ' is-online' : ''}`;
        const label = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('small');
        name.textContent = friend.nickname || friend.id;
        detail.textContent = incoming ? friend.id : `${friend.id} · ${friend.online ? (friend.roomCode || friend.room) ? 'EM SALA' : 'ONLINE' : 'OFFLINE'}`;
        label.append(name, detail); row.append(label);
        const action = (textValue, callback, disabled = false) => {
          const button = document.createElement('button'); button.className = 'button secondary'; button.textContent = textValue; button.disabled = disabled;
          button.addEventListener('click', async () => { button.disabled = true; await this.invoke(callback, friend.id); this.renderFriends(); }); row.append(button);
        };
        if (incoming) action('ACEITAR', 'friendAccept');
        else { action('ENTRAR', 'friendJoin', !friend.online || !(friend.roomCode || friend.room)); action('REMOVER', 'friendRemove'); }
        container.append(row);
      }
    }
  }

  renderCollection() {
    const profile = this._profile, tab = this._collectionTab;
    document.querySelectorAll('[data-collection]').forEach(button => button.classList.toggle('active', button.dataset.collection === tab));
    toggle('collection-crates', tab === 'crates'); toggle('collection-skins', tab !== 'crates');
    for (const type of ['weapon', 'character']) {
      text(`${type}-crate-count`, profile?.crates?.[type] || 0);
      $(`open-${type}-crate`).disabled = this._openingCrate || !profile || !(profile.crates?.[type] > 0);
    }
    const odds = Object.values(CRATES).map(crate => {
      const totals = {};
      for (const drop of crate.drops || []) { const rarity = SKINS[drop.skin]?.rarity || 'common'; totals[rarity] = (totals[rarity] || 0) + drop.weight; }
      const total = Object.values(totals).reduce((sum, weight) => sum + weight, 0) || 1;
      return `${crate.name}: ${Object.entries(totals).map(([rarity, weight]) => `${RARITY_LABELS[rarity] || rarity} ${Math.round(weight / total * 100)}%`).join(' · ')}`;
    });
    text('crate-odds', `${odds.join(' | ')}. Repetidas são identificadas; cada abertura consome uma caixa.`);
    text('profile-sync-note', profile ? `PERFIL ${profile.id} · SALVO NESTE SERVIDOR · COSMÉTICOS SEM VANTAGEM DE COMBATE` : 'Conecte-se ao servidor para acessar sua coleção.');
    const list = $('collection-skins'); list.replaceChildren();
    if (tab !== 'crates') {
      for (const id of profile?.owned || []) {
        const skin = SKINS[id]; if (!skin || (skin.kind !== tab && skin.kind !== 'both')) continue;
        const card = document.createElement('article'); card.className = 'skin-card'; card.dataset.skin = id;
        card.style.setProperty('--rarity-color', RARITY_COLORS[skin.rarity] || '#b6d2de');
        const preview = document.createElement('div'); preview.className = `skin-preview ${tab}`;
        for (const color of Object.values(skin.colors || {}).slice(0, 4)) { const swatch = document.createElement('i'); swatch.style.background = color; preview.append(swatch); }
        const title = document.createElement('h3'); title.textContent = skin.name;
        const rarity = document.createElement('small'); rarity.textContent = RARITY_LABELS[skin.rarity] || skin.rarity;
        const button = document.createElement('button'); button.className = 'button secondary full';
        const equipped = (profile?.equipped?.[tab] || 'default') === id;
        button.textContent = equipped ? 'EQUIPADO ✓' : 'EQUIPAR'; button.disabled = equipped;
        button.addEventListener('click', async () => { button.disabled = true; await this.invoke('equipSkin', tab, id); this.renderCollection(); });
        card.append(preview, title, rarity, button); list.append(card);
      }
      if (!list.childElementCount) { const empty = document.createElement('p'); empty.className = 'social-empty'; empty.textContent = 'Abra caixas para conquistar novos visuais.'; list.append(empty); }
    }
    const drop = profile?.lastDrop, dropId = typeof drop?.skin === 'string' ? drop.skin : drop?.skinId || drop?.skin?.id;
    const skin = SKINS[dropId]; toggle('crate-result', !!skin);
    if (skin) {
      $('crate-result').style.setProperty('--rarity-color', RARITY_COLORS[skin.rarity] || '#b6d2de');
      text('crate-result', `${drop.duplicate ? 'VISUAL REPETIDO' : 'NOVO VISUAL'} · ${skin.name} · ${RARITY_LABELS[skin.rarity] || skin.rarity}`);
    }
  }

  goHome() {
    if (this._screen === 'lobby' || this._screen === 'game') { this.invoke('leave'); return; }
    this.showScreen('menu');
  }

  async requestRoom(action) {
    const nickname = this.nickname;
    if (nickname.length < 2) { this.toast('Escolha um nickname com pelo menos 2 caracteres.'); $('nickname').focus(); return; }
    const code = $('room-code').value.trim().toUpperCase();
    if (action === 'join' && !/^[A-Z]{5}$/.test(code)) { this.toast('O código deve conter 5 letras.'); $('room-code').focus(); return; }
    store('counter-block.nickname', nickname);
    const createButton = $('create-room'), joinButton = $('join-form').querySelector('button');
    createButton.disabled = true; joinButton.disabled = true;
    try { await this.invoke(action, ...(action === 'join' ? [code, nickname] : [nickname])); }
    finally { createButton.disabled = false; joinButton.disabled = false; }
  }

  bindSettings() {
    const display = key => {
      const element = $(`setting-${key}`), value = this._settings[key];
      if (element.type === 'checkbox') element.checked = value; else element.value = value;
      const output = $(`out-${key}`);
      if (output) output.value = key === 'sensitivity' ? `${Number(value).toFixed(2)}×` : key === 'fov' ? `${value}°` : `${Math.round(value * 100)}%`;
    };
    for (const key of Object.keys(DEFAULTS)) {
      display(key);
      const element = $(`setting-${key}`);
      element.addEventListener(element.type === 'checkbox' || element.tagName === 'SELECT' ? 'change' : 'input', () => {
        this._settings[key] = element.type === 'checkbox' ? element.checked : key === 'quality' ? element.value : Number(element.value);
        store('counter-block.settings', this._settings); display(key); this.invoke('settings', this.settings);
      });
    }
  }

  renderControls() {
    const list = $('controls-list');
    for (const [label, key] of CONTROLS) {
      const row = document.createElement('div'); row.className = 'control-row';
      const name = document.createElement('span'); name.textContent = label;
      const keys = document.createElement('kbd'); keys.textContent = key;
      row.append(name, keys); list.append(row);
    }
  }

  showScreen(name) {
    if (!['menu', 'play', 'lobby', 'game'].includes(name)) return;
    this._screen = name;
    document.querySelectorAll('main > .screen').forEach(screen => screen.classList.toggle('hidden', screen.id !== `screen-${name}`));
    document.body.classList.toggle('in-game', name === 'game');
    this.closeOverlays();
    if (name === 'play') setTimeout(() => (this.nickname ? $('room-code') : $('nickname')).focus(), 50);
  }

  closeOverlays() {
    for (const name of ['pause', 'settings', 'controls', 'buy', 'score', 'friends', 'collection']) toggle(`overlay-${name}`, false);
    this._paused = false; this._buyOpen = false; this._scoreOpen = false; this._modal = null;
  }

  showPause(visible) {
    this._paused = !!visible; toggle('overlay-pause', visible);
    if (visible) { this.showBuy(false); this.showScore(false); this._modal = 'pause'; }
    else if (this._modal === 'pause') this._modal = null;
  }

  showSettings(returnTo = this._screen) {
    this._settingsReturn = returnTo; toggle('overlay-pause', false); toggle('overlay-controls', false);
    toggle('overlay-settings', true); this._modal = 'settings';
  }

  closeSettings() {
    toggle('overlay-settings', false); this._modal = null;
    if (this._settingsReturn === 'pause') this.showPause(true);
  }

  showControls(returnTo = this._screen) {
    this._controlsReturn = returnTo; toggle('overlay-pause', false); toggle('overlay-settings', false);
    toggle('overlay-controls', true); this._modal = 'controls';
  }

  closeControls() {
    toggle('overlay-controls', false); this._modal = null;
    if (this._controlsReturn === 'pause') this.showPause(true);
  }

  /** Rendering only when lobby contents change avoids rebuilding player rows per snapshot. */
  updateRoom(state, localId) {
    this._state = state; this._localId = localId;
    if (!state) return;
    const players = state.players || [], local = players.find(player => player.id === localId);
    const host = state.host || state.hostId;
    text('lobby-code', state.code || '—'); text('game-code', state.code || '—');
    const key = JSON.stringify([host, players.map(p => [p.id, p.nickname, p.team, p.connected, p.ready]), localId]);
    if (key !== this._roomKey) {
      this._roomKey = key;
      for (const team of ['T', 'CT']) {
        const teamPlayers = players.filter(player => player.team === team), list = $(`team-${team.toLowerCase()}`);
        text(`count-${team.toLowerCase()}`, `${teamPlayers.length} / 5`); list.replaceChildren();
        for (let index = 0; index < 5; index++) {
          const player = teamPlayers[index], row = document.createElement('div');
          row.className = `lobby-player${player ? player.connected === false ? ' disconnected' : '' : ' empty'}`;
          const number = document.createElement('span'); number.className = 'player-number'; number.textContent = String(index + 1).padStart(2, '0'); row.append(number);
          const nickname = document.createElement('span'); nickname.className = 'player-name'; nickname.textContent = player?.nickname || 'Aguardando jogador'; row.append(nickname);
          if (player) {
            if (player.id === localId) { const you = document.createElement('span'); you.className = 'player-you'; you.textContent = 'VOCÊ'; row.append(you); }
            if (player.id === host || player.host) { const badge = document.createElement('span'); badge.className = 'player-host'; badge.textContent = 'HOST'; row.append(badge); }
            const status = document.createElement('span'); status.className = `player-state${player.ready ? '' : ' waiting'}`;
            status.textContent = player.connected === false ? 'DESCONECTOU' : player.ready ? 'PRONTO ✓' : 'PREPARANDO'; row.append(status);
          }
          list.append(row);
        }
        const button = $(`join-${team.toLowerCase()}`);
        button.disabled = local?.team === team || teamPlayers.length >= 5;
        button.textContent = local?.team === team ? 'SEU TIME ✓' : `ENTRAR NO TIME ${team} →`;
      }
    }
    const map = getMap(state.mapId);
    text('lobby-map-name', map.name);
    text('map-dimensions', `${map.bounds.maxX-map.bounds.minX} × ${map.bounds.maxZ-map.bounds.minZ} m · HOST ESCOLHE A ARENA`);
    $('map-select').value = map.id || 'dust';
    $('map-select').disabled = host !== localId || state.phase !== 'lobby';
    const isHost = host === localId;
    $('start-match').disabled = !isHost;
    $('start-match').title = isHost ? 'Iniciar a partida' : 'Apenas o host pode iniciar a partida';
    text('ready-button', local?.ready ? 'CANCELAR PRONTO' : 'ESTOU PRONTO ✓');
    text('lobby-status', isHost ? players.length === 1 ? 'Você pode iniciar sozinho para conhecer o mapa.' : 'Você é o host. Todos precisam estar prontos para iniciar.' : 'Confirme que está pronto. O host inicia a partida.');
    toggle('restart-match', state.phase === 'finished' && isHost);
  }

  updateHUD(state, player, stats = {}) {
    if (!state) return;
    this._state = state; this._player = player;
    if (player?.id) this._localId = player.id;
    const map = getMap(state.mapId);
    const players = state.players || [], bomb = state.bomb || {}, now = stats.now || state.serverTime || Date.now();
    text('score-t', state.score?.T || 0); text('score-ct', state.score?.CT || 0);
    text('alive-t', `${players.filter(p => p.team === 'T' && p.alive).length} VIVOS`);
    text('alive-ct', `${players.filter(p => p.team === 'CT' && p.alive).length} VIVOS`);
    text('round-label', `ROUND ${String(state.round || 1).padStart(2, '0')}`);
    const bombPlanted = bomb.state === 'planted';
    const ends = bombPlanted ? bomb.explodesAt : state.roundEndsAt;
    const remaining = Math.max(0, Math.ceil(((ends || now) - now) / 1000));
    text('round-time', state.phase === 'finished' ? 'FIM' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`);
    text('bomb-state', bombPlanted ? `BOMBA PLANTADA · ${bomb.site || ''}` : bomb.state === 'dropped' ? 'BOMBA NO CHÃO' : map.name.toUpperCase());
    const cooldown = Math.max(0, stats.dashCooldown ?? player?.dashCooldown ?? 0);
    text('dash-status', stats.slideTime > 0 || player?.slideTime > 0 ? 'DESLIZANDO' : stats.dashTime > 0 || player?.dashTime > 0 ? 'DASH!' : cooldown > 0 ? `DASH · ${cooldown.toFixed(1)}s` : 'DASH PRONTO · ESPAÇO + C');
    $('dash-status').classList.toggle('dash-ready', cooldown <= 0);
    document.querySelector('.round-clock').classList.toggle('planted', bombPlanted);
    text('network-stats', `${Math.max(0, Math.round(stats.ping ?? player?.ping ?? 0))} MS`);
    toggle('fps-display', this._settings.showFPS); text('fps-display', `${Math.round(stats.fps || 0)} FPS`);
    toggle('spectator', !!player && !player.alive && state.phase === 'playing');
    if (stats.spectating) $('spectator').querySelector('b').textContent = `ESPECTANDO ${String(stats.spectating).toUpperCase()}`;
    else $('spectator').querySelector('b').textContent = 'VOCÊ ESTÁ ESPECTANDO';
    if (player) {
      const weapon = WEAPONS[player.weapon], ammo = player.ammo?.[player.weapon] || {};
      text('health-value', Math.max(0, Math.ceil(player.hp ?? 100))); text('armor-value', player.armor || 0);
      text('money-value', money(player.money)); text('weapon-name', weapon?.name || (player.weapon === 'smoke' ? 'SMOKE' : player.weapon === 'flash' ? 'FLASHBANG' : 'SEM ARMA'));
      text('ammo-value', weapon?.melee ? '∞' : ammo.mag ?? (player.inventory?.includes(player.weapon) ? 1 : '—')); text('reserve-value', ammo.reserve ?? '—');
      text('reload-label', player.reloadingAt > now || player.reloadUntil > now || player.reloading ? 'RECARREGANDO' : player.burst && player.weapon === 'glock' ? 'MODO BURST' : player.scoped ? 'MIRA ATIVA' : 'PRONTA');
      toggle('bomb-carrier', bomb.carrier === player.id && bomb.state === 'carried');
      const buyLeft = Math.max(0, Math.ceil(((state.buyEndsAt || 0) - now) / 1000));
      const canBuy = player.alive && state.phase === 'playing' && buyLeft > 0 && map.buyZones?.[player.team] && inZone(player, map.buyZones[player.team]);
      toggle('buy-hint', !!canBuy);
      text('buy-hint', canBuy ? `[B] COMPRAR · ${buyLeft}s` : '');
      const interaction = player.interaction;
      this.setInteraction(interaction);
      let location = map.name.toUpperCase();
      if (map.sites) { for (const [site, zone] of Object.entries(map.sites)) if (inZone(player, zone)) location = `BOMBSITE ${site}`; }
      if (map.buyZones?.[player.team] && inZone(player, map.buyZones[player.team])) location = `BASE ${player.team}`;
      text('location-label', location);
      let context = '';
      if (player.alive && state.phase === 'playing' && !interaction) {
        const bombDistance = Math.hypot(player.x - (bomb.x || 0), player.y - (bomb.y || 0), player.z - (bomb.z || 0));
        if (player.team === 'T' && bomb.carrier === player.id && Object.values(map.sites || {}).some(zone => inZone(player, zone))) context = '[E] SEGURE PARA PLANTAR A BOMBA';
        else if (player.team === 'CT' && bomb.state === 'planted' && bombDistance < 3) context = `[E] SEGURE PARA DESARMAR${player.kit ? ' · COM KIT' : ''}`;
        else if (player.team === 'T' && bomb.state === 'dropped' && bombDistance < 3) context = 'APROXIME-SE PARA RECUPERAR A BOMBA';
      }
      text('center-message', context);
      const inventory = Array.isArray(player.inventory) ? player.inventory : Object.keys(player.inventory || {});
      const key = `${player.weapon}/${inventory.join(',')}/${player.kit}/${player.helmet}`;
      if (this._equipmentKey !== key) {
        this._equipmentKey = key; const bar = $('equipment-bar'); bar.replaceChildren();
        const primary = inventory.find(id => WEAPONS[id]?.slot === 'primary'), secondary = inventory.find(id => WEAPONS[id]?.slot === 'secondary');
        for (const [slot, id] of [[1, primary], [2, secondary], [3, inventory.includes('knife') && 'knife'], [4, inventory.includes('smoke') && 'smoke'], [5, inventory.includes('flash') && 'flash']]) {
          if (!id) continue;
          const line = document.createElement('span'); line.textContent = `${slot}  ${WEAPONS[id]?.name || id.toUpperCase()}`;
          line.className = player.weapon === id ? 'equipped' : ''; bar.append(line);
        }
        if (player.kit || player.helmet) { const line = document.createElement('span'); line.textContent = [player.kit && 'KIT', player.helmet && 'CAPACETE'].filter(Boolean).join(' · '); bar.append(line); }
      }
      if (this._buyOpen) {
        const buyKey = `${player.money}/${inventory.join(',')}/${player.kit}/${player.armor}/${player.helmet}/${player.alive}/${canBuy}`;
        if (buyKey !== this._lastBuyKey) { this._lastBuyKey = buyKey; this.renderBuy(); }
        text('buy-status', canBuy ? `JANELA DE COMPRA · ${buyLeft}s · VOCÊ ESTÁ NA BASE ${player.team}` : !player.alive ? 'Você precisa estar vivo para comprar.' : buyLeft <= 0 ? 'O período de compra terminou. Próxima oportunidade no próximo round.' : 'Volte à área de compra da sua equipe.');
      }
    } else { this.setInteraction(null); text('center-message', ''); }
    const result = state.phase === 'ended' || state.phase === 'finished';
    toggle('round-result', result);
    if (result) {
      text('result-eyebrow', state.phase === 'finished' ? 'PARTIDA ENCERRADA' : `ROUND ${String(state.round || 1).padStart(2, '0')} ENCERRADO`);
      text('result-title', state.winner === 'draw' ? 'EMPATE' : state.winner ? `VITÓRIA ${state.winner}` : 'ROUND ENCERRADO');
      text('result-reason', REASONS[state.reason] || state.reason || (state.phase === 'finished' ? 'Uma nova partida pode ser iniciada pelo host.' : 'Prepare-se para o próximo round.'));
      toggle('restart-match', state.phase === 'finished' && (state.host || state.hostId) === player?.id);
    }
    if (this._scoreOpen) this.renderScore(state);
  }

  setInteraction(interaction) {
    const active = !!interaction && (interaction.type === 'plant' || interaction.type === 'defuse') && interaction.progress > 0;
    toggle('interaction', active);
    if (active) {
      text('interaction-label', interaction.type === 'plant' ? 'PLANTANDO A BOMBA' : 'DESARMANDO A BOMBA');
      $('interaction-fill').style.width = `${Math.min(1, Math.max(0, interaction.progress)) * 100}%`;
    }
  }

  showBuy(visible, player = this._player) {
    this._buyOpen = !!visible; this._player = player; toggle('overlay-buy', visible);
    if (visible) { this._modal = 'buy'; this.showScore(false); this.renderBuy(); }
    else if (this._modal === 'buy') this._modal = null;
  }

  renderBuy() {
    const player = this._player || {}, inventory = Array.isArray(player.inventory) ? player.inventory : Object.keys(player.inventory || {});
    const state = this._state, map = getMap(state?.mapId), canBuy = player.alive && state?.phase === 'playing' && state.buyEndsAt > state.serverTime && inZone(player, map.buyZones?.[player.team]);
    text('buy-balance', money(player.money));
    const list = $('buy-items'); list.replaceChildren();
    const items = this._category === 'primary' || this._category === 'secondary'
      ? Object.entries(WEAPONS).filter(([, weapon]) => weapon.slot === this._category && (!weapon.team || weapon.team === 'both' || weapon.team === player.team)).map(([id, weapon]) => [id, weapon.name, weapon.price, WEAPON_HINTS[id] || weapon.slot])
      : Object.entries(EQUIPMENT).filter(([id]) => this._category === 'grenade' ? id === 'smoke' || id === 'flash' : ['armor', 'helmet', 'kit'].includes(id)).filter(([id]) => id !== 'kit' || player.team === 'CT').map(([id, equipment]) => [id, EQUIPMENT_LABELS[id]?.[0] || id, typeof equipment === 'number' ? equipment : equipment.price, EQUIPMENT_LABELS[id]?.[1] || 'Equipamento']);
    for (const [id, name, price, hint] of items) {
      const owned = inventory.includes(id) || id === 'armor' && player.armor >= 100 || id === 'helmet' && player.helmet || id === 'kit' && player.kit;
      const button = document.createElement('button'); button.className = `buy-item${owned ? ' owned' : ''}`; button.disabled = !!owned || (player.money || 0) < price || !canBuy;
      const label = document.createElement('span'); label.textContent = name;
      const detail = document.createElement('small'); detail.textContent = hint; label.append(detail);
      const cost = document.createElement('b'); cost.textContent = owned ? 'EQUIPADO ✓' : money(price);
      button.append(label, cost);
      button.addEventListener('click', async () => { button.disabled = true; await this.invoke('buy', id); if (this._buyOpen) this.renderBuy(); });
      list.append(button);
    }
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'panel-copy'; empty.textContent = 'Nenhum equipamento disponível para esta equipe.'; list.append(empty); }
  }

  showScore(visible, state = this._state) {
    this._scoreOpen = !!visible; toggle('overlay-score', visible);
    if (visible && state) this.renderScore(state);
  }

  renderScore(state) {
    const rows = $('score-rows'); rows.replaceChildren();
    const players = [...(state.players || [])].sort((a, b) => a.team.localeCompare(b.team) || b.kills - a.kills || a.nickname.localeCompare(b.nickname));
    for (const player of players) {
      const row = document.createElement('tr'); row.className = `${player.team === 'T' ? 't' : 'ct'}-row${player.id === this._localId ? ' own-row' : ''}`;
      for (const value of [`${player.nickname}${player.alive ? '' : ' †'}${player.connected === false ? ' (offline)' : ''}`, player.team, player.kills || 0, player.deaths || 0, player.assists || 0, player.score ?? (player.kills || 0) * 2 + (player.assists || 0), `${Math.round(player.ping || 0)} ms`]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      rows.append(row);
    }
  }

  toast(message) {
    if (!message) return;
    const node = document.createElement('div'); node.className = 'toast'; node.textContent = String(message); $('toast-container').append(node);
    while ($('toast-container').childElementCount > 3) $('toast-container').firstElementChild.remove();
    const timer = setTimeout(() => { node.remove(); this._toasts.delete(timer); }, 4500); this._toasts.add(timer);
  }

  feed(event) {
    if (!event) return;
    if (event.type !== 'kill') { if (event.message) this.toast(event.message); return; }
    const players = this._state?.players || [];
    const killer = players.find(p => p.id === (event.killer || event.attacker)), victim = players.find(p => p.id === (event.victim || event.target));
    const row = document.createElement('div'); row.className = 'feed-row';
    const attacker = document.createElement('span'); attacker.className = `feed-name-${(killer?.team || event.killerTeam || 'T').toLowerCase()}`; attacker.textContent = killer?.nickname || event.killerName || event.attackerName || 'Ambiente';
    const weapon = document.createElement('span'); weapon.className = 'feed-weapon'; weapon.textContent = WEAPONS[event.weapon]?.name || (event.weapon === 'bomb' ? 'BOMBA' : '→');
    const target = document.createElement('span'); target.className = `feed-name-${(victim?.team || event.victimTeam || 'CT').toLowerCase()}`; target.textContent = victim?.nickname || event.victimName || event.targetName || 'Jogador';
    row.append(attacker, weapon);
    if (event.headshot || event.region === 'head') { const head = document.createElement('span'); head.className = 'feed-head'; head.textContent = '⌖'; row.append(head); }
    row.append(target); $('kill-feed').append(row);
    while ($('kill-feed').childElementCount > 5) $('kill-feed').firstElementChild.remove();
    const timer = setTimeout(() => { row.remove(); this._feedTimers.delete(timer); }, 6500); this._feedTimers.add(timer);
  }

  setConnection(state) {
    const online = state === true || state === 'connected' || state === 'online';
    const offline = state === false || state === 'disconnected' || state === 'offline';
    $('connection-dot').className = `connection-dot${online ? ' online' : offline ? ' offline' : ''}`;
    text('connection-text', online ? 'SERVIDOR ONLINE' : offline ? 'SEM CONEXÃO' : 'CONECTANDO');
  }

  dispose() {
    for (const timer of this._toasts) clearTimeout(timer);
    for (const timer of this._feedTimers) clearTimeout(timer);
    this._toasts.clear(); this._feedTimers.clear();
  }
}
