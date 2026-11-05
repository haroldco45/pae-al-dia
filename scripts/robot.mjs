// Robot de PAE al Día — Vibras Positivas HM
// Corre en GitHub Actions cada 30 minutos. Busca noticias reales del PAE
// (Google News + Bing News con fotos) y los videos más nuevos del canal
// de YouTube de la Unidad Alimentos para Aprender. Escribe data/noticias.json.
// Node 20+, sin dependencias.

import { readFile, writeFile } from 'node:fs/promises';

const SALIDA = new URL('../data/noticias.json', import.meta.url);
const CANAL_UAPA = 'UCtfxQ_1KDeG74_mx4vkS4Xw';
const MAX_ITEMS = 70;

const CONSULTAS = [
  '"PAE" alimentación escolar',
  '"Alimentos para Aprender"',
  'PAE Antioquia alimentación escolar',
  'PAE Contraloría alimentación escolar',
  'PAE Caucasia OR "Bajo Cauca" alimentación escolar',
  '"programa de alimentación escolar" Colombia',
  'PAE Sincelejo',
  'UNGRD Sincelejo reintegro',
  'PAE Procuraduría OR Fiscalía alcalde'
];

const UA = 'Mozilla/5.0 (compatible; PAEalDiaBot/1.0; +https://github.com/haroldco45/pae-al-dia)';

async function traer(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-CO,es;q=0.9' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

const desentidad = s => (s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/<[^>]+>/g, '').trim();

const etiqueta = (bloque, tag) => {
  const m = bloque.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? desentidad(m[1]) : '';
};

function items(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
}

function esRelevante(titulo) {
  const t = titulo.toLowerCase();
  if (/per[uú]|midis|chile|junaeb|antofagasta|argentina|guatemala|el salvador/.test(t)) return false;
  if (/sincelejo/.test(t) && /ungrd|36\.?3|reintegr|devolver|alimentaci/.test(t)) return true;
  return /pae|alimentaci[oó]n escolar|alimentos para aprender|restaurante escolar|uapa|manipulador/.test(t);
}

async function googleNews(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:30d')}&hl=es-419&gl=CO&ceid=CO:es-419`;
  const xml = await traer(url);
  return items(xml).map(b => {
    let titulo = etiqueta(b, 'title');
    const fuente = etiqueta(b, 'source');
    if (fuente && titulo.endsWith(' - ' + fuente)) titulo = titulo.slice(0, -(fuente.length + 3));
    return { titulo, fuente, url: etiqueta(b, 'link'), fecha: new Date(etiqueta(b, 'pubDate')).toISOString(), imagen: '' };
  });
}

async function bingNews(q) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&cc=CO&setlang=es`;
  const xml = await traer(url);
  return items(xml).map(b => {
    let link = etiqueta(b, 'link');
    const real = link.match(/[?&]url=([^&]+)/);
    if (real) link = decodeURIComponent(real[1]);
    let imagen = etiqueta(b, 'News:Image');
    if (imagen) imagen = imagen.replace(/&amp;/g, '&') + (imagen.includes('?') ? '&' : '?') + 'w=640&h=360&c=7';
    const fecha = new Date(etiqueta(b, 'pubDate'));
    return { titulo: etiqueta(b, 'title'), fuente: etiqueta(b, 'News:Source'), url: link, fecha: isNaN(fecha) ? new Date().toISOString() : fecha.toISOString(), imagen };
  });
}

async function ogImage(url) {
  if (!url || url.includes('news.google.com')) return '';
  try {
    const html = await traer(url, 10000);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? new URL(desentidad(m[1]), url).href : '';
  } catch { return ''; }
}

async function videosUApA() {
  const xml = await traer(`https://www.youtube.com/feeds/videos.xml?channel_id=${CANAL_UAPA}`);
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].slice(0, 9).map(m => {
    const b = m[1];
    const id = (b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    return { id, titulo: etiqueta(b, 'title'), fecha: etiqueta(b, 'published') };
  }).filter(v => v.id);
}

const clave = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 3).slice(0, 8).join(' ');

async function main() {
  let previo = { items: [], videos: [], fijos: [] };
  try { previo = JSON.parse(await readFile(SALIDA, 'utf8')); } catch {}

  const lotes = await Promise.allSettled([
    ...CONSULTAS.map(q => bingNews(q)),
    ...CONSULTAS.map(q => googleNews(q))
  ]);
  const nuevos = lotes.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  console.log('Noticias traídas:', nuevos.length);

  const mapa = new Map();
  for (const n of [...nuevos, ...(previo.items || [])]) {
    if (!n.titulo || !esRelevante(n.titulo)) continue;
    const k = clave(n.titulo);
    const ya = mapa.get(k);
    if (!ya) mapa.set(k, n);
    else if (!ya.imagen && n.imagen) mapa.set(k, { ...ya, imagen: n.imagen, url: ya.url.includes('news.google') ? n.url : ya.url });
  }

  let lista = [...mapa.values()]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, MAX_ITEMS);

  // Fotos reales: si una noticia no trae imagen, se busca la foto de portada del artículo
  const sinFoto = lista.filter(n => !n.imagen).slice(0, 12);
  await Promise.all(sinFoto.map(async n => { n.imagen = await ogImage(n.url); }));

  let videos = previo.videos || [];
  try { const v = await videosUApA(); if (v.length) videos = v; } catch (e) { console.log('YouTube:', e.message); }

  if (JSON.stringify(lista) === JSON.stringify(previo.items) && JSON.stringify(videos) === JSON.stringify(previo.videos)) {
    console.log('Sin cambios: no se reescribe el archivo');
    return;
  }

  const salida = {
    actualizado: new Date().toISOString(),
    items: lista,
    videos,
    fijos: previo.fijos || []
  };
  await writeFile(SALIDA, JSON.stringify(salida, null, 2) + '\n');
  console.log('Guardadas:', lista.length, 'noticias,', videos.length, 'videos');
}

main().catch(e => { console.error(e); process.exit(1); });
