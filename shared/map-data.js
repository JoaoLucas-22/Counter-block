/** Dust Block is an original three-lane layout. Coordinates use metres; boxes are centred. */
const solid = (x,y,z,w,h,d,kind='wall',color) => ({ x,y,z,w,h,d,kind,...(color ? {color} : {}) });
export const MAP = {
  id: 'dust',
  name: 'Dust Block',
  bounds: { minX:-32,maxX:32,minZ:-32,maxZ:32 },
  solids: [
    solid(-32,3,0,1,6,65,'boundary'), solid(32,3,0,1,6,65,'boundary'),
    solid(0,3,-32,65,6,1,'boundary'), solid(0,3,32,65,6,1,'boundary'),
    // Buildings divide the lanes, with cross connections in between.
    solid(-12,3.5,10,10,7,12,'building'),
    solid(-12,3,-2,10,6,8,'building'),
    solid(12,3.5,10,10,7,12,'building'),
    solid(12,3,-3,10,6,8,'building'),
    solid(-12,3.5,-15,10,7,8,'building'),
    solid(12,3.5,-15,10,7,10,'building'),
    // Mid cover and gate posts preserve several useful sightlines.
    solid(-2,1.1,-5,2.4,2.2,3.2,'crate'),
    solid(3.3,.6,4,2.6,1.2,2.3,'crate'),
    solid(-5.8,2.3,-22,1.4,4.6,2,'pillar'),
    solid(5.8,2.3,-22,1.4,4.6,2,'pillar'),
    solid(0,4.3,-22,10.2,1.2,2,'arch'),
    // Site A: raised loading platform, reachable by the solid ramp.
    solid(-25,.45,-18,6,.9,6,'platform'),
    solid(-21,1,-14,2.2,2,2.2,'crate'),
    solid(-27,1.8,-23,3,3.6,2.2,'crate'),
    solid(-18.8,.55,-21,2,1.1,2,'crate'),
    solid(-25,.12,-5,4,.24,2,'step'),
    // Site B: courtyard with two clusters of cover.
    solid(24,1.3,-17,3.4,2.6,3.4,'crate'),
    solid(21,.6,-12,2.8,1.2,2.8,'crate'),
    solid(28,1,-24,2.4,2,3,'crate'),
    solid(19,1.5,-23,2.2,3,2.2,'crate'),
    // Outer routes and spawn cover, all lower than the enclosing walls.
    solid(-24,1.2,10,3,2.4,3,'crate'),
    solid(24,1.2,5,3,2.4,3,'crate'),
    solid(-25,1,22,2.5,2,3,'crate'),
    solid(25,1,23,2.5,2,3,'crate'),
    solid(-9,1.1,26,3,2.2,2.5,'crate'),
    solid(9,1.1,-27,3,2.2,2.5,'crate'),
  ],
  ramps: [{ x:-25,z:-13,w:6,d:4,height:.9,direction:'z',sign:-1 }],
  sites: {
    A:{ x:-20,z:-18,w:13,d:14 },
    B:{ x:24,z:-21,w:13,d:14 },
  },
  buyZones: {
    T:{ x:0,z:26,w:30,d:9 },
    CT:{ x:0,z:-27,w:30,d:8 },
  },
  spawns: {
    T:[-5,-2.5,0,2.5,5].map(x=>({x,y:0,z:27,yaw:0})),
    CT:[-5,-2.5,0,2.5,5].map(x=>({x,y:0,z:-27,yaw:Math.PI})),
  },
  labels: [
    {text:'BASE T',x:0,y:.025,z:27,color:'#d29048'},
    {text:'BASE CT',x:0,y:.025,z:-27,color:'#4e91ba'},
    {text:'MID',x:0,y:.025,z:0,color:'#dfb36d'},
    {text:'A',x:-24,y:1,z:-18,color:'#e67d45'},
    {text:'B',x:25,y:.025,z:-18,color:'#e67d45'},
  ],
};

/** Larger arenas share the same solid metadata with rendering and the server. */
function boundary(size) {
  return [
    solid(-size,4,0,1,8,size*2+1,'boundary'),solid(size,4,0,1,8,size*2+1,'boundary'),
    solid(0,4,-size,size*2+1,8,1,'boundary'),solid(0,4,size,size*2+1,8,1,'boundary'),
  ];
}
function spawns(z) {
  return {
    T:[-6,-3,0,3,6].map(x=>({x,y:0,z,yaw:0})),
    CT:[-6,-3,0,3,6].map(x=>({x,y:0,z:-z,yaw:Math.PI})),
  };
}

const YARD = {
  id:'yard',name:'Neon Yard',
  description:'Pátio industrial de 96 m, rotas amplas e coberturas em camadas.',
  theme:{sky:0x718ba8,fog:0x718ba8,ground:0x697b87,wall:0x526b83,building:0x78929e,crate:0x3b5561,accent:0x4ddad8},
  bounds:{minX:-48,maxX:48,minZ:-48,maxZ:48},
  solids:[
    ...boundary(48),
    solid(-17,4,16,14,8,18,'building'),solid(17,4,12,14,8,24,'building'),
    solid(-16,4,-13,16,8,18,'building'),solid(17,4,-15,14,8,20,'building'),
    solid(-7,2,-10,1.4,4,3,'pillar'),solid(7,2,-10,1.4,4,3,'pillar'),
    solid(0,4.6,-10,15.4,1.2,3,'arch'),
    solid(-4,1.2,7,3,2.4,3,'crate'),solid(4,.6,-3,3,1.2,3,'crate'),
    solid(-3,1,-26,3,2,3,'crate'),solid(5,.6,29,4,1.2,3,'crate'),
    solid(-39,.45,-18,8,.9,8,'platform'),
    solid(-39,1.2,-31,4,2.4,4,'crate'),solid(-29,.65,-20,3,1.3,3,'crate'),
    solid(-38,.6,-39,4,1.2,3,'crate'),solid(-28,1.5,-35,3,3,4,'crate'),
    solid(39,1.4,-31,4,2.8,4,'crate'),solid(28,.6,-22,3,1.2,4,'crate'),
    solid(37,.6,-39,4,1.2,3,'crate'),solid(28,1.4,-36,3,2.8,4,'crate'),
    solid(-37,1.2,17,4,2.4,4,'crate'),solid(35,.6,19,4,1.2,4,'crate'),
    solid(-15,1.1,39,3,2.2,4,'crate'),solid(15,1.1,-40,3,2.2,4,'crate'),
    solid(-33,.12,0,5,.24,3,'step'),solid(34,.12,0,5,.24,3,'step'),
  ],
  ramps:[{x:-39,z:-11,w:8,d:6,height:.9,direction:'z',sign:-1}],
  sites:{A:{x:-34,z:-26,w:17,d:18},B:{x:34,z:-25,w:17,d:18}},
  buyZones:{T:{x:0,z:40,w:38,d:12},CT:{x:0,z:-40,w:38,d:12}},
  spawns:spawns(41),
  labels:[
    {text:'BASE T',x:0,y:.025,z:41,color:'#edb66a'},
    {text:'BASE CT',x:0,y:.025,z:-41,color:'#7dd5ee'},
    {text:'YARD',x:0,y:.025,z:2,color:'#66ece2'},
    {text:'A',x:-34,y:.025,z:-26,color:'#f4a267'},
    {text:'B',x:34,y:.025,z:-25,color:'#f4a267'},
  ],
};

const DEPOT = {
  id:'depot',name:'Sky Depot',
  description:'Terminal de 104 m com plataformas, passagens laterais e um centro elevado.',
  theme:{sky:0xaac9e3,fog:0xaac9e3,ground:0xa3a9b2,wall:0x7187a1,building:0xc6d2df,crate:0x536e83,accent:0xffaf68},
  bounds:{minX:-52,maxX:52,minZ:-52,maxZ:52},
  solids:[
    ...boundary(52),
    solid(-23,5,16,16,10,20,'building'),solid(19,4.5,20,18,9,16,'building'),
    solid(-17,4.5,-14,14,9,18,'building'),solid(25,5,-12,18,10,26,'building'),
    solid(0,.45,-3,10,.9,12,'platform'),
    solid(-6,1.2,-23,3,2.4,3,'crate'),solid(7,.6,-17,3,1.2,3,'crate'),
    solid(-5,1,29,3,2,3,'crate'),solid(5,.6,33,3,1.2,3,'crate'),
    solid(-38,1.3,-39,4,2.6,4,'crate'),solid(-43,.6,-27,4,1.2,4,'crate'),
    solid(-29,.6,-33,3,1.2,4,'crate'),solid(-38,1.3,-18,4,2.6,4,'crate'),
    solid(42,1.3,-39,4,2.6,4,'crate'),solid(43,.6,-27,3,1.2,4,'crate'),
    solid(29,.6,-37,4,1.2,3,'crate'),solid(34,1.2,-19,4,2.4,3,'crate'),
    solid(-42,1.3,19,4,2.6,5,'crate'),solid(42,.6,14,4,1.2,4,'crate'),
    solid(-16,1.2,44,3,2.4,4,'crate'),solid(16,1.2,-44,3,2.4,4,'crate'),
    solid(-40,.12,3,5,.24,3,'step'),solid(41,.12,0,5,.24,3,'step'),
  ],
  ramps:[{x:0,z:6,w:10,d:6,height:.9,direction:'z',sign:-1}],
  sites:{A:{x:-37,z:-31,w:19,d:18},B:{x:37,z:-30,w:19,d:18}},
  buyZones:{T:{x:0,z:44,w:38,d:12},CT:{x:0,z:-44,w:38,d:12}},
  spawns:spawns(44),
  labels:[
    {text:'BASE T',x:0,y:.025,z:44,color:'#edb66a'},
    {text:'BASE CT',x:0,y:.025,z:-44,color:'#7dd5ee'},
    {text:'DEPOT',x:0,y:.925,z:-3,color:'#ffba79'},
    {text:'A',x:-37,y:.025,z:-31,color:'#f49d60'},
    {text:'B',x:37,y:.025,z:-30,color:'#f49d60'},
  ],
};

export const MAPS = Object.freeze({dust:MAP,yard:YARD,depot:DEPOT});
export function getMap(id) {
  return typeof id==='string' && Object.hasOwn(MAPS,id) ? MAPS[id] : MAP;
}
