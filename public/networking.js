/** Socket transport, bounded snapshot history and credential-based reconnect. */
export class Networking extends EventTarget {
  constructor() {
    super();
    this.socket = window.io({ autoConnect: true, transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    this.id = null;
    this.code = null;
    this.snapshots = [];
    this.offset = 0;
    this.ping = 0;
    this.hasClock = false;
    this.state = null;
    try { this.credentials = JSON.parse(sessionStorage.getItem('counter-block-session') || 'null'); } catch { this.credentials = null; }
    this.socket.on('connect', async () => {
      this.dispatch('connection', 'connected');
      if (this.credentials) {
        try { await this.enter('room:resume', this.credentials); this.dispatch('resumed', this.state); }
        catch (error) { this.clearSession(); this.dispatch('failure', error.message); }
      }
    });
    this.socket.on('disconnect', () => this.dispatch('connection', 'disconnected'));
    this.socket.on('connect_error', () => this.dispatch('connection', 'connecting'));
    this.socket.on('net:probe', (_data, ack) => { if (typeof ack === 'function') ack(); });
    this.socket.on('room:state', state => {
      this.state = state;
      this.dispatch('room', state);
    });
    this.socket.on('game:snapshot', state => {
      if (!Number.isFinite(state.serverTime)) return;
      if (this.snapshots.length && state.serverTime <= this.snapshots.at(-1).serverTime) return;
      const offset = state.serverTime - Date.now() + this.ping / 2;
      this.offset = this.hasClock ? this.offset * .95 + offset * .05 : offset;
      this.hasClock = true;
      this.state = state;
      this.snapshots.push(state);
      if (this.snapshots.length > 40) this.snapshots.shift();
      this.dispatch('snapshot', state);
    });
    this.socket.on('game:event', event => this.dispatch('event', event));
    this.pingTimer = setInterval(async () => {
      if (!this.socket.connected) return;
      const start = performance.now();
      try { await this.request('net:ping', {}); this.ping = Math.round(performance.now() - start); } catch { /* connection state handles failure */ }
    }, 2500);
  }
  dispatch(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, handler) { this.addEventListener(type, event => handler(event.detail)); }
  now() { return Date.now() + this.offset; }
  request(event, payload = {}) {
    return new Promise((resolve, reject) => {
      this.socket.timeout(6000).emit(event, payload, (error, response) => {
        if (error) return reject(new Error('Servidor sem resposta. Verifique a conexão.'));
        if (!response?.ok) return reject(new Error(response?.error || 'Ação recusada pelo servidor.'));
        resolve(response);
      });
    });
  }
  async enter(event, payload) {
    const result = await this.request(event, payload);
    this.id = result.id;
    this.inputSeq = result.inputSeq ?? 0;
    this.code = result.code;
    this.credentials = { token: result.token, code: result.code };
    try { sessionStorage.setItem('counter-block-session', JSON.stringify(this.credentials)); } catch { /* Memory credentials still permit reconnecting this tab. */ }
    this.snapshots.length = 0;
    this.state = result.state;
    this.dispatch('entered', { state:result.state, inputSeq:this.inputSeq });
    this.dispatch('room', result.state);
    return result;
  }
  create(nickname) { return this.enter('room:create', { nickname }); }
  join(code, nickname) { return this.enter('room:join', { code, nickname }); }
  input(command) { if (this.socket.connected && this.code) this.socket.emit('game:input', command); }
  action(type, values = {}) { return this.request('game:action', { type, ...values }); }
  clearSession() {
    this.credentials = null; this.id = null; this.code = null; this.state = null;
    this.snapshots.length = 0;
    try { sessionStorage.removeItem('counter-block-session'); } catch { /* Storage may be disabled by browser policy. */ }
  }
  async leave() { try { await this.request('room:leave'); } finally { this.clearSession(); } }
  /** 100 ms history buffer. Never extrapolate unseen positions beyond latest state. */
  interpolated(id, delay = 100) {
    if (!this.snapshots.length) return null;
    const target = this.now() - delay;
    let a = this.snapshots[0], b = a;
    for (const frame of this.snapshots) {
      b = frame;
      if (frame.serverTime >= target) break;
      a = frame;
    }
    const p = a.players.find(player => player.id === id);
    const q = b.players.find(player => player.id === id);
    if (!q) return p || null;
    if (!p || a.round !== b.round || p.alive !== q.alive) return q;
    const t = a === b ? 1 : Math.max(0, Math.min(1, (target - a.serverTime) / (b.serverTime - a.serverTime)));
    let angle = ((q.yaw - p.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return { ...q, x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t, yaw: p.yaw + angle * t, pitch: p.pitch + (q.pitch - p.pitch) * t };
  }
  dispose() { clearInterval(this.pingTimer); this.socket.disconnect(); }
}
