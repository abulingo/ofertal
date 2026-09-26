// OFERTAL · utilidades compartidas entre index.html y admin.html
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export const SUPABASE_URL = 'https://wvzbaeqzpgsnokcxzpcf.supabase.co';
// Llave pública "anon": es segura en el navegador; la seguridad la dan las políticas RLS.
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2emJhZXF6cGdzbm9rY3h6cGNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMzEyMTksImV4cCI6MjA5NjYwNzIxOX0.VA4wyl8nOCnHwz_gxl9MkQUmC9w8821HjnHpAr112Fw';
export const PIN_SALT = '9876'; // contraseña = PIN + sal (compatibilidad con cuentas existentes)
export const MAX_FOTOS = 8;

// Imagen para publicaciones sin foto: fondo suave con el ícono de la categoría
export function imagenDefecto(icono = '🛍️') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="0 0 600 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef2ff"/><stop offset="1" stop-color="#f1f5f9"/></linearGradient></defs><rect width="600" height="450" fill="url(#g)"/><text x="300" y="225" font-size="120" text-anchor="middle" dominant-baseline="central">${icono}</text><text x="300" y="360" font-size="26" font-family="Inter,system-ui,sans-serif" fill="#94a3b8" text-anchor="middle">Sin foto</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
export const IMG_DEFECTO = imagenDefecto();
export const esImagenReal = (u) => typeof u === 'string' && /^https?:/.test(u) && !u.includes('unsplash.com/photo-1516321318423');

// Columnas visibles para visitantes sin sesión (sin teléfono de contacto)
export const COLS_ANUNCIO_PUBLICO = 'id,created_at,titulo,tipo,descripcion,precio,estado,user_id,departamento,municipio,imagen_urls,categoria,precio_negociable,zona_lat,zona_lng,zona_radio,vistas,destacado,aprobado_at,updated_at,operacion,detalles,zona_fuente,fuente,vence_at';

export function crearCliente(storageKey) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, ...(storageKey ? { storageKey } : {}) },
  });
}

// ------------------------------------------------------------------ Texto y formato
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtCOP = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);
export const fmtNum = (n) => new Intl.NumberFormat('es-CO').format(Number(n) || 0);

export function precioTexto(precio, negociable, operacion = null) {
  if (!Number(precio)) return 'A convenir';
  return fmtCOP(precio) + (operacion === 'arriendo' ? '/mes' : '') + (negociable ? ' · negociable' : '');
}

export const TIPOS = {
  producto: { nombre: 'Producto', icono: '🛍️', clase: 'text-blue-700 bg-blue-50' },
  servicio: { nombre: 'Servicio', icono: '🧰', clase: 'text-emerald-700 bg-emerald-50' },
  inmueble: { nombre: 'Inmueble', icono: '🏠', clase: 'text-amber-800 bg-amber-50' },
};
export const etiquetaTipo = (a) => a.tipo === 'inmueble' ? (a.operacion === 'arriendo' ? 'En arriendo' : 'En venta') : (TIPOS[a.tipo]?.nombre || a.tipo);

export function detallesInmueble(d) {
  if (!d) return [];
  const out = [];
  if (+d.habitaciones) out.push(`🛏️ ${d.habitaciones} hab.`);
  if (+d.banos) out.push(`🛁 ${d.banos} baño${+d.banos === 1 ? '' : 's'}`);
  if (+d.area_m2) out.push(`📐 ${d.area_m2} m²`);
  if (d.amoblado) out.push('🛋️ Amoblado');
  if (d.servicios_incluidos) out.push('💡 Servicios incluidos');
  return out;
}

export function textoVence(fecha) {
  if (!fecha) return '';
  const dias = Math.ceil((new Date(fecha) - Date.now()) / 864e5);
  if (dias < 0) return 'vencida';
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence mañana';
  return `vence en ${dias} días`;
}

export function tiempoRelativo(fecha) {
  if (!fecha) return '';
  const seg = Math.round((Date.now() - new Date(fecha).getTime()) / 1000);
  if (seg < 45) return 'hace un momento';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} día${d === 1 ? '' : 's'}`;
  return new Date(fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const fechaHora = (f) => f ? new Date(f).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function mascaraPrecio(input) {
  input.addEventListener('input', () => {
    const v = input.value.replace(/\D/g, '');
    input.value = v ? new Intl.NumberFormat('es-CO').format(parseInt(v, 10)) : '';
  });
}
export const leerPrecio = (v) => {
  const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

export function parseImagenes(campo, icono) {
  let imgs = campo;
  if (typeof campo === 'string') { try { imgs = JSON.parse(campo); } catch { imgs = []; } }
  imgs = Array.isArray(imgs) ? imgs.filter(esImagenReal) : [];
  return imgs.length ? imgs : [imagenDefecto(icono)];
}
export function fotosReales(campo) {
  let imgs = campo;
  if (typeof campo === 'string') { try { imgs = JSON.parse(campo); } catch { imgs = []; } }
  return Array.isArray(imgs) ? imgs.filter(esImagenReal) : [];
}

export function errorMsg(err, porDefecto = 'Ocurrió un error. Intenta de nuevo.') {
  const m = err?.message || err?.error_description || err?.error || '';
  if (!m) return porDefecto;
  if (/^[A-Z_]+: /.test(m)) return m.replace(/^[A-Z_]+: /, '');
  if (m.includes('security purposes')) return 'Por seguridad espera unos segundos e intenta de nuevo.';
  if (m.includes('Invalid login credentials')) return 'Número o PIN incorrectos.';
  if (m.includes('already registered')) return 'Este número ya tiene una cuenta. Inicia sesión.';
  if (m.includes('Failed to fetch')) return 'Sin conexión. Revisa tu internet.';
  if (m.includes('row-level security')) return 'No tienes permiso para esta acción.';
  return m.length < 160 ? m : porDefecto;
}

export const codigoError = (err) => (err?.message || '').match(/^([A-Z_]+):/)?.[1] || null;

// ------------------------------------------------------------------ Distancias
export function distanciaKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return null;
  const R = 6371, rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function textoDistancia(km) {
  if (km == null) return '';
  if (km < 2) return 'a menos de 2 km';
  if (km < 10) return `a ~${Math.round(km)} km`;
  return `a ~${Math.round(km / 5) * 5} km`;
}

// ------------------------------------------------------------------ Toasts
export function toast(msg, tipo = 'info', ms = 3800) {
  let cont = document.getElementById('toasts');
  if (!cont) {
    cont = document.createElement('div');
    cont.id = 'toasts';
    cont.className = 'fixed top-3 inset-x-0 z-[100] flex flex-col items-center gap-2 px-3 pointer-events-none';
    cont.setAttribute('aria-live', 'polite');
    document.body.appendChild(cont);
  }
  const colores = { info: 'bg-slate-900 text-white', ok: 'bg-emerald-600 text-white', error: 'bg-rose-600 text-white', aviso: 'bg-amber-500 text-slate-900' };
  const iconos = { info: 'ℹ️', ok: '✅', error: '⚠️', aviso: '🔔' };
  const t = document.createElement('div');
  t.className = `toast-in pointer-events-auto max-w-md w-full sm:w-auto px-4 py-3 rounded-2xl shadow-xl text-sm font-medium flex items-start gap-2 ${colores[tipo] || colores.info}`;
  t.innerHTML = `<span>${iconos[tipo] || ''}</span><span class="grow">${esc(msg)}</span>`;
  cont.appendChild(t);
  setTimeout(() => { t.classList.add('opacity-0', 'transition'); setTimeout(() => t.remove(), 300); }, ms);
  return t;
}

// ------------------------------------------------------------------ Modales
const pilaModales = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pilaModales.length) pilaModales[pilaModales.length - 1].cerrar();
});

export function modal({ titulo = '', html = '', ancho = 'sm:max-w-lg', sinPadding = false, pie = '', onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4 fade-in';
  wrap.innerHTML = `
    <div role="dialog" aria-modal="true" class="modal-in bg-white w-full ${ancho} rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[94vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
      ${titulo ? `<div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <h2 class="font-bold text-lg text-slate-800 truncate">${titulo}</h2>
          <button type="button" data-cerrar class="w-9 h-9 shrink-0 rounded-full hover:bg-slate-100 text-slate-500 grid place-items-center" aria-label="Cerrar">✕</button>
        </div>` : ''}
      <div class="overflow-y-auto grow ${sinPadding ? '' : 'p-5'}" data-cuerpo>${html}</div>
      ${pie ? `<div class="border-t border-slate-100 p-4 bg-slate-50 shrink-0" data-pie>${pie}</div>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('overflow-hidden');
  let cerrado = false;
  const api = {
    el: wrap,
    cuerpo: wrap.querySelector('[data-cuerpo]'),
    pie: wrap.querySelector('[data-pie]'),
    cerrar() {
      if (cerrado) return;
      cerrado = true;
      wrap.remove();
      const i = pilaModales.indexOf(api);
      if (i >= 0) pilaModales.splice(i, 1);
      if (!pilaModales.length) document.body.classList.remove('overflow-hidden');
      onClose?.();
    },
  };
  pilaModales.push(api);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) api.cerrar(); });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-cerrar]')) api.cerrar(); });
  return api;
}

export const cerrarTodosLosModales = () => [...pilaModales].reverse().forEach((m) => m.cerrar());

export function confirmar(mensaje, { titulo = '¿Estás seguro?', ok = 'Confirmar', peligro = false } = {}) {
  return new Promise((resolve) => {
    let r = false;
    const m = modal({
      titulo: esc(titulo), ancho: 'sm:max-w-sm',
      html: `<p class="text-slate-600 text-sm leading-relaxed">${esc(mensaje)}</p>
        <div class="flex gap-2 mt-5">
          <button data-cerrar class="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700">Cancelar</button>
          <button data-ok class="flex-1 py-2.5 rounded-xl font-semibold text-white ${peligro ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}">${esc(ok)}</button>
        </div>`,
      onClose: () => resolve(r),
    });
    m.el.querySelector('[data-ok]').onclick = () => { r = true; m.cerrar(); };
  });
}

export function pedirTexto({ titulo, etiqueta = '', placeholder = '', valor = '', opciones = [], multilinea = true, ok = 'Aceptar', requerido = true }) {
  return new Promise((resolve) => {
    let r = null;
    const m = modal({
      titulo: esc(titulo), ancho: 'sm:max-w-md',
      html: `<form class="space-y-3">
          ${etiqueta ? `<label class="block text-sm font-medium text-slate-700">${esc(etiqueta)}</label>` : ''}
          ${opciones.length ? `<div class="flex flex-wrap gap-2">${opciones.map((o) => `<button type="button" data-op="${esc(o)}" class="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300">${esc(o)}</button>`).join('')}</div>` : ''}
          ${multilinea
            ? `<textarea rows="3" class="campo resize-none" placeholder="${esc(placeholder)}">${esc(valor)}</textarea>`
            : `<input class="campo" placeholder="${esc(placeholder)}" value="${esc(valor)}">`}
          <div class="flex gap-2 pt-1">
            <button type="button" data-cerrar class="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700">Cancelar</button>
            <button class="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 font-semibold text-white">${esc(ok)}</button>
          </div></form>`,
      onClose: () => resolve(r),
    });
    const campo = m.el.querySelector('textarea, input');
    setTimeout(() => campo.focus(), 50);
    m.el.querySelectorAll('[data-op]').forEach((b) => (b.onclick = () => { campo.value = b.dataset.op; campo.focus(); }));
    m.el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const v = campo.value.trim();
      if (requerido && !v) { campo.focus(); return; }
      r = v; m.cerrar();
    };
  });
}

// ------------------------------------------------------------------ Colombia
let colombia = null;
export async function datosColombia() {
  if (colombia) return colombia;
  const base = new URL('../data/colombia.json', import.meta.url);
  colombia = await fetch(base).then((r) => r.json()).catch(() => ({}));
  return colombia;
}

export async function llenarSelectDepartamentos(selDepto, selMun, { depto = '', mun = '', todos = false } = {}) {
  const data = await datosColombia();
  selDepto.innerHTML = `<option value="">${todos ? 'Todo Colombia' : 'Departamento…'}</option>` +
    Object.keys(data).map((d) => `<option ${d === depto ? 'selected' : ''}>${esc(d)}</option>`).join('');
  const llenarMun = (valor = '') => {
    if (!selMun) return;
    const lista = data[selDepto.value] || [];
    selMun.disabled = !lista.length;
    selMun.innerHTML = `<option value="">${lista.length ? 'Municipio…' : 'Elige departamento'}</option>` +
      lista.map((m) => `<option ${m === valor ? 'selected' : ''}>${esc(m)}</option>`).join('');
  };
  llenarMun(mun);
  selDepto.addEventListener('change', () => llenarMun());
}

// Centro aproximado del casco urbano de un municipio (OpenStreetMap / Nominatim), con caché local.
export async function coordenadasMunicipio(municipio, departamento) {
  if (!municipio) return null;
  const clave = `${municipio}|${departamento || ''}`;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem('ofertal-geo') || '{}'); } catch { /* sin almacenamiento */ }
  if (cache[clave]) return cache[clave];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=co&city=${encodeURIComponent(municipio)}${departamento ? '&state=' + encodeURIComponent(departamento) : ''}`;
  const r = await fetch(url, { headers: { 'Accept-Language': 'es' } }).then((x) => x.json()).catch(() => []);
  if (!r.length) return null;
  const prioridad = (x) => (['city', 'town', 'village', 'hamlet'].includes(x.type) ? 0 : ['city', 'town', 'village'].includes(x.addresstype) ? 1 : 2);
  const mejor = [...r].sort((a, b) => prioridad(a) - prioridad(b))[0];
  const res = { lat: +(+mejor.lat).toFixed(5), lng: +(+mejor.lon).toFixed(5) };
  cache[clave] = res;
  try { localStorage.setItem('ofertal-geo', JSON.stringify(cache)); } catch { /* sin almacenamiento */ }
  return res;
}

// ------------------------------------------------------------------ Imágenes
// Convierte cualquier foto a WebP (más liviano y rápido) antes de subirla. Si el navegador no
// sabe generar WebP (algunos Safari antiguos) usa JPEG.
export async function comprimirImagen(file, maxDim = 1600, calidad = 0.8) {
  if (!file.type.startsWith('image/')) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const escala = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * escala);
  c.height = Math.round(bmp.height * escala);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  let blob = await new Promise((res) => c.toBlob(res, 'image/webp', calidad));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
  return blob || file;
}

export async function subirImagen(db, userId, file, prefijo = 'img') {
  const blob = await comprimirImagen(file);
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
  const ruta = `${userId}/${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await db.storage.from('imagenes').upload(ruta, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
  if (error) throw new Error('No se pudo subir la imagen: ' + error.message);
  return db.storage.from('imagenes').getPublicUrl(ruta).data.publicUrl;
}

// ------------------------------------------------------------------ Mapas (Leaflet)
const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIB = '&copy; OpenStreetMap';

export function crearMapa(el, { centro = [4.6, -74.1], zoom = 6, interactivo = true } = {}) {
  if (!window.L) { el.innerHTML = '<p class="text-xs text-slate-400 p-4">Mapa no disponible</p>'; return null; }
  const mapa = L.map(el, {
    zoomControl: interactivo, dragging: interactivo, scrollWheelZoom: false, doubleClickZoom: interactivo,
    touchZoom: interactivo, attributionControl: true,
  }).setView(centro, zoom);
  L.tileLayer(TILE, { attribution: ATRIB, maxZoom: 18 }).addTo(mapa);
  setTimeout(() => mapa.invalidateSize(), 150);
  return mapa;
}

// Dibuja SOLO el área aproximada (sin marcador): el centro no es la ubicación real.
export function mapaZona(el, { lat, lng, radio = 1000 }, { color = '#4f46e5', interactivo = true } = {}) {
  const mapa = crearMapa(el, { centro: [lat, lng], zoom: 14, interactivo });
  if (!mapa) return null;
  const c = L.circle([lat, lng], { radius: radio, color, weight: 2, fillColor: color, fillOpacity: 0.15 }).addTo(mapa);
  mapa.fitBounds(c.getBounds(), { padding: [20, 20] });
  mapa.setMaxZoom(15);
  return mapa;
}

// ------------------------------------------------------------------ Edge Functions
export async function llamarFuncion(db, nombre, cuerpo) {
  const { data: { session } } = await db.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${nombre}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(cuerpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Error del servidor');
  return d;
}

// ------------------------------------------------------------------ Varios
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function estrellas(valor, tam = 'text-sm') {
  const v = Math.round(Number(valor) || 0);
  return `<span class="${tam} text-amber-400 tracking-tight" aria-label="${v} de 5 estrellas">${'★'.repeat(v)}<span class="text-slate-300">${'★'.repeat(5 - v)}</span></span>`;
}

export function avatar(perfil, tam = 'w-10 h-10 text-base') {
  const nombre = perfil?.nombre || '?';
  if (perfil?.avatar_url) return `<img src="${esc(perfil.avatar_url)}" alt="" class="${tam} rounded-full object-cover shrink-0 bg-slate-100">`;
  const colores = ['bg-indigo-100 text-indigo-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700'];
  const i = [...(perfil?.id || nombre)].reduce((a, c) => a + c.charCodeAt(0), 0) % colores.length;
  return `<div class="${tam} ${colores[i]} rounded-full grid place-items-center font-bold shrink-0">${esc(nombre.charAt(0).toUpperCase())}</div>`;
}

export const ESTADOS_ANUNCIO = {
  pendiente: ['En revisión', 'bg-amber-100 text-amber-800'],
  aprobado: ['Publicado', 'bg-emerald-100 text-emerald-800'],
  rechazado: ['Rechazado', 'bg-rose-100 text-rose-800'],
  pausado: ['Pausado', 'bg-slate-200 text-slate-700'],
  vendido: ['Vendido / Finalizado', 'bg-sky-100 text-sky-800'],
  vencido: ['Vencida', 'bg-orange-100 text-orange-800'],
};
export const ESTADOS_SOLICITUD = {
  pendiente: ['En revisión', 'bg-amber-100 text-amber-800'],
  abierta: ['Abierta', 'bg-emerald-100 text-emerald-800'],
  asignada: ['Asignada', 'bg-sky-100 text-sky-800'],
  cerrada: ['Cerrada', 'bg-slate-200 text-slate-700'],
  rechazada: ['Rechazada', 'bg-rose-100 text-rose-800'],
  vencida: ['Vencida', 'bg-orange-100 text-orange-800'],
};
export const ESTADOS_TICKET = {
  abierto: ['Abierto', 'bg-amber-100 text-amber-800'],
  en_proceso: ['En proceso', 'bg-sky-100 text-sky-800'],
  esperando_usuario: ['Respondido', 'bg-indigo-100 text-indigo-800'],
  resuelto: ['Resuelto', 'bg-emerald-100 text-emerald-800'],
  cerrado: ['Cerrado', 'bg-slate-200 text-slate-700'],
};
export const CATEGORIAS_TICKET = {
  cuenta: 'Mi cuenta / PIN', publicacion: 'Mis publicaciones', solicitud: 'Solicitudes y propuestas',
  seguridad: 'Seguridad / fraude', reporte: 'Reportar un problema', sugerencia: 'Sugerencia', otro: 'Otro',
};
export const URGENCIAS = { normal: ['Sin afán', 'bg-slate-100 text-slate-600'], pronto: ['Esta semana', 'bg-amber-100 text-amber-800'], urgente: ['⚡ Urgente', 'bg-rose-100 text-rose-700'] };

export const badge = ([texto, clase]) => `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${clase}">${esc(texto)}</span>`;
