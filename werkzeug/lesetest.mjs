// automatisch aus der App kopiert: PMTiles-Leser
function kmLuftlinieEinfach(a, b){
  const R=6371;
  const dLat=(b.lat-a.lat)*Math.PI/180, dLon=(b.lon-a.lon)*Math.PI/180;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
function vkKachelListe(m, radiusKm, zMax){
  const dLat = radiusKm / 111.32, dLon = radiusKm / (111.32 * Math.cos(m.lat * Math.PI / 180)), liste = [];
  for(let z = 5; z <= zMax; z++){
    const n = Math.pow(2, z);
    const tx = (lon)=> Math.floor((lon + 180) / 360 * n);
    const ty = (lat)=>{ const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
    const lonV = (x)=> x / n * 360 - 180, latV = (y)=> Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    for(let x = tx(m.lon - dLon); x <= tx(m.lon + dLon); x++) for(let y = ty(m.lat + dLat); y <= ty(m.lat - dLat); y++){
      if(z >= 10){
        const lo = Math.max(lonV(x), Math.min(lonV(x + 1), m.lon)), la = Math.max(latV(y + 1), Math.min(latV(y), m.lat));
        if(kmLuftlinieEinfach(m, { lat: la, lon: lo }) > radiusKm) continue;
      }
      liste.push([z, x, y]);
    }
  }
  return liste;
}
function vkEigenKachelListe(m, radiusKm){
  const l = vkKachelListe(m, radiusKm, 14);
  const dLat = radiusKm / 111.32, dLon = radiusKm / (111.32 * Math.cos(m.lat * Math.PI / 180));
  for(let z = 0; z < 5; z++){
    const n = Math.pow(2, z), tx = (lon)=> Math.max(0, Math.min(n - 1, Math.floor((lon + 180) / 360 * n)));
    const ty = (lat)=>{ const r = lat * Math.PI / 180; return Math.max(0, Math.min(n - 1, Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n))); };
    for(let x = tx(m.lon - dLon); x <= tx(m.lon + dLon); x++) for(let y = ty(m.lat + dLat); y <= ty(m.lat - dLat); y++) l.push([z, x, y]);
  }
  return l;
}
function vkPmtZxyId(z, x, y){
  let acc = 0; for(let i = 0; i < z; i++) acc += Math.pow(4, i);
  const xy = [x, y]; let d = 0;
  for(let s = Math.pow(2, z) / 2; s >= 1; s /= 2){
    const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if(ry === 0){ if(rx === 1){ xy[0] = s - 1 - xy[0]; xy[1] = s - 1 - xy[1]; } const t = xy[0]; xy[0] = xy[1]; xy[1] = t; }
  }
  return acc + d;
}
function vkPmtVerzeichnis(u8){
  let p = 0; const rv = ()=>{ let v = 0, f = 1, b; do{ b = u8[p++]; v += (b & 0x7f) * f; f *= 128; }while(b & 0x80); return v; };
  const n = rv(), e = new Array(n); let id = 0;
  for(let i = 0; i < n; i++){ id += rv(); e[i] = { id }; }
  for(let i = 0; i < n; i++) e[i].run = rv();
  for(let i = 0; i < n; i++) e[i].len = rv();
  for(let i = 0; i < n; i++){ const v = rv(); e[i].off = (v === 0 && i > 0) ? e[i - 1].off + e[i - 1].len : v - 1; }
  return e;
}
async function vkPmtOeffnen(basis){
  const v = await (await vkHolen(basis + 'verzeichnis.json?' + Date.now(), 15000)).json();
  let teilAbrufe = 0;
  const lies = async (off, len)=>{
    const out = new Uint8Array(len); let pos = 0;
    while(pos < len){
      const abs = off + pos, i = Math.floor(abs / v.teilGroesse), innen = abs - i * v.teilGroesse, n = Math.min(len - pos, v.teilGroesse - innen);
      const ac = new AbortController(), tm = setTimeout(()=> ac.abort(), 60000);
      let b;
      try{
        const r = await fetch(basis + v.teile[i], { headers: { Range: 'bytes=' + innen + '-' + (innen + n - 1) }, signal: ac.signal, cache: 'no-store' });
        if(r.status !== 206) throw new Error('Kartenserver liefert keine Teilabrufe (HTTP ' + r.status + ')');
        b = new Uint8Array(await r.arrayBuffer());
      } finally{ clearTimeout(tm); }
      if(b.length !== n) throw new Error('Kartendatei unvollständig gelesen');
      out.set(b, pos); pos += n; teilAbrufe++;
    }
    return out;
  };
  const h0 = await lies(0, 127), dv = new DataView(h0.buffer);
  if(String.fromCharCode(...h0.slice(0, 7)) !== 'PMTiles' || h0[7] !== 3) throw new Error('Kartendatei hat ein unbekanntes Format');
  const u64 = (o)=> dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296;
  const h = { rootOff: u64(8), rootLen: u64(16), leafOff: u64(40), leafLen: u64(48), datenOff: u64(56), datenLen: u64(64),
    adressiert: u64(72), inhalte: u64(88), innenGz: h0[97] === 2, kachelGz: h0[98] === 2, maxZ: h0[101] };
  const ent = async (u8, gz)=> new Uint8Array(gz ? await vkGunzip(u8) : u8.buffer);
  const wurzel = vkPmtVerzeichnis(await ent(await lies(h.rootOff, h.rootLen), h.innenGz));
  const blaetter = new Map();
  const suche = (dir, id)=>{ let lo = 0, hi = dir.length - 1, best = -1; while(lo <= hi){ const mi = (lo + hi) >> 1; if(dir[mi].id <= id){ best = mi; lo = mi + 1; } else hi = mi - 1; } return best < 0 ? null : dir[best]; };
  const finde = async (id)=>{
    let dir = wurzel;
    for(let tiefe = 0; tiefe < 4; tiefe++){
      const e = suche(dir, id); if(!e) return null;
      if(e.run === 0){
        const k = e.off + ':' + e.len;
        if(!blaetter.has(k)) blaetter.set(k, ent(await lies(h.leafOff + e.off, e.len), h.innenGz).then(vkPmtVerzeichnis));
        dir = await blaetter.get(k); continue;
      }
      return id < e.id + e.run ? { off: h.datenOff + e.off, len: e.len } : null;
    }
    return null;
  };
  return { v, h, lies, finde, abrufe: ()=> teilAbrufe };
}
async function vkGunzip(buf){ return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); }
async function vkHolen(url, ms){ const r = await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status); return r; }
function ebenen(u8){ const n=[]; let p=0; const rv=()=>{ let v=0,f=1,b; do{ b=u8[p++]; v+=(b&0x7f)*f; f*=128; }while(b&0x80); return v; };
  while(p<u8.length){ const k=rv(), feld=k>>3, typ=k&7; if(typ===2){ const l=rv(); if(feld===3){ const sub=u8.subarray(p,p+l); let q=0; const rv2=()=>{ let v=0,f=1,b; do{ b=sub[q++]; v+=(b&0x7f)*f; f*=128; }while(b&0x80); return v; }; while(q<sub.length){ const k2=rv2(); if((k2&7)===2){ const l2=rv2(); if((k2>>3)===1){ n.push(new TextDecoder().decode(sub.subarray(q,q+l2))); break; } q+=l2; } else if((k2&7)===0) rv2(); else break; } } p+=l; } else if(typ===0) rv(); else break; }
  return n; }
(async()=>{
  const pm = await vkPmtOeffnen('https://seblussi.github.io/karten-bw/bw/');
  console.log('::notice::Kopf: ' + JSON.stringify(pm.h));
  for(const [z,x,y,name] of [[14,8553,5661,'Offenburg z14'],[10,534,353,'z10'],[5,16,11,'z5']]){
    const f = await pm.finde(vkPmtZxyId(z,x,y)); if(!f){ console.log('::notice::'+name+': fehlt'); continue; }
    const roh = await pm.lies(f.off, f.len); const t = new Uint8Array(pm.h.kachelGz ? await vkGunzip(roh) : roh);
    console.log('::notice::'+name+': '+f.len+' B gepackt, '+t.length+' B, Ebenen '+ebenen(t).join(','));
  }
  for(const r of [30, 50, 75, 100]){
    const l = vkEigenKachelListe({lat:48.47, lon:7.94}, r); let b=0, n=0, t0=Date.now();
    for(const [z,x,y] of l){ const f = await pm.finde(vkPmtZxyId(z,x,y)); if(f){ b+=f.len; n++; } }
    console.log('::notice::Umkreis '+r+' km um Offenburg: '+n+' Kacheln, '+(b/1048576).toFixed(0)+' MB, Verzeichnis-Abrufe bisher '+pm.abrufe()+', '+(Date.now()-t0)+' ms');
  }
})().catch(e=>{ console.log('::error::'+e.message); process.exit(1); });
