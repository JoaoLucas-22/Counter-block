import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRATES, SKINS } from '../shared/cosmetics.js';

const DEFAULT_FILE = fileURLToPath(new URL('../data/profiles.json', import.meta.url));
const TOKEN = /^[a-f0-9]{64}$/;
const ID = /^[A-Z]{8}$/;
const MAX_FRIENDS = 50;
export class ProfileError extends Error {
  constructor(message) { super(message); this.name = 'ProfileError'; }
}
const requireProfile = (condition, message) => { if (!condition) throw new ProfileError(message); };
const code = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
const cleanName = value => {
  requireProfile(typeof value === 'string', 'Digite um nickname.');
  const result = value.normalize('NFKC').trim().replace(/[\u0000-\u001f\u007f<>]/g, '');
  requireProfile(result.length >= 2 && result.length <= 20, 'O nickname deve ter entre 2 e 20 caracteres.');
  return result;
};

/** Device accounts are local to this Node server. Account tokens are private bearer credentials. */
export class ProfileStore {
  constructor({ filePath = DEFAULT_FILE } = {}) {
    this.filePath = filePath === null ? null : path.resolve(filePath);
    this.profiles = new Map();
    this.tokens = new Map();
    if (this.filePath && existsSync(this.filePath)) this.load();
  }

  load() {
    // A corrupt store must not be silently replaced with empty accounts.
    let data;
    try { data = JSON.parse(readFileSync(this.filePath, 'utf8')); }
    catch { throw new ProfileError('Não foi possível ler data/profiles.json. Preserve o arquivo antes de restaurar um backup.'); }
    requireProfile(data?.version === 1 && Array.isArray(data.profiles), 'Arquivo de perfis incompatível.');
    for (const value of data.profiles) {
      requireProfile(value && ID.test(value.id) && TOKEN.test(value.token), 'Arquivo de perfis contém uma conta inválida.');
      requireProfile(!this.profiles.has(value.id) && !this.tokens.has(value.token), 'Arquivo de perfis contém contas duplicadas.');
      const owned = Array.isArray(value.owned) ? [...new Set(value.owned.filter(id => typeof id === 'string' && Object.hasOwn(SKINS, id)))] : [];
      if (!owned.includes('default')) owned.unshift('default');
      const equipped = { weapon:'default', character:'default' };
      for (const kind of ['weapon','character']) {
        const skin = value.equipped?.[kind];
        if (owned.includes(skin) && (skin === 'default' || SKINS[skin]?.kind === kind)) equipped[kind] = skin;
      }
      const p = { id:value.id, token:value.token, nickname:cleanName(value.nickname),
        friends:Array.isArray(value.friends) ? [...new Set(value.friends.filter(id => typeof id === 'string' && ID.test(id) && id !== value.id))].slice(0,MAX_FRIENDS) : [],
        requests:Array.isArray(value.requests) ? [...new Set(value.requests.filter(id => typeof id === 'string' && ID.test(id) && id !== value.id))].slice(0,MAX_FRIENDS) : [],
        crates:{weapon:0,character:0}, owned, equipped, lastDrop:null };
      for (const kind of ['weapon','character']) {
        if (Number.isSafeInteger(value.crates?.[kind]) && value.crates[kind] >= 0) p.crates[kind] = Math.min(1_000_000,value.crates[kind]);
      }
      if (value.lastDrop && Object.hasOwn(SKINS,value.lastDrop.skin) && Object.hasOwn(CRATES,value.lastDrop.crate)) p.lastDrop = {skin:value.lastDrop.skin,crate:value.lastDrop.crate,duplicate:value.lastDrop.duplicate === true};
      this.profiles.set(p.id,p); this.tokens.set(p.token,p.id);
    }
    for (const p of this.profiles.values()) {
      p.friends = p.friends.filter(id => this.profiles.has(id));
      p.requests = p.requests.filter(id => this.profiles.has(id) && !p.friends.includes(id));
    }
  }

  save() {
    if (!this.filePath) return;
    mkdirSync(path.dirname(this.filePath), { recursive:true });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(temporary, JSON.stringify({ version:1, profiles:[...this.profiles.values()] }), { encoding:'utf8', mode:0o600 });
    // rename on the same filesystem replaces the complete store atomically.
    renameSync(temporary,this.filePath);
  }

  get(id) {
    const p = typeof id === 'string' ? this.profiles.get(id) : null;
    requireProfile(!!p, 'Perfil não encontrado neste servidor.');
    return p;
  }

  authenticate(token) {
    if (typeof token === 'string' && TOKEN.test(token) && this.tokens.has(token)) return this.get(this.tokens.get(token));
    requireProfile(this.profiles.size < 10000, 'O servidor atingiu o limite de perfis.');
    let id;
    do { id = Array.from({length:8}, () => String.fromCharCode(65+randomInt(26))).join(''); } while (this.profiles.has(id));
    const p = { id, token:randomBytes(32).toString('hex'), nickname:`Jogador-${id.slice(0,4)}`, friends:[], requests:[], crates:{weapon:0,character:0}, owned:['default'], equipped:{weapon:'default',character:'default'}, lastDrop:null };
    this.profiles.set(id,p); this.tokens.set(p.token,id); this.save(); return p;
  }

  publicView(id) {
    const p = this.get(id);
    return { id:p.id, nickname:p.nickname };
  }

  view(profileOrId) {
    const p = this.get(typeof profileOrId === 'string' ? profileOrId : profileOrId?.id);
    return { id:p.id, nickname:p.nickname,
      friends:p.friends.filter(id => this.profiles.has(id)).map(id => this.publicView(id)),
      requests:p.requests.filter(id => this.profiles.has(id)).map(id => this.publicView(id)),
      crates:{...p.crates}, owned:[...p.owned], equipped:{...p.equipped}, lastDrop:p.lastDrop ? {...p.lastDrop} : null };
  }

  setNickname(id,nickname) { const p=this.get(id); p.nickname=cleanName(nickname); this.save(); return this.view(p); }

  /** Called only after an authoritative enemy elimination, never by a client packet. */
  grantKill(id) {
    const p=this.get(id), crate=randomInt(2) ? 'character' : 'weapon';
    p.crates[crate]=Math.min(1_000_000,p.crates[crate]+1); this.save();
    return { crate, count:p.crates[crate] };
  }

  openCrate(id,type) {
    requireProfile(typeof type === 'string' && Object.hasOwn(CRATES,type), 'Tipo de caixa inválido.');
    const p=this.get(id); requireProfile(p.crates[type]>0, 'Você não tem uma caixa desse tipo. Elimine um adversário para ganhar caixas.');
    const entries=CRATES[type].drops, total=entries.reduce((sum,entry) => sum+entry.weight,0);
    let roll=randomInt(total), skin=entries.at(-1).skin;
    for (const entry of entries) { roll-=entry.weight; if (roll<0) {skin=entry.skin;break;} }
    const duplicate=p.owned.includes(skin);
    p.crates[type]--; if (!duplicate) p.owned.push(skin);
    p.lastDrop={skin,duplicate,crate:type}; this.save(); return {...p.lastDrop};
  }

  equip(id,kind,skinId) {
    requireProfile(kind === 'weapon' || kind === 'character', 'Categoria de skin inválida.');
    requireProfile(typeof skinId === 'string' && Object.hasOwn(SKINS,skinId), 'Skin inválida.');
    const p=this.get(id);
    requireProfile(p.owned.includes(skinId), 'Você ainda não possui essa skin.');
    requireProfile(skinId === 'default' || SKINS[skinId].kind === kind, 'Essa skin não pertence a essa categoria.');
    p.equipped[kind]=skinId; this.save(); return this.view(p);
  }

  requestFriend(fromId,toCode) {
    const from=this.get(fromId), targetCode=code(toCode);
    requireProfile(ID.test(targetCode), 'O código de amigo deve ter 8 letras.');
    const to=this.get(targetCode);
    requireProfile(from.id !== to.id, 'Você não pode adicionar seu próprio perfil.');
    requireProfile(!from.friends.includes(to.id), 'Esse jogador já está na sua lista de amigos.');
    requireProfile(!to.requests.includes(from.id), 'Você já enviou uma solicitação a esse jogador.');
    requireProfile(from.friends.length < MAX_FRIENDS && to.friends.length < MAX_FRIENDS, 'A lista de amigos está cheia.');
    requireProfile(to.requests.length < MAX_FRIENDS, 'Esse jogador já possui muitas solicitações pendentes.');
    to.requests.push(from.id); this.save(); return {from:from.id,to:to.id};
  }

  acceptFriend(id,fromCode) {
    const to=this.get(id), fromId=code(fromCode);
    requireProfile(ID.test(fromId), 'Código de amigo inválido.');
    const from=this.get(fromId);
    requireProfile(to.requests.includes(from.id), 'Solicitação de amizade não encontrada.');
    requireProfile(to.friends.length < MAX_FRIENDS && from.friends.length < MAX_FRIENDS, 'A lista de amigos está cheia.');
    to.requests=to.requests.filter(value => value !== from.id);
    from.requests=from.requests.filter(value => value !== to.id);
    if (!to.friends.includes(from.id)) to.friends.push(from.id);
    if (!from.friends.includes(to.id)) from.friends.push(to.id);
    this.save(); return {from:from.id,to:to.id};
  }

  removeFriend(id,otherCode) {
    const p=this.get(id), otherId=code(otherCode);
    requireProfile(ID.test(otherId), 'Código de amigo inválido.');
    const other=this.get(otherId);
    p.friends=p.friends.filter(value => value !== other.id); other.friends=other.friends.filter(value => value !== p.id);
    p.requests=p.requests.filter(value => value !== other.id); other.requests=other.requests.filter(value => value !== p.id);
    this.save(); return {from:p.id,to:other.id};
  }
}
