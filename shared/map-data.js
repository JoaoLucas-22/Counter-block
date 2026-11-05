/** Dust Block is an original three-lane layout. Coordinates use metres; boxes are centred. */
const solid = (x,y,z,w,h,d,kind='wall',color) => ({ x,y,z,w,h,d,kind,...(color ? {color} : {}) });
export const MAP = {
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
