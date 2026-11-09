/** Original colour finishes. Cosmetics never change damage, collision or team rules. */
const finish = (id, name, kind, rarity, colors) => Object.freeze({ id, name, kind, rarity, colors: Object.freeze(colors) });
export const SKINS = Object.freeze({
  default: finish('default', 'Original', 'both', 'common', { metal:'#273139', tan:'#a79a7c', accent:'#dc8143', uniform:'#647067', vest:'#374548' }),
  oxide: finish('oxide', 'Óxido', 'weapon', 'common', { metal:'#584b43', tan:'#9b6745', accent:'#e7ad69' }),
  circuit: finish('circuit', 'Circuito', 'weapon', 'common', { metal:'#243747', tan:'#30687b', accent:'#79e4d1' }),
  glacier: finish('glacier', 'Geleira', 'weapon', 'rare', { metal:'#b6d6dc', tan:'#5f8aab', accent:'#e5fbff' }),
  ember: finish('ember', 'Brasa', 'weapon', 'rare', { metal:'#422c35', tan:'#a14236', accent:'#ffac4b' }),
  royal: finish('royal', 'Real', 'weapon', 'epic', { metal:'#452d70', tan:'#7252a0', accent:'#e5c56f' }),
  prism: finish('prism', 'Prisma', 'weapon', 'legendary', { metal:'#193b4d', tan:'#b94f9a', accent:'#75ffe0' }),
  scout: finish('scout', 'Batedor', 'character', 'common', { uniform:'#657f60', vest:'#354f47', accent:'#b4d57f' }),
  pulse: finish('pulse', 'Pulso', 'character', 'common', { uniform:'#4d7189', vest:'#293a56', accent:'#72e1ef' }),
  arctic: finish('arctic', 'Ártico', 'character', 'rare', { uniform:'#cad9d9', vest:'#6e8796', accent:'#a7f4fa' }),
  solar: finish('solar', 'Solar', 'character', 'rare', { uniform:'#aa7442', vest:'#5e423b', accent:'#f7d167' }),
  phantom: finish('phantom', 'Espectro', 'character', 'epic', { uniform:'#66517f', vest:'#302d43', accent:'#c08df1' }),
  aurora: finish('aurora', 'Aurora', 'character', 'legendary', { uniform:'#39868c', vest:'#263d58', accent:'#f399ce' }),
});

const drops = ids => Object.freeze(ids.map(id => Object.freeze({ skin: id, weight: ({common:25,rare:17,epic:11,legendary:5})[SKINS[id].rarity] })));
export const CRATES = Object.freeze({
  weapon: Object.freeze({ id:'weapon', name:'Caixa de arsenal', description:'Acabamentos para todas as armas e para a faca.', drops:drops(['oxide','circuit','glacier','ember','royal','prism']) }),
  character: Object.freeze({ id:'character', name:'Caixa de operador', description:'Cores de uniforme; os identificadores de equipe permanecem visíveis.', drops:drops(['scout','pulse','arctic','solar','phantom','aurora']) }),
});
export const RARITY_LABELS = Object.freeze({ common:'Comum', rare:'Raro', epic:'Épico', legendary:'Lendário' });
export const RARITY_COLORS = Object.freeze({ common:'#9aaebc', rare:'#65b7f5', epic:'#b98beb', legendary:'#f1c475' });
