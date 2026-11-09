import * as THREE from 'three';
import { MAP } from '../shared/map-data.js';

function sandTexture() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const c=canvas.getContext('2d');c.fillStyle='#c5ad80';c.fillRect(0,0,512,512);
  let seed=82371;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};
  for(let i=0;i<12500;i++){
    const light=random()>.5;c.fillStyle=light?'rgba(255,244,206,.09)':'rgba(76,57,35,.065)';
    c.fillRect(random()*512,random()*512,1+random()*3,1+random()*3);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.repeat.set(10,10);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function blockTexture() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d');
  c.fillStyle='#d0bd95';c.fillRect(0,0,256,256);c.strokeStyle='rgba(92,73,50,.13)';c.lineWidth=2;
  for(let y=0;y<256;y+=64){c.beginPath();c.moveTo(0,y);c.lineTo(256,y);c.stroke();
    for(let x=(y/64%2)*64;x<256;x+=128){c.beginPath();c.moveTo(x,y);c.lineTo(x,y+64);c.stroke();}}
  const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function textTexture(text,foreground,background='rgba(0,0,0,0)',size=256) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const c=canvas.getContext('2d');
  c.fillStyle=background;c.fillRect(0,0,size,size);c.textAlign='center';c.textBaseline='middle';
  c.font=`900 ${text.length>2?size*.18:size*.72}px system-ui`;c.fillStyle=foreground;
  c.fillText(text,size/2,size/2+size*.025,size*.92);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function rampGeometry(ramp) {
  const {w,d,height,direction,sign}=ramp;
  const corners=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
  const vertices=[];
  for(const [x,z] of corners){const v=direction==='x'?x/w:z/d;vertices.push(x,(v*sign+.5)*height,z);}
  for(const [x,z] of corners)vertices.push(x,0,z);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setIndex([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]);
  geometry.computeVertexNormals();return geometry;
}

export function buildMap(scene,quality='medium',map=MAP) {
  const root=new THREE.Group();root.name=map.name;scene.add(root);
  const ownedTextures=[],ownedMaterials=new Set(),ownedGeometries=new Set();
  const width=map.bounds.maxX-map.bounds.minX,depth=map.bounds.maxZ-map.bounds.minZ;
  const cx=(map.bounds.minX+map.bounds.maxX)/2,cz=(map.bounds.minZ+map.bounds.maxZ)/2;
  const extent=Math.max(width,depth);
  const defaults=map.id==='yard' ? {sky:0x8cabc9,ground:0x748497,wall:0x465f78,building:0x617e95,crate:0xb35a86,trim:0x273b55,accent:0x55f5e0,sun:0xe2eaff}
    : map.id==='depot' ? {sky:0xb5cfde,ground:0x82899b,wall:0x66657d,building:0xc4ccd9,crate:0x507e98,trim:0x37465d,accent:0xd2ee70,sun:0xf5edff}
    : {sky:0xb9d3da,ground:0xd7c49c,wall:0xd9c9a5,building:0xe1cfaa,crate:0x8a6a43,trim:0xa78b62,accent:0xb77544,sun:0xffedcc};
  const palette={...defaults,...(typeof map.theme==='object'?map.theme:{})};
  const material=(parameters)=>{const value=new THREE.MeshStandardMaterial(parameters);ownedMaterials.add(value);return value;};
  const sand=sandTexture(),stone=blockTexture();ownedTextures.push(sand,stone);
  const materials={
    wall:material({color:palette.wall,map:stone,roughness:.98}),
    boundary:material({color:palette.wall,map:stone,roughness:1}),
    building:material({color:palette.building,map:stone,roughness:.94}),
    crate:material({color:palette.crate,roughness:.94}),
    trim:material({color:palette.trim,roughness:.96}),
    black:material({color:0x3d443e,roughness:.85}),
    wood:material({color:0x74644d,roughness:.97}),
    plaster:material({color:0xe5d9bb,roughness:1}),
    blue:material({color:0x407c8e,roughness:.85}),
    orange:material({color:palette.accent,roughness:.92}),
    ground:material({color:palette.ground,map:sand,roughness:1}),
    platform:material({color:0xb8ac90,roughness:1}),
  };
  const boxGeometry=new THREE.BoxGeometry(1,1,1);ownedGeometries.add(boxGeometry);
  const decorativeBatches=new Map();
  // All static trims, shutters, markings and crates share a unit cube. Collect
  // their matrices by material instead of issuing hundreds of individual draws.
  const box=(x,y,z,w,h,d,mat)=>{
    if(!decorativeBatches.has(mat))decorativeBatches.set(mat,[]);
    decorativeBatches.get(mat).push([x,y,z,w,h,d]);
  };
  box(cx,-.16,cz,width+2,.3,depth+2,materials.ground);
  // Every solid rendered below is the same centre AABB used by server physics and rays.
  const batches=new Map();
  for(const solid of map.solids){const key=solid.kind==='pillar'||solid.kind==='arch'?'plaster':solid.kind==='step'?'platform':solid.kind;
    if(!batches.has(key))batches.set(key,[]);batches.get(key).push(solid);}
  const transform=new THREE.Object3D();
  for(const [kind,solids] of batches){
    const mesh=new THREE.InstancedMesh(boxGeometry,materials[kind]||materials.wall,solids.length);
    solids.forEach((solid,i)=>{transform.position.set(solid.x,solid.y,solid.z);transform.scale.set(solid.w,solid.h,solid.d);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);});
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();root.add(mesh);
  }
  for(const ramp of map.ramps||[]){const geometry=rampGeometry(ramp);ownedGeometries.add(geometry);
    const mesh=new THREE.Mesh(geometry,materials.platform);mesh.position.set(ramp.x,0,ramp.z);mesh.receiveShadow=true;mesh.castShadow=true;root.add(mesh);}
  for(const s of map.solids){
    if(s.kind==='building'){
      const top=s.y+s.h/2;
      box(s.x,top-.07,s.z,s.w+.10,.14,s.d+.10,materials.trim);
      box(s.x,top+.2,s.z-s.d/2+.1,s.w,.4,.20,materials.plaster);
      box(s.x,top+.2,s.z+s.d/2-.1,s.w,.4,.20,materials.plaster);
      box(s.x-s.w/2+.1,top+.2,s.z,.20,.4,s.d,materials.plaster);
      box(s.x+s.w/2-.1,top+.2,s.z,.20,.4,s.d,materials.plaster);
      // Closed shutters and doors sit against solid facades, never across a playable route.
      for(const side of [-1,1]){
        const z=s.z+side*(s.d/2+.009);
        for(const offset of [-2.8,0,2.8]){
          box(s.x+offset,3.5,z,1.05,1.35,.025,materials.trim);
          box(s.x+offset,3.5,z+side*.018,.83,1.12,.02,materials.blue);
          box(s.x+offset,3.5,z+side*.034,.035,1.12,.02,materials.black);
        }
        box(s.x,1.25,z,1.35,2.5,.02,materials.trim);
        box(s.x,1.2,z+side*.02,1.14,2.35,.02,materials.wood);
        box(s.x,1.2,z+side*.035,.025,2.35,.02,materials.black);
      }
      // Rooftop utility boxes give each block a readable silhouette.
      box(s.x-2,top+.4,s.z+.8,1.6,.8,1.4,materials.plaster);
      box(s.x-2,top+.83,s.z+.8,1.7,.08,1.5,materials.trim);
    } else if(s.kind==='crate'){
      const outer=s.kind==='crate'&&s.h>2.8;
      for(const side of [-1,1]){
        const z=s.z+side*(s.d/2+.01),x=s.x+side*(s.w/2+.01);
        for(const yOffset of [-.35,.35]){
          box(s.x,s.y+s.h*yOffset,z,s.w,.065,.035,materials.trim);
          box(x,s.y+s.h*yOffset,s.z,.035,.065,s.d,materials.trim);
        }
        for(const fraction of [-.39,.39]){
          box(s.x+s.w*fraction,s.y,z,.07,s.h,.035,outer?materials.black:materials.trim);
          box(x,s.y,s.z+s.d*fraction,.035,s.h,.07,outer?materials.black:materials.trim);
        }
      }
    } else if(s.kind==='pillar'){
      box(s.x,s.y+s.h/2-.15,s.z,s.w+.2,.30,s.d+.2,materials.trim);
      box(s.x,.15,s.z,s.w+.12,.3,s.d+.12,materials.trim);
    }
  }
  const planeGeometry=new THREE.PlaneGeometry(1,1);ownedGeometries.add(planeGeometry);
  const floorLabel=(text,x,y,z,size,color)=>{
    const texture=textTexture(text,color);ownedTextures.push(texture);
    const mat=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});ownedMaterials.add(mat);
    const mesh=new THREE.Mesh(planeGeometry,mat);mesh.rotation.x=-Math.PI/2;mesh.position.set(x,y,z);mesh.scale.set(size,size,1);root.add(mesh);
  };
  for(const label of map.labels||[]) {
    if((!map.id||map.id==='dust')&&label.text==='A')floorLabel('A',-25,.915,-18,3.5,label.color);
    else floorLabel(label.text,label.x,label.y,label.z,label.text.length>2?8:4,label.color);
  }
  for(const [siteName,zone] of Object.entries(map.sites)){
    // Mark actual planting bounds on the ground; raised site A also has a readable emblem.
    const color=materials.orange;
    box(zone.x,.012,zone.z-zone.d/2,zone.w,.018,.10,color);
    box(zone.x,.012,zone.z+zone.d/2,zone.w,.018,.10,color);
    box(zone.x-zone.w/2,.012,zone.z,.10,.018,zone.d,color);
    box(zone.x+zone.w/2,.012,zone.z,.10,.018,zone.d,color);
  }
  // Painted navigation arrows on intact facades and central gateway.
  const sign=(text,x,y,z,rotation=0,color='#f0d7ab')=>{
    const texture=textTexture(text,color,'#314f59');ownedTextures.push(texture);
    const mat=new THREE.MeshBasicMaterial({map:texture});ownedMaterials.add(mat);
    const mesh=new THREE.Mesh(planeGeometry,mat);mesh.position.set(x,y,z);mesh.scale.set(2.2,2.2,1);mesh.rotation.y=rotation;root.add(mesh);
  };
  if(!map.id||map.id==='dust'){
  sign('A ←',-12,2.8,16.02,0);sign('B →',12,2.8,16.02,0);sign('MID',0,4.25,-20.985,0);
  floorLabel('← A',-24,.018,15,6,'#bc8855');floorLabel('B →',24,.018,14,6,'#bc8855');
  // Decorative arch profile is above the same solid lintel, clear of the player opening.
  const archPoints=[];for(let i=0;i<=16;i++){const angle=Math.PI-i/16*Math.PI;archPoints.push(new THREE.Vector3(Math.cos(angle)*4.8,Math.sin(angle)*1.7+4.85,-22));}
  const archGeometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPoints),24,.16,5,false);ownedGeometries.add(archGeometry);
  const archMesh=new THREE.Mesh(archGeometry,materials.trim);archMesh.castShadow=true;root.add(archMesh);
  }
  // Upper boundary trim and roof beacons are cosmetic and stay out of the routes.
  if(map.id&&map.id!=='dust') for(const solid of map.solids){
    if(solid.kind==='boundary')box(solid.x,solid.y+solid.h/2-.12,solid.z,solid.w,.14,solid.d,materials.orange);
    if(solid.kind==='building')box(solid.x,solid.y+solid.h/2+.07,solid.z,solid.w*.72,.12,.20,materials.orange);
  }
  for(const [mat,boxes] of decorativeBatches) {
    const mesh=new THREE.InstancedMesh(boxGeometry,mat,boxes.length);
    for(let i=0;i<boxes.length;i++) {
      const [x,y,z,w,h,d]=boxes[i];
      transform.position.set(x,y,z);transform.scale.set(w,h,d);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
    }
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();root.add(mesh);
  }
  const ambient=new THREE.HemisphereLight(palette.sky,map.id==='dust'?0x846d46:0x33425c,2.0);root.add(ambient);
  const sunlight=new THREE.DirectionalLight(palette.sun,2.8);sunlight.position.set(-24,44,20);sunlight.target.position.set(0,0,-4);root.add(sunlight,sunlight.target);
  sunlight.shadow.camera.left=-extent*.65;sunlight.shadow.camera.right=extent*.65;sunlight.shadow.camera.top=extent*.65;sunlight.shadow.camera.bottom=-extent*.65;
  sunlight.shadow.camera.near=1;sunlight.shadow.camera.far=extent*2;sunlight.shadow.bias=-.0005;sunlight.shadow.normalBias=.025;
  scene.background=new THREE.Color(palette.sky);scene.fog=new THREE.Fog(palette.sky,extent*.7,extent*1.8);
  const dustGeometry=new THREE.BufferGeometry(),dustPositions=new Float32Array(72*3);
  for(let i=0;i<72;i++){dustPositions[i*3]=cx+((i*31)%(width-1))-width/2;dustPositions[i*3+1]=.3+((i*17)%21)/10;dustPositions[i*3+2]=cz+((i*47)%(depth-1))-depth/2;}
  dustGeometry.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));ownedGeometries.add(dustGeometry);
  const dustMaterial=new THREE.PointsMaterial({color:0xffe3aa,size:.035,transparent:true,opacity:.22,depthWrite:false});ownedMaterials.add(dustMaterial);
  const dust=new THREE.Points(dustGeometry,dustMaterial);root.add(dust);
  const api={
    setQuality(value){sunlight.castShadow=value!=='low';dust.visible=value!=='low';const size=value==='high'?2048:1024;sunlight.shadow.mapSize.set(size,size);if(sunlight.shadow.map){sunlight.shadow.map.dispose();sunlight.shadow.map=null;}},
    update(time=0){dust.rotation.y=Math.sin(time*.025)*.02;dust.position.y=Math.sin(time*.4)*.08;},
    dispose(){root.removeFromParent();for(const geometry of ownedGeometries)geometry.dispose();for(const mat of ownedMaterials)mat.dispose();ownedTextures.forEach(t=>t.dispose());sunlight.shadow.map?.dispose();},
  };
  api.setQuality(quality);return api;
}
