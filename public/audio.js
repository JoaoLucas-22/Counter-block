// All effects are synthesized here. No recordings, music, or third-party sound assets.
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

export class GameAudio {
  constructor() {
    this.context = null; this.masterVolume = .65; this.effectsVolume = .8;
    this.listenerState = { x:0,y:1.6,z:0,yaw:0 }; this.voices = new Set();
  }
  unlock() {
    try {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        const compressor = this.context.createDynamicsCompressor();
        compressor.threshold.value=-14; compressor.knee.value=12; compressor.ratio.value=4;
        this.master.connect(compressor); compressor.connect(this.context.destination); this.compressor=compressor;
        const length=this.context.sampleRate;
        this.noise=this.context.createBuffer(1,length,this.context.sampleRate);
        const data=this.noise.getChannelData(0); let seed=314159;
        for(let i=0;i<length;i++) { seed=(Math.imul(seed,1664525)+1013904223)|0; data[i]=(seed>>>0)/2147483648-1; }
        this.setVolume(this.masterVolume,this.effectsVolume);
        const s=this.listenerState; this.setListener(s.x,s.y,s.z,s.yaw);
      }
      if(this.context.state==='suspended') return this.context.resume().catch(()=>{});
    } catch { /* A browser without Web Audio still supports the rest of the game. */ }
  }
  setVolume(master,effects) {
    this.masterVolume=clamp(master); this.effectsVolume=clamp(effects);
    if(this.master) this.master.gain.setTargetAtTime(this.masterVolume*this.effectsVolume,this.context.currentTime,.025);
  }
  setListener(x,y,z,yaw) {
    this.listenerState={x,y,z,yaw}; if(!this.context) return;
    const listener=this.context.listener, time=this.context.currentTime;
    if(listener.positionX) {
      listener.positionX.setValueAtTime(x,time);listener.positionY.setValueAtTime(y,time);listener.positionZ.setValueAtTime(z,time);
      listener.forwardX.setValueAtTime(-Math.sin(yaw),time);listener.forwardY.setValueAtTime(0,time);listener.forwardZ.setValueAtTime(-Math.cos(yaw),time);
      listener.upX.setValueAtTime(0,time);listener.upY.setValueAtTime(1,time);listener.upZ.setValueAtTime(0,time);
    } else {
      listener.setPosition(x,y,z);listener.setOrientation(-Math.sin(yaw),0,-Math.cos(yaw),0,1,0);
    }
  }
  play(type,options={}) {
    const ctx=this.context; if(!ctx || ctx.state!=='running' || this.voices.size>=48 || this.masterVolume===0 || this.effectsVolume===0) return;
    const bus=ctx.createGain();bus.gain.value=clamp(options.volume ?? 1);
    let panner;
    if(Number.isFinite(options.x) && Number.isFinite(options.z)) {
      panner=ctx.createPanner();panner.panningModel='equalpower';panner.distanceModel='inverse';panner.refDistance=3;panner.maxDistance=65;panner.rolloffFactor=1.6;
      panner.positionX.value=options.x;panner.positionY.value=options.y ?? 1;panner.positionZ.value=options.z;
      bus.connect(panner);panner.connect(this.master);
    } else bus.connect(this.master);
    const voice={bus,panner,count:0};this.voices.add(voice);
    const done=()=>{voice.count--;if(voice.count<=0){bus.disconnect();panner?.disconnect();this.voices.delete(voice);}};
    const now=ctx.currentTime;
    const tone=(freq,duration,volume=.2,offset=0,endFreq=freq,wave='sine')=>{
      const oscillator=ctx.createOscillator(),gain=ctx.createGain();voice.count++;
      oscillator.type=wave;oscillator.frequency.setValueAtTime(freq,now+offset);oscillator.frequency.exponentialRampToValueAtTime(Math.max(15,endFreq),now+offset+duration);
      gain.gain.setValueAtTime(.0001,now+offset);gain.gain.linearRampToValueAtTime(volume,now+offset+.003);gain.gain.exponentialRampToValueAtTime(.0001,now+offset+duration);
      oscillator.connect(gain);gain.connect(bus);oscillator.start(now+offset);oscillator.stop(now+offset+duration+.01);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();done();};
    };
    const noise=(duration,volume=.3,frequency=1800,offset=0,filterType='lowpass')=>{
      const source=ctx.createBufferSource(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();voice.count++;
      source.buffer=this.noise;filter.type=filterType;filter.frequency.value=frequency;
      gain.gain.setValueAtTime(.0001,now+offset);gain.gain.linearRampToValueAtTime(volume,now+offset+.002);gain.gain.exponentialRampToValueAtTime(.0001,now+offset+duration);
      source.connect(filter);filter.connect(gain);gain.connect(bus);source.loop=true;
      source.start(now+offset,Math.random()*.5);source.stop(now+offset+duration+.01);
      source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();done();};
    };
    switch(type) {
      case 'shot': case 'fire': {
        const weapon=options.weapon || 'glock',suppressed=weapon==='usp',sniper=weapon==='awp';
        if(weapon==='knife'){noise(.16,.22,1700,0,'bandpass');tone(240,.11,.045,0,90,'triangle');break;}
        if(weapon==='scatter'){noise(.28,.95,2100);tone(75,.22,.42,0,35,'triangle');noise(.05,.13,3800,.19,'highpass');break;}
        if(weapon==='vector'){noise(.075,.50,3400);tone(220,.07,.20,0,80,'triangle');break;}
        if(weapon==='pulse'){noise(.10,.64,2900);tone(170,.1,.25,0,60,'triangle');break;}
        noise(sniper?.25:suppressed?.08:.15,suppressed?.19:.8,suppressed?1200:sniper?1700:2600);
        tone(sniper?95:suppressed?180:145,sniper?.22:.12,suppressed?.1:.36,0,45,'triangle');
        noise(.027,.12,5200,.045,'highpass');break;
      }
      case 'footstep':case 'step': noise(.075,.18,700);tone(105,.065,.055,0,60);break;
      case 'jump':noise(.095,.15,1100);break;
      case 'land':noise(.12,.26,500);tone(75,.08,.12,0,40);break;
      case 'reload':noise(.055,.14,3800,0,'highpass');noise(.06,.19,2900,.28,'highpass');tone(320,.07,.08,.34,180,'triangle');break;
      case 'switch':case 'equip':noise(.055,.16,2400);tone(440,.04,.035,0,220,'square');break;
      case 'buy':tone(620,.10,.12);tone(930,.15,.12,.08);break;
      case 'plant':tone(640,.065,.13);tone(820,.065,.13,.10);tone(1040,.11,.12,.2);break;
      case 'defuse':tone(1040,.075,.14);tone(820,.075,.14,.1);tone(640,.16,.12,.2);break;
      case 'beep':case 'bomb':tone(1300,.07,.18);break;
      case 'explode':case 'explosion':noise(.8,.95,850);tone(65,.7,.6,0,20,'triangle');break;
      case 'flash':noise(.25,.38,4000);tone(2700,.8,.10,.02,2400);break;
      case 'hit':tone(780,.045,.08,0,450,'triangle');break;
      case 'hurt':noise(.09,.19,950);tone(90,.09,.1,0,45);break;
      case 'kill':tone(620,.06,.12);tone(930,.08,.1,.065);break;
      case 'round':tone(330,.13,.14);tone(440,.16,.13,.16);break;
      case 'victory':[523,659,784,1047].forEach((freq,i)=>tone(freq,.23,.13,i*.11));break;
      case 'defeat':[440,370,294].forEach((freq,i)=>tone(freq,.25,.12,i*.16));break;
      case 'smoke':noise(.8,.24,2400);break;
      case 'dash':noise(.22,.32,1100,0,'bandpass');tone(210,.18,.06,0,70,'triangle');break;
      case 'slide':noise(.28,.20,700);break;
      case 'crate':case 'case':noise(.08,.16,2200);[440,554,659,880].forEach((freq,i)=>tone(freq,.17,.10,.06+i*.08));break;
      case 'drop':tone(660,.10,.09);tone(990,.18,.10,.11);break;
      default: tone(440,.07,.08);
    }
    if(!voice.count){bus.disconnect();panner?.disconnect();this.voices.delete(voice);}
  }
  dispose() {
    for(const voice of this.voices){voice.bus.disconnect();voice.panner?.disconnect();}
    this.voices.clear();this.master?.disconnect();this.compressor?.disconnect();
    this.context?.close().catch(()=>{});this.context=null;
  }
}
