// OFERTAL · Panel de administración (admin.html)
import {
  crearCliente, esc, fmtNum, fmtCOP, precioTexto, tiempoRelativo, fechaHora, parseImagenes, errorMsg, toast, modal,
  cerrarTodosLosModales, confirmar, pedirTexto, crearMapa, llamarFuncion, debounce, estrellas, avatar, badge,
  distanciaKm, ESTADOS_ANUNCIO, ESTADOS_SOLICITUD, ESTADOS_TICKET, CATEGORIAS_TICKET, URGENCIAS, PIN_SALT,
} from './common.js';

// Sesión separada de la del sitio público
const db = crearCliente('ofertal-admin-auth');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const contenido = $('#contenido');

const A = {
  user: null,
  perfil: null,
  seccion: 'resumen',
  perfiles: new Map(),
  categorias: [],
  canal: null,
  pendientes: {},
  filtros: {
    ofertas: { estado: 'pendiente', q: '', categoria: '' },
    solicitudes: { estado: 'pendiente', q: '' },
    usuarios: { q: '', filtro: 'todos' },
    soporte: { filtro: 'abiertos', q: '' },
    reportes: { estado: 'pendiente' },
  },
  ticketAbierto: null,
  seleccion: new Set(),
};

const SECCIONES = [
  ['resumen', '📊', 'Resumen'],
  ['ofertas', '🛍️', 'Ofertas', 'anuncios'],
  ['solicitudes', '🙋', 'Solicitudes', 'solicitudes'],
  ['usuarios', '👥', 'Usuarios'],
  ['mapa', '🗺️', 'Mapa de ubicaciones'],
  ['soporte', '🛟', 'Soporte', 'tickets'],
  ['reportes', '⚑', 'Reportes', 'reportes'],
  ['conversaciones', '💬', 'Conversaciones'],
  ['avisos', '📢', 'Avisos y notificaciones'],
  ['categorias', '🏷️', 'Categorías'],
  ['config', '⚙️', 'Configuración'],
  ['actividad', '🧾', 'Registro de actividad'],
  ['cuenta', '🔐', 'Mi cuenta'],
];

const MOTIVOS_RECHAZO = [
  'Información incompleta o poco clara',
  'Las fotos no corresponden o no son adecuadas',
  'Producto o servicio no permitido',
  'Precio engañoso o irreal',
  'Publicación duplicada',
  'Sospecha de fraude',
  'Datos de contacto en el texto',
];

const PLANTILLAS = [
  ['Saludo', '¡Hola! Gracias por escribirnos. Ya estamos revisando tu caso y te responderemos muy pronto.\n\nEquipo OFERTAL'],
  ['Publicación aprobada', '¡Hola! Revisamos tu publicación y ya está aprobada y visible para todos. ¡Éxitos con tus ventas!\n\nEquipo OFERTAL'],
  ['Ubicación', 'Para activar la ubicación: toca el candado 🔒 junto a la dirección web → Permisos → Ubicación → Permitir. Verifica que el GPS esté encendido y recarga la página.\n\nEquipo OFERTAL'],
  ['PIN restablecido', 'Hola, restablecimos tu PIN. Ingresa con tu número de WhatsApp y el nuevo PIN que te enviamos, y cámbialo en «Mi perfil».\n\nEquipo OFERTAL'],
  ['Más información', 'Hola, para ayudarte necesitamos un poco más de información: ¿puedes contarnos en qué publicación ocurrió y qué pasos seguiste?\n\nEquipo OFERTAL'],
  ['Cierre', 'Damos por resuelto tu caso. Si necesitas algo más, responde este ticket y con gusto te ayudamos. ¡Gracias por usar OFERTAL!\n\nEquipo OFERTAL'],
];

// ======================================================================
// SESIÓN
// ======================================================================
async function iniciar() {
  const { data: { session } } = await db.auth.getSession();
  if (session) await entrar(session.user);
  else mostrarLogin();
  db.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') mostrarLogin(); });
}

function mostrarLogin(msg = '') {
  detenerRealtime();
  $('#vistaPanel').classList.add('hidden');
  $('#vistaLogin').classList.remove('hidden');
  const err = $('#loginError');
  err.textContent = msg;
  err.classList.toggle('hidden', !msg);
}

let modoLogin = 'correo';
$$('[data-modo]').forEach((b) => (b.onclick = () => {
  modoLogin = b.dataset.modo;
  $$('[data-modo]').forEach((x) => {
    const on = x === b;
    x.classList.toggle('bg-white', on); x.classList.toggle('shadow', on);
    x.classList.toggle('text-slate-800', on); x.classList.toggle('text-slate-500', !on);
  });
  $$('[data-campo]').forEach((c) => c.classList.toggle('hidden', c.dataset.campo !== modoLogin));
}));

$('#fLogin').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button');
  btn.disabled = true; btn.textContent = 'Verificando…';
  try {
    const cred = modoLogin === 'correo'
      ? { email: f.email.value.trim(), password: f.password.value }
      : { email: `${f.tel.value.trim()}@ofertal.com`, password: f.pin.value.trim() + PIN_SALT };
    const { data, error } = await db.auth.signInWithPassword(cred);
    if (error) throw error;
    await entrar(data.user);
  } catch (ex) {
    mostrarLogin(errorMsg(ex, 'Credenciales incorrectas'));
  } finally {
    btn.disabled = false; btn.textContent = 'Ingresar';
  }
};

async function entrar(user) {
  const { data: esAdmin } = await db.rpc('es_admin');
  if (!esAdmin) {
    await db.auth.signOut();
    return mostrarLogin('Esta cuenta no tiene permisos de administrador.');
  }
  A.user = user;
  const { data: p } = await db.from('perfiles').select('*').eq('id', user.id).single();
  A.perfil = p;
  const { data: cats } = await db.from('categorias').select('*').order('orden');
  A.categorias = cats || [];
  $('#vistaLogin').classList.add('hidden');
  $('#vistaPanel').classList.remove('hidden');
  $('#adminNombre').textContent = `${p?.nombre || 'Administrador'} · ${user.email?.endsWith('@ofertal.com') && /^3\d{9}@/.test(user.email) ? user.email.split('@')[0] : user.email}`;
  renderNavAdmin();
  iniciarRealtime();
  await actualizarPendientes();
  irSeccion();
}

$('#btnSalir').onclick = async () => { await db.auth.signOut(); mostrarLogin(); };
$('#btnMenu').onclick = () => alternarMenu(true);
$('#velo').onclick = () => alternarMenu(false);
$('#btnRefrescar').onclick = () => { actualizarPendientes(); irSeccion(); };
function alternarMenu(abrir) {
  $('#barra').classList.toggle('-translate-x-full', !abrir);
  $('#velo').classList.toggle('hidden', !abrir);
}

// ======================================================================
// NAVEGACIÓN
// ======================================================================
function renderNavAdmin() {
  $('#navAdmin').innerHTML = SECCIONES.map(([id, ico, nombre, clave]) => `
    <a href="#${id}" data-sec="${id}" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 hover:text-white transition">
      <span class="nav-ico w-5 text-center transition">${ico}</span><span class="grow">${nombre}</span>
      ${clave ? `<span data-pend="${clave}" class="hidden text-[10px] font-extrabold bg-rose-500 text-white rounded-full px-1.5 min-w-[20px] text-center"></span>` : ''}
    </a>`).join('');
}

async function actualizarPendientes() {
  const cuenta = (q) => q.then((r) => r.count || 0);
  const [anuncios, solicitudes, tickets, reportes] = await Promise.all([
    cuenta(db.from('anuncios').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')),
    cuenta(db.from('solicitudes').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')),
    cuenta(db.from('tickets').select('id', { count: 'exact', head: true }).eq('no_leido_admin', true).neq('estado', 'cerrado')),
    cuenta(db.from('reportes').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')),
  ]);
  A.pendientes = { anuncios, solicitudes, tickets, reportes };
  Object.entries(A.pendientes).forEach(([k, n]) => {
    const el = $(`[data-pend="${k}"]`);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('hidden', !n);
  });
  const total = anuncios + solicitudes + tickets + reportes;
  document.title = (total ? `(${total}) ` : '') + 'OFERTAL · Administración';
}

window.addEventListener('hashchange', () => irSeccion());

function leerHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const i = h.indexOf('=');
  return i === -1 ? { sec: h || 'resumen', valor: null } : { sec: h.slice(0, i), valor: h.slice(i + 1) };
}

async function irSeccion() {
  if (!A.user) return;
  const { sec, valor } = leerHash();
  const def = SECCIONES.find((s) => s[0] === sec) || SECCIONES[0];
  A.seccion = def[0];
  if (A.seccion !== 'soporte') A.ticketAbierto = null;
  A.seleccion.clear();
  $$('#navAdmin [data-sec]').forEach((a) => a.classList.toggle('activo', a.dataset.sec === A.seccion));
  $('#tituloSeccion').textContent = `${def[1]} ${def[2]}`;
  alternarMenu(false);
  cerrarTodosLosModales();
  contenido.innerHTML = '<div class="py-20 text-center text-slate-400">Cargando…</div>';
  try {
    await SECCION_FN[A.seccion](valor);
  } catch (e) {
    console.error(e);
    contenido.innerHTML = `<div class="tarjeta p-6 text-rose-700">Error: ${esc(errorMsg(e))}</div>`;
  }
}

// ======================================================================
// UTILIDADES
// ======================================================================
async function perfilesDe(ids) {
  const faltan = [...new Set(ids.filter((id) => id && !A.perfiles.has(id)))];
  for (let i = 0; i < faltan.length; i += 150) {
    const { data } = await db.from('perfiles').select('*').in('id', faltan.slice(i, i + 150));
    (data || []).forEach((p) => A.perfiles.set(p.id, p));
  }
  return A.perfiles;
}

async function registrar(accion, entidad, entidadId, detalle = {}) {
  await db.from('admin_log').insert({ admin_id: A.user.id, accion, entidad, entidad_id: String(entidadId ?? ''), detalle });
}

const waLink = (tel, texto = '') => `https://wa.me/57${tel}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;

function riesgoBadge(ia) {
  if (!ia?.riesgo) return '<span class="text-[10px] text-slate-400">IA: —</span>';
  const c = { bajo: 'bg-emerald-100 text-emerald-800', medio: 'bg-amber-100 text-amber-800', alto: 'bg-rose-100 text-rose-800' }[ia.riesgo];
  const ico = { bajo: '✓', medio: '!', alto: '✕' }[ia.riesgo];
  return `<span title="${esc((ia.motivos || []).join(' · ') || ia.resumen || '')}" class="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full ${c}">${ico} IA ${ia.riesgo}</span>`;
}

function puntoRecencia(fecha) {
  if (!fecha) return '<span class="inline-block w-2.5 h-2.5 rounded-full bg-rose-400" title="Sin ubicación"></span>';
  const h = (Date.now() - new Date(fecha)) / 36e5;
  const c = h < 1 ? 'bg-emerald-500' : h < 24 ? 'bg-amber-400' : 'bg-slate-400';
  return `<span class="inline-block w-2.5 h-2.5 rounded-full ${c}" title="Ubicación ${tiempoRelativo(fecha)}"></span>`;
}

function statTile(etiqueta, valor, extra = '', enlace = '') {
  const tag = enlace ? `a href="${enlace}"` : 'div';
  return `<${tag} class="tarjeta p-4 block ${enlace ? 'hover:shadow-md transition' : ''}">
    <p class="text-xs font-medium text-slate-500">${etiqueta}</p>
    <p class="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">${fmtNum(valor)}</p>
    ${extra ? `<p class="text-[11px] text-slate-500 mt-1">${extra}</p>` : ''}
  </${enlace ? 'a' : 'div'}>`;
}

function tabs(opciones, activo, attr) {
  return `<div class="flex gap-1.5 overflow-x-auto hide-scrollbar">${opciones.map(([v, t, n]) => `
    <button data-${attr}="${v}" class="chip ${v === activo ? 'activo' : ''}">${t}${n != null ? ` <span class="opacity-70">(${fmtNum(n)})</span>` : ''}</button>`).join('')}</div>`;
}

// Mapa con zona pública (círculo) + punto exacto (marcador) para comparar
function mapaComparativo(el, { exacta, zona, historial = [] }) {
  const centro = exacta ? [exacta.lat, exacta.lng] : zona ? [zona.lat, zona.lng] : [4.6, -74.1];
  const mapa = crearMapa(el, { centro, zoom: exacta || zona ? 14 : 5 });
  if (!mapa) return null;
  const capas = [];
  if (zona) capas.push(L.circle([zona.lat, zona.lng], { radius: zona.radio || 1000, color: '#4f46e5', weight: 2, fillOpacity: 0.12 }).bindTooltip('Zona pública (lo que ven los usuarios)').addTo(mapa));
  if (historial.length > 1) capas.push(L.polyline(historial.map((h) => [h.lat, h.lng]), { color: '#64748b', weight: 2, opacity: 0.6, dashArray: '4 6' }).addTo(mapa));
  historial.forEach((h) => L.circleMarker([h.lat, h.lng], { radius: 3, color: '#64748b', weight: 1, fillOpacity: 0.6 }).bindTooltip(`${h.evento} · ${fechaHora(h.created_at)}`).addTo(mapa));
  if (exacta) {
    if (exacta.precision) capas.push(L.circle([exacta.lat, exacta.lng], { radius: exacta.precision, color: '#e11d48', weight: 1, fillOpacity: 0.08, dashArray: '3 4' }).addTo(mapa));
    capas.push(L.circleMarker([exacta.lat, exacta.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#e11d48', fillOpacity: 1 }).bindTooltip(exacta.etiqueta || 'Ubicación exacta').addTo(mapa));
  }
  if (capas.length) mapa.fitBounds(L.featureGroup(capas).getBounds(), { padding: [30, 30], maxZoom: 16 });
  return mapa;
}

const gmaps = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

function acciones(el) {
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const fn = ACC[b.dataset.a];
    if (fn) await fn(b.dataset, b);
  });
}

// ======================================================================
// RESUMEN
// ======================================================================
async function secResumen() {
  const { data: st, error } = await db.rpc('admin_estadisticas');
  if (error) throw error;
  const [{ data: pendientes }, { data: tickets }] = await Promise.all([
    db.from('anuncios').select('id, titulo, precio, precio_negociable, user_id, created_at, imagen_urls, ia_analisis').eq('estado', 'pendiente').order('created_at').limit(6),
    db.from('tickets').select('*').neq('estado', 'cerrado').order('updated_at', { ascending: false }).limit(6),
  ]);
  await perfilesDe([...(pendientes || []).map((a) => a.user_id), ...(tickets || []).map((t) => t.user_id)]);
  const maxDep = Math.max(1, ...(st.por_departamento || []).map((d) => d.total));

  contenido.innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
      ${statTile('Usuarios', st.usuarios, `+${st.usuarios_nuevos_7d} en 7 días`, '#usuarios')}
      ${statTile('Activos 24 h', st.usuarios_activos_24h, `${st.ubicacion_reciente} con ubicación reciente`, '#mapa')}
      ${statTile('Ofertas publicadas', st.anuncios_aprobados, `${st.anuncios_total} en total`, '#ofertas')}
      ${statTile('Solicitudes abiertas', st.solicitudes_abiertas, `${st.solicitudes_asignadas} asignadas · ${st.propuestas_total} propuestas`, '#solicitudes')}
      ${statTile('Tickets abiertos', st.tickets_abiertos, `${st.tickets_sin_leer} sin leer`, '#soporte')}
      ${statTile('Reportes pendientes', st.reportes_pendientes, `${st.usuarios_suspendidos} usuarios suspendidos`, '#reportes')}
    </div>
    ${st.anuncios_pendientes || st.solicitudes_pendientes ? `
      <div class="mt-4 rounded-2xl bg-amber-50 border border-amber-200 p-4 flex flex-wrap items-center gap-3 justify-between">
        <p class="text-sm text-amber-900">⏳ <b>${st.anuncios_pendientes}</b> oferta(s) y <b>${st.solicitudes_pendientes}</b> solicitud(es) esperan revisión.</p>
        <div class="flex gap-2"><a href="#ofertas" class="btn btn-oscuro !py-2 text-xs">Revisar ofertas</a><a href="#solicitudes" class="btn btn-suave !py-2 text-xs">Revisar solicitudes</a></div>
      </div>` : ''}
    <div class="grid xl:grid-cols-[1.6fr_1fr] gap-4 mt-4">
      <section class="tarjeta p-5">
        <h2 class="font-bold">Actividad de los últimos 30 días</h2>
        <p class="text-xs text-slate-500">Nuevos registros por día</p>
        <div id="grafico" class="mt-4"></div>
      </section>
      <section class="tarjeta p-5">
        <h2 class="font-bold">Ofertas publicadas por departamento</h2>
        <div class="mt-4 space-y-2.5">${(st.por_departamento || []).map((d) => `
          <div class="grid grid-cols-[110px_1fr_36px] items-center gap-2 text-xs">
            <span class="truncate text-slate-600">${esc(d.departamento)}</span>
            <div class="h-3 bg-slate-100 rounded-r"><div class="h-3 rounded-r" style="width:${(d.total / maxDep) * 100}%;background:#2a78d6"></div></div>
            <span class="text-right font-semibold text-slate-700 tabular-nums">${d.total}</span>
          </div>`).join('') || '<p class="text-sm text-slate-400">Sin datos</p>'}</div>
        <div class="grid grid-cols-2 gap-3 mt-6 text-center">
          <div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-500">Conversaciones</p><p class="text-xl font-bold">${fmtNum(st.conversaciones)}</p></div>
          <div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-500">Mensajes 24 h</p><p class="text-xl font-bold">${fmtNum(st.mensajes_24h)}</p></div>
          <div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-500">Con ubicación</p><p class="text-xl font-bold">${fmtNum(st.con_ubicacion)}</p></div>
          <div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-500">Rechazadas</p><p class="text-xl font-bold">${fmtNum(st.anuncios_rechazados)}</p></div>
        </div>
      </section>
    </div>
    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <section class="tarjeta p-5">
        <div class="flex justify-between items-center mb-3"><h2 class="font-bold">Ofertas por aprobar</h2><a href="#ofertas" class="text-xs text-indigo-600 font-semibold">Ver todas ›</a></div>
        <div class="divide-y divide-slate-50">${(pendientes || []).map((a) => {
          const u = A.perfiles.get(a.user_id) || {};
          return `<div class="py-2.5 flex items-center gap-3">
            <img src="${esc(parseImagenes(a.imagen_urls)[0])}" class="w-12 h-12 rounded-lg object-cover cursor-pointer" data-a="ver-anuncio" data-id="${a.id}">
            <div class="min-w-0 grow"><p class="text-sm font-semibold truncate cursor-pointer hover:text-indigo-600" data-a="ver-anuncio" data-id="${a.id}">${esc(a.titulo)}</p>
              <p class="text-[11px] text-slate-500">${esc(u.nombre || '')} · ${precioTexto(a.precio, a.precio_negociable)} · ${tiempoRelativo(a.created_at)} ${riesgoBadge(a.ia_analisis)}</p></div>
            <button data-a="aprobar-anuncio" data-id="${a.id}" class="btn btn-verde !py-1.5 !px-2.5 text-xs">✓</button>
            <button data-a="rechazar-anuncio" data-id="${a.id}" class="btn btn-rojo !py-1.5 !px-2.5 text-xs">✕</button>
          </div>`;
        }).join('') || '<p class="text-sm text-slate-400 py-4 text-center">🎉 Nada pendiente</p>'}</div>
      </section>
      <section class="tarjeta p-5">
        <div class="flex justify-between items-center mb-3"><h2 class="font-bold">Tickets recientes</h2><a href="#soporte" class="text-xs text-indigo-600 font-semibold">Ir a soporte ›</a></div>
        <div class="divide-y divide-slate-50">${(tickets || []).map((t) => `
          <a href="#soporte=${t.id}" class="py-2.5 flex items-center gap-3 hover:bg-slate-50 -mx-2 px-2 rounded-lg">
            ${t.no_leido_admin ? '<span class="w-2 h-2 rounded-full bg-indigo-600 shrink-0"></span>' : '<span class="w-2 h-2 shrink-0"></span>'}
            <div class="min-w-0 grow"><p class="text-sm font-semibold truncate">#${t.numero} · ${esc(t.asunto)}</p>
              <p class="text-[11px] text-slate-500">${esc(A.perfiles.get(t.user_id)?.nombre || t.nombre_contacto || t.contacto || 'Anónimo')} · ${tiempoRelativo(t.updated_at)}</p></div>
            ${badge(ESTADOS_TICKET[t.estado])}
          </a>`).join('') || '<p class="text-sm text-slate-400 py-4 text-center">Sin tickets abiertos</p>'}</div>
      </section>
    </div>`;
  graficoLineas($('#grafico'), st.serie || [], [
    { clave: 'usuarios', nombre: 'Usuarios', color: 'var(--s1)' },
    { clave: 'anuncios', nombre: 'Ofertas', color: 'var(--s2)' },
    { clave: 'solicitudes', nombre: 'Solicitudes', color: 'var(--s3)' },
  ]);
}

// Gráfico de líneas SVG: 2 px, rejilla tenue, leyenda, cruz + tooltip al pasar el cursor y tabla accesible.
function graficoLineas(el, datos, series) {
  const W = 720, H = 240, m = { l: 34, r: 14, t: 10, b: 26 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxV = Math.max(1, ...datos.flatMap((d) => series.map((s) => d[s.clave] || 0)));
  const paso = maxV <= 4 ? 1 : Math.ceil(maxV / 4);
  const top = paso * Math.ceil(maxV / paso);
  const x = (i) => m.l + (datos.length > 1 ? (i / (datos.length - 1)) * iw : iw / 2);
  const y = (v) => m.t + ih - (v / top) * ih;
  const ticks = []; for (let v = 0; v <= top; v += paso) ticks.push(v);
  const fmtDia = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  el.classList.add('viz');
  el.innerHTML = `
    <div class="flex flex-wrap gap-4 text-xs text-slate-600 mb-2">${series.map((s) => `<span class="inline-flex items-center gap-1.5"><span class="w-4 h-0.5 rounded" style="background:${s.color};height:2px"></span>${s.nombre}</span>`).join('')}</div>
    <div class="relative">
      <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="Registros diarios de usuarios, ofertas y solicitudes en los últimos 30 días">
        ${ticks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)" style="font-variant-numeric:tabular-nums">${v}</text>`).join('')}
        <line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--eje)" stroke-width="1"/>
        ${datos.map((d, i) => (i % 5 === 0 || i === datos.length - 1) ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${fmtDia(d.dia)}</text>` : '').join('')}
        ${series.map((s) => `<path d="${datos.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[s.clave] || 0).toFixed(1)}`).join('')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
        <g data-cursor class="hidden">
          <line data-cx y1="${m.t}" y2="${m.t + ih}" stroke="var(--eje)" stroke-width="1"/>
          ${series.map((s, i) => `<circle data-punto="${i}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join('')}
        </g>
        <rect data-zona x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>
      </svg>
      <div data-tip class="hidden absolute pointer-events-none bg-white border border-slate-200 shadow-lg rounded-xl px-3 py-2 text-xs min-w-[130px]"></div>
    </div>
    <details class="mt-2"><summary class="text-xs text-slate-500 hover:text-slate-700">Ver datos en tabla</summary>
      <div class="max-h-56 overflow-y-auto mt-2"><table class="w-full text-xs"><thead class="text-slate-500"><tr><th class="text-left py-1">Día</th>${series.map((s) => `<th class="text-right">${s.nombre}</th>`).join('')}</tr></thead>
      <tbody class="tabular-nums">${datos.slice().reverse().map((d) => `<tr class="border-t border-slate-50"><td class="py-1">${fmtDia(d.dia)}</td>${series.map((s) => `<td class="text-right">${d[s.clave] || 0}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </details>`;
  const svg = $('svg', el), zona = $('[data-zona]', el), cursor = $('[data-cursor]', el), tip = $('[data-tip]', el);
  const mover = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(datos.length - 1, Math.round(((px - m.l) / iw) * (datos.length - 1))));
    const d = datos[i];
    cursor.classList.remove('hidden');
    $('[data-cx]', el).setAttribute('x1', x(i)); $('[data-cx]', el).setAttribute('x2', x(i));
    series.forEach((s, k) => { const c = $(`[data-punto="${k}"]`, el); c.setAttribute('cx', x(i)); c.setAttribute('cy', y(d[s.clave] || 0)); });
    tip.innerHTML = `<p class="font-bold text-slate-800 mb-1">${fmtDia(d.dia)}</p>${series.map((s) => `<p class="flex items-center gap-2 text-slate-600"><span class="w-2.5 h-2.5 rounded-full" style="background:${s.color}"></span><span class="grow">${s.nombre}</span><b class="text-slate-900 tabular-nums">${d[s.clave] || 0}</b></p>`).join('')}`;
    tip.classList.remove('hidden');
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(left + 12, r.width - tip.offsetWidth)}px`;
    tip.style.top = '8px';
  };
  zona.addEventListener('mousemove', mover);
  zona.addEventListener('mouseleave', () => { cursor.classList.add('hidden'); tip.classList.add('hidden'); });
}

// ======================================================================
// OFERTAS
// ======================================================================
async function contarPorEstado(tabla, estados) {
  const r = await Promise.all(estados.map((e) => db.from(tabla).select('id', { count: 'exact', head: true }).eq('estado', e).then((x) => x.count || 0)));
  return Object.fromEntries(estados.map((e, i) => [e, r[i]]));
}

async function secOfertas() {
  const f = A.filtros.ofertas;
  const estados = Object.keys(ESTADOS_ANUNCIO);
  const conteos = await contarPorEstado('anuncios', estados);
  let q = db.from('anuncios').select('*').order('created_at', { ascending: f.estado === 'pendiente' }).limit(200);
  if (f.estado !== 'todos') q = q.eq('estado', f.estado);
  if (f.categoria) q = q.eq('categoria', f.categoria);
  if (f.q) {
    const t = f.q.replace(/[%,()*"\\]/g, ' ').trim();
    if (t) q = q.or(`titulo.ilike.%${t}%,descripcion.ilike.%${t}%,municipio.ilike.%${t}%,contacto.ilike.%${t}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  const lista = data || [];
  await perfilesDe(lista.map((a) => a.user_id));
  contenido.innerHTML = `
    <div class="flex flex-wrap gap-3 items-center justify-between">
      ${tabs([...estados.map((e) => [e, ESTADOS_ANUNCIO[e][0], conteos[e]]), ['todos', 'Todas', Object.values(conteos).reduce((a, b) => a + b, 0)]], f.estado, 'estado')}
      <div class="flex gap-2">
        <select id="fCat" class="campo !w-auto !py-2 text-sm"><option value="">Todas las categorías</option>${A.categorias.map((c) => `<option ${c.nombre === f.categoria ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
        <input id="fBuscar" type="search" class="campo !py-2 text-sm w-56" placeholder="Buscar título, municipio, teléfono…" value="${esc(f.q)}">
      </div>
    </div>
    <div id="barraMasiva" class="hidden mt-3 rounded-xl bg-slate-900 text-white p-3 flex flex-wrap items-center gap-2 text-sm">
      <span id="nSel" class="font-bold"></span><span class="grow"></span>
      <button data-a="masivo-anuncios" data-estado="aprobado" class="btn btn-verde !py-1.5 text-xs">✓ Aprobar</button>
      <button data-a="masivo-anuncios" data-estado="rechazado" class="btn bg-rose-600 hover:bg-rose-700 text-white !py-1.5 text-xs">✕ Rechazar</button>
      <button data-a="masivo-ia" class="btn bg-indigo-500 hover:bg-indigo-400 text-white !py-1.5 text-xs">✨ Analizar con IA</button>
    </div>
    <div class="tarjeta mt-3 overflow-x-auto">
      <table class="w-full text-sm min-w-[900px]">
        <thead class="text-xs text-slate-500 bg-slate-50 text-left"><tr>
          <th class="p-3 w-8"><input type="checkbox" id="selTodos" class="accent-indigo-600"></th>
          <th class="p-3">Publicación</th><th class="p-3">Usuario</th><th class="p-3">Precio</th><th class="p-3">Ubicación</th><th class="p-3">Estado</th><th class="p-3 text-right">Acciones</th>
        </tr></thead>
        <tbody class="divide-y divide-slate-50">${lista.map((a) => filaAnuncio(a)).join('') || '<tr><td colspan="7" class="p-10 text-center text-slate-400">No hay publicaciones en este estado</td></tr>'}</tbody>
      </table>
    </div>`;
  $('#fCat').onchange = (e) => { f.categoria = e.target.value; secOfertas(); };
  $('#fBuscar').oninput = debounce((e) => { f.q = e.target.value; secOfertas().then(() => { const i = $('#fBuscar'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 400);
  enlazarSeleccion();
}

function filaAnuncio(a) {
  const u = A.perfiles.get(a.user_id) || {};
  return `<tr class="fila align-top">
    <td class="p-3"><input type="checkbox" data-sel="${a.id}" class="accent-indigo-600"></td>
    <td class="p-3"><div class="flex gap-3 cursor-pointer" data-a="ver-anuncio" data-id="${a.id}">
      <img src="${esc(parseImagenes(a.imagen_urls)[0])}" class="w-14 h-14 rounded-lg object-cover shrink-0">
      <div class="min-w-0"><p class="font-semibold line-clamp-2 hover:text-indigo-600">${a.destacado ? '⭐ ' : ''}${esc(a.titulo)}</p>
      <p class="text-[11px] text-slate-500">${a.tipo} · ${esc(a.categoria || 'Sin categoría')} · ${tiempoRelativo(a.created_at)}</p>
      <div class="mt-1">${riesgoBadge(a.ia_analisis)}</div></div></div></td>
    <td class="p-3"><button data-a="ver-usuario" data-id="${a.user_id}" class="text-left hover:text-indigo-600"><p class="font-semibold">${esc(u.nombre || '—')} ${u.verificado ? '<span class="text-sky-500">✔</span>' : ''}${u.estado === 'suspendido' ? ' <span class="text-rose-600 text-[10px] font-bold">SUSPENDIDO</span>' : ''}</p><p class="text-[11px] text-slate-500">${esc(a.contacto || u.whatsapp || '')}</p></button></td>
    <td class="p-3 font-semibold whitespace-nowrap">${precioTexto(a.precio, a.precio_negociable)}</td>
    <td class="p-3 text-xs text-slate-600">${esc(a.municipio || '—')}<br><span class="text-slate-400">${esc(a.departamento || '')}</span></td>
    <td class="p-3">${badge(ESTADOS_ANUNCIO[a.estado])}<p class="text-[10px] text-slate-400 mt-1">👁 ${fmtNum(a.vistas)}</p></td>
    <td class="p-3"><div class="flex justify-end gap-1 flex-wrap">
      ${a.estado !== 'aprobado' ? `<button data-a="aprobar-anuncio" data-id="${a.id}" class="btn btn-verde !py-1.5 !px-2.5 text-xs" title="Aprobar">✓ Aprobar</button>` : ''}
      ${a.estado !== 'rechazado' ? `<button data-a="rechazar-anuncio" data-id="${a.id}" class="btn btn-rojo !py-1.5 !px-2.5 text-xs" title="Rechazar">✕</button>` : ''}
      <button data-a="ver-anuncio" data-id="${a.id}" class="btn btn-suave !py-1.5 !px-2.5 text-xs">Ver</button>
    </div></td></tr>`;
}

function enlazarSeleccion() {
  const actualizar = () => {
    const n = A.seleccion.size;
    $('#barraMasiva')?.classList.toggle('hidden', !n);
    if ($('#nSel')) $('#nSel').textContent = `${n} seleccionada(s)`;
  };
  $$('[data-sel]', contenido).forEach((c) => (c.onchange = () => { c.checked ? A.seleccion.add(c.dataset.sel) : A.seleccion.delete(c.dataset.sel); actualizar(); }));
  const todos = $('#selTodos');
  if (todos) todos.onchange = () => { $$('[data-sel]', contenido).forEach((c) => { c.checked = todos.checked; c.checked ? A.seleccion.add(c.dataset.sel) : A.seleccion.delete(c.dataset.sel); }); actualizar(); };
}

async function cambiarEstadoAnuncio(id, estado, motivo = null) {
  const cambios = { estado };
  if (estado === 'rechazado') cambios.motivo_rechazo = motivo;
  const { data, error } = await db.from('anuncios').update(cambios).eq('id', id).select('titulo').single();
  if (error) throw error;
  await registrar(`anuncio_${estado}`, 'anuncio', id, { titulo: data?.titulo, motivo });
}

async function verAnuncio(id) {
  const [{ data: a }, { data: ubPub }] = await Promise.all([
    db.from('anuncios').select('*').eq('id', id).single(),
    db.from('ubicaciones_publicacion').select('*').eq('entidad', 'anuncio').eq('entidad_id', id).maybeSingle(),
  ]);
  if (!a) return toast('No encontrada', 'error');
  await perfilesDe([a.user_id]);
  const u = A.perfiles.get(a.user_id) || {};
  const { data: ubAct } = await db.from('ubicaciones').select('*').eq('user_id', a.user_id).maybeSingle();
  const ia = a.ia_analisis;
  const distPub = ubPub && a.zona_lat != null ? distanciaKm(ubPub.lat, ubPub.lng, a.zona_lat, a.zona_lng) : null;
  const m = modal({
    titulo: `${a.tipo === 'producto' ? '🛍️' : '🧰'} ${esc(a.titulo)}`, ancho: 'sm:max-w-5xl',
    html: `<div class="grid lg:grid-cols-2 gap-6">
      <div class="space-y-4">
        <div class="grid grid-cols-3 gap-2">${parseImagenes(a.imagen_urls).map((src) => `<a href="${esc(src)}" target="_blank"><img src="${esc(src)}" class="w-full aspect-square object-cover rounded-xl"></a>`).join('')}</div>
        <div class="flex flex-wrap gap-1.5">${badge(ESTADOS_ANUNCIO[a.estado])} ${riesgoBadge(ia)} ${a.destacado ? badge(['⭐ Destacado', 'bg-amber-100 text-amber-800']) : ''}</div>
        <p class="text-2xl font-black text-indigo-600">${precioTexto(a.precio, a.precio_negociable)}</p>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="rounded-lg bg-slate-50 p-2"><span class="text-slate-400 block">Categoría</span><select data-cat class="campo !py-1 !text-xs mt-1"><option value="">Sin categoría</option>${A.categorias.map((c) => `<option ${c.nombre === a.categoria ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></div>
          <div class="rounded-lg bg-slate-50 p-2"><span class="text-slate-400 block">Declarado</span><b>${esc(a.municipio || '—')}, ${esc(a.departamento || '')}</b></div>
          <div class="rounded-lg bg-slate-50 p-2"><span class="text-slate-400 block">Creada</span><b>${fechaHora(a.created_at)}</b></div>
          <div class="rounded-lg bg-slate-50 p-2"><span class="text-slate-400 block">Vistas</span><b>${fmtNum(a.vistas)}</b></div>
        </div>
        <div><h4 class="text-xs font-bold uppercase text-slate-400 mb-1">Descripción</h4><p class="text-sm whitespace-pre-wrap text-slate-700">${esc(a.descripcion)}</p></div>
        ${a.motivo_rechazo ? `<div class="rounded-xl bg-rose-50 text-rose-800 text-sm p-3"><b>Motivo de rechazo:</b> ${esc(a.motivo_rechazo)}</div>` : ''}
        <div class="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-sm">
          <div class="flex justify-between items-center"><b>✨ Análisis de IA</b><button data-a="ia-anuncio" data-id="${a.id}" class="text-xs font-semibold text-indigo-600">${ia ? 'Reanalizar' : 'Analizar ahora'}</button></div>
          ${ia ? `<p class="mt-1 text-slate-700">${esc(ia.resumen || '')}</p>${(ia.motivos || []).length ? `<ul class="list-disc ml-5 mt-1 text-xs text-slate-600">${ia.motivos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p class="text-[10px] text-slate-400 mt-1">Sugiere: ${esc(ia.categoria_sugerida || '—')} · ${fechaHora(ia.fecha)}</p>` : '<p class="text-xs text-slate-500 mt-1">Sin análisis todavía.</p>'}
        </div>
      </div>
      <div class="space-y-4">
        <button data-a="ver-usuario" data-id="${a.user_id}" class="w-full text-left flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50">
          ${avatar(u, 'w-11 h-11')}
          <div class="grow min-w-0"><p class="font-bold truncate">${esc(u.nombre || '—')} ${u.verificado ? '<span class="text-sky-500">✔</span>' : ''}</p><p class="text-xs text-slate-500">📱 ${esc(u.whatsapp || a.contacto || '')} · ${esc(u.municipio || '')}</p></div><span class="text-slate-300">›</span>
        </button>
        <div>
          <h4 class="text-xs font-bold uppercase text-slate-400 mb-1">Ubicación de publicación (privada)</h4>
          <div class="mapa mapa-grande" data-mapa></div>
          <div class="text-xs text-slate-600 mt-2 space-y-1">
            <p><span class="inline-block w-3 h-3 rounded-full bg-rose-600 align-middle"></span> Punto exacto al publicar: ${ubPub ? `<a class="text-indigo-600 underline" target="_blank" href="${gmaps(ubPub.lat, ubPub.lng)}">${ubPub.lat.toFixed(5)}, ${ubPub.lng.toFixed(5)}</a> (±${Math.round(ubPub.precision_m || 0)} m)` : '<b>no registrado</b> (publicación anterior a la v2)'}</p>
            <p><span class="inline-block w-3 h-3 rounded-full border-2 border-indigo-600 align-middle"></span> Zona pública: ${a.zona_lat != null ? `radio ${a.zona_radio} m${distPub != null ? ` · centro desplazado ${Math.round(distPub * 1000)} m del punto real` : ''}` : 'sin zona'}</p>
            ${ubAct ? `<p>📡 Ubicación actual del usuario: <a class="text-indigo-600 underline" target="_blank" href="${gmaps(ubAct.lat, ubAct.lng)}">ver</a> · ${tiempoRelativo(ubAct.updated_at)}</p>` : ''}
          </div>
        </div>
      </div>
    </div>`,
    pie: `<div class="flex flex-wrap gap-2">
      ${a.estado !== 'aprobado' ? `<button data-a="aprobar-anuncio" data-id="${a.id}" class="btn btn-verde">✓ Aprobar</button>` : ''}
      ${a.estado !== 'rechazado' ? `<button data-a="rechazar-anuncio" data-id="${a.id}" class="btn btn-rojo">✕ Rechazar</button>` : ''}
      ${a.estado === 'aprobado' ? `<button data-a="pausar-anuncio" data-id="${a.id}" class="btn btn-suave">⏸ Pausar</button>` : ''}
      <button data-a="destacar-anuncio" data-id="${a.id}" data-valor="${a.destacado ? '0' : '1'}" class="btn btn-suave">${a.destacado ? '☆ Quitar destacado' : '⭐ Destacar'}</button>
      <a href="index.html#anuncio=${a.id}" target="_blank" class="btn btn-suave">Ver en el sitio ↗</a>
      <span class="grow"></span>
      <button data-a="eliminar-anuncio" data-id="${a.id}" class="btn btn-rojo">🗑 Eliminar</button>
    </div>`,
  });
  acciones(m.el);
  mapaComparativo($('[data-mapa]', m.el), {
    exacta: ubPub ? { lat: ubPub.lat, lng: ubPub.lng, precision: ubPub.precision_m, etiqueta: 'Punto exacto al publicar' } : null,
    zona: a.zona_lat != null ? { lat: a.zona_lat, lng: a.zona_lng, radio: a.zona_radio } : null,
  });
  $('[data-cat]', m.el).onchange = async (e) => {
    const { error } = await db.from('anuncios').update({ categoria: e.target.value || null }).eq('id', a.id);
    if (error) return toast(errorMsg(error), 'error');
    registrar('anuncio_categoria', 'anuncio', a.id, { categoria: e.target.value });
    toast('Categoría actualizada', 'ok');
  };
}

// ======================================================================
// SOLICITUDES
// ======================================================================
async function secSolicitudes() {
  const f = A.filtros.solicitudes;
  const estados = Object.keys(ESTADOS_SOLICITUD);
  const conteos = await contarPorEstado('solicitudes', estados);
  let q = db.from('solicitudes').select('*').order('created_at', { ascending: f.estado === 'pendiente' }).limit(200);
  if (f.estado !== 'todos') q = q.eq('estado', f.estado);
  if (f.q) {
    const t = f.q.replace(/[%,()*"\\]/g, ' ').trim();
    if (t) q = q.or(`titulo.ilike.%${t}%,descripcion.ilike.%${t}%,municipio.ilike.%${t}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  const lista = data || [];
  await perfilesDe(lista.map((s) => s.user_id));
  const { data: cp } = lista.length ? await db.rpc('contar_propuestas', { p_solicitudes: lista.map((s) => s.id) }) : { data: [] };
  const nProp = new Map((cp || []).map((x) => [x.solicitud_id, x.total]));
  contenido.innerHTML = `
    <div class="flex flex-wrap gap-3 items-center justify-between">
      ${tabs([...estados.map((e) => [e, ESTADOS_SOLICITUD[e][0], conteos[e]]), ['todos', 'Todas', Object.values(conteos).reduce((a, b) => a + b, 0)]], f.estado, 'estado')}
      <input id="fBuscar" type="search" class="campo !py-2 text-sm w-60" placeholder="Buscar…" value="${esc(f.q)}">
    </div>
    <div id="barraMasiva" class="hidden mt-3 rounded-xl bg-slate-900 text-white p-3 flex flex-wrap items-center gap-2 text-sm">
      <span id="nSel" class="font-bold"></span><span class="grow"></span>
      <button data-a="masivo-solicitudes" data-estado="abierta" class="btn btn-verde !py-1.5 text-xs">✓ Aprobar y publicar</button>
      <button data-a="masivo-solicitudes" data-estado="rechazada" class="btn bg-rose-600 text-white !py-1.5 text-xs">✕ Rechazar</button>
    </div>
    <div class="tarjeta mt-3 overflow-x-auto">
      <table class="w-full text-sm min-w-[860px]">
        <thead class="text-xs text-slate-500 bg-slate-50 text-left"><tr>
          <th class="p-3 w-8"><input type="checkbox" id="selTodos" class="accent-indigo-600"></th>
          <th class="p-3">Solicitud</th><th class="p-3">Usuario</th><th class="p-3">Presupuesto</th><th class="p-3">Ubicación</th><th class="p-3">Estado</th><th class="p-3 text-right">Acciones</th>
        </tr></thead>
        <tbody class="divide-y divide-slate-50">${lista.map((s) => {
          const u = A.perfiles.get(s.user_id) || {};
          return `<tr class="fila align-top">
            <td class="p-3"><input type="checkbox" data-sel="${s.id}" class="accent-indigo-600"></td>
            <td class="p-3 cursor-pointer" data-a="ver-solicitud" data-id="${s.id}"><p class="font-semibold hover:text-indigo-600">${esc(s.titulo)}</p>
              <p class="text-[11px] text-slate-500">${esc(s.categoria || 'Sin categoría')} · ${tiempoRelativo(s.created_at)} · ${nProp.get(s.id) || 0} propuesta(s)</p>
              <div class="mt-1 flex gap-1">${badge(URGENCIAS[s.urgencia])} ${riesgoBadge(s.ia_analisis)}</div></td>
            <td class="p-3"><button data-a="ver-usuario" data-id="${s.user_id}" class="text-left hover:text-indigo-600"><p class="font-semibold">${esc(u.nombre || '—')}</p><p class="text-[11px] text-slate-500">${esc(u.whatsapp || '')}</p></button></td>
            <td class="p-3 font-semibold">${s.presupuesto ? fmtCOP(s.presupuesto) : 'A convenir'}</td>
            <td class="p-3 text-xs">${esc(s.municipio || '—')}<br><span class="text-slate-400">${esc(s.departamento || '')}</span></td>
            <td class="p-3">${badge(ESTADOS_SOLICITUD[s.estado])}</td>
            <td class="p-3"><div class="flex justify-end gap-1 flex-wrap">
              ${s.estado === 'pendiente' || s.estado === 'rechazada' ? `<button data-a="aprobar-solicitud" data-id="${s.id}" class="btn btn-verde !py-1.5 !px-2.5 text-xs">✓ Publicar</button>` : ''}
              ${s.estado !== 'rechazada' ? `<button data-a="rechazar-solicitud" data-id="${s.id}" class="btn btn-rojo !py-1.5 !px-2.5 text-xs">✕</button>` : ''}
              <button data-a="ver-solicitud" data-id="${s.id}" class="btn btn-suave !py-1.5 !px-2.5 text-xs">Ver</button>
            </div></td></tr>`;
        }).join('') || '<tr><td colspan="7" class="p-10 text-center text-slate-400">No hay solicitudes en este estado</td></tr>'}</tbody>
      </table>
    </div>`;
  $('#fBuscar').oninput = debounce((e) => { f.q = e.target.value; secSolicitudes().then(() => { const i = $('#fBuscar'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 400);
  enlazarSeleccion();
}

async function cambiarEstadoSolicitud(id, estado, motivo = null) {
  const cambios = { estado };
  if (estado === 'rechazada') cambios.motivo_rechazo = motivo;
  if (estado === 'abierta') cambios.motivo_rechazo = null;
  const { data, error } = await db.from('solicitudes').update(cambios).eq('id', id).select('titulo').single();
  if (error) throw error;
  await registrar(`solicitud_${estado}`, 'solicitud', id, { titulo: data?.titulo, motivo });
}

async function verSolicitud(id) {
  const [{ data: s }, { data: ubPub }, { data: props }] = await Promise.all([
    db.from('solicitudes').select('*').eq('id', id).single(),
    db.from('ubicaciones_publicacion').select('*').eq('entidad', 'solicitud').eq('entidad_id', id).maybeSingle(),
    db.from('propuestas').select('*').eq('solicitud_id', id).order('created_at'),
  ]);
  if (!s) return;
  await perfilesDe([s.user_id, ...(props || []).map((p) => p.proveedor_id)]);
  const u = A.perfiles.get(s.user_id) || {};
  const m = modal({
    titulo: `🙋 ${esc(s.titulo)}`, ancho: 'sm:max-w-5xl',
    html: `<div class="grid lg:grid-cols-2 gap-6">
      <div class="space-y-4">
        <div class="flex flex-wrap gap-1.5">${badge(ESTADOS_SOLICITUD[s.estado])} ${badge(URGENCIAS[s.urgencia])} ${riesgoBadge(s.ia_analisis)}</div>
        <p class="text-sm">Presupuesto: <b class="text-emerald-700 text-lg">${s.presupuesto ? fmtCOP(s.presupuesto) : 'A convenir'}</b> · ${esc(s.categoria || 'Sin categoría')} · ${s.tipo}</p>
        <p class="text-sm whitespace-pre-wrap text-slate-700">${esc(s.descripcion)}</p>
        <p class="text-xs text-slate-500">📍 ${esc(s.municipio || '')}, ${esc(s.departamento || '')} · ${fechaHora(s.created_at)} · 👁 ${fmtNum(s.vistas)}</p>
        ${s.ia_analisis ? `<div class="rounded-xl bg-indigo-50/50 border border-indigo-100 p-3 text-sm"><b>✨ IA:</b> ${esc(s.ia_analisis.resumen || '')}</div>` : ''}
        <button data-a="ver-usuario" data-id="${s.user_id}" class="w-full text-left flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50">${avatar(u, 'w-10 h-10')}<div><p class="font-bold">${esc(u.nombre || '—')}</p><p class="text-xs text-slate-500">📱 ${esc(u.whatsapp || '')}</p></div></button>
        <div><h4 class="text-xs font-bold uppercase text-slate-400 mb-2">Propuestas (${(props || []).length})</h4>
          <div class="space-y-2">${(props || []).map((p) => {
            const pr = A.perfiles.get(p.proveedor_id) || {};
            return `<div class="rounded-xl border border-slate-100 p-3 text-sm"><div class="flex justify-between gap-2"><button data-a="ver-usuario" data-id="${p.proveedor_id}" class="font-bold hover:text-indigo-600">${esc(pr.nombre || '—')}</button><span class="font-bold text-emerald-700">${p.precio ? fmtCOP(p.precio) : 'A convenir'}</span></div>
              <p class="text-slate-600 mt-1">${esc(p.mensaje)}</p><p class="text-[10px] text-slate-400 mt-1">${p.estado} · ${fechaHora(p.created_at)}</p></div>`;
          }).join('') || '<p class="text-sm text-slate-400">Sin propuestas</p>'}</div></div>
      </div>
      <div><h4 class="text-xs font-bold uppercase text-slate-400 mb-1">Ubicación (privada)</h4><div class="mapa mapa-grande" data-mapa></div>
        <p class="text-xs text-slate-600 mt-2">${ubPub ? `Punto exacto: <a class="text-indigo-600 underline" target="_blank" href="${gmaps(ubPub.lat, ubPub.lng)}">${ubPub.lat.toFixed(5)}, ${ubPub.lng.toFixed(5)}</a> (±${Math.round(ubPub.precision_m || 0)} m)` : 'Sin punto exacto registrado'}</p></div>
    </div>`,
    pie: `<div class="flex flex-wrap gap-2">
      ${['pendiente', 'rechazada', 'cerrada'].includes(s.estado) ? `<button data-a="aprobar-solicitud" data-id="${s.id}" class="btn btn-verde">✓ Publicar</button>` : ''}
      ${s.estado !== 'rechazada' ? `<button data-a="rechazar-solicitud" data-id="${s.id}" class="btn btn-rojo">✕ Rechazar</button>` : ''}
      ${['abierta', 'asignada'].includes(s.estado) ? `<button data-a="cerrar-solicitud" data-id="${s.id}" class="btn btn-suave">🔒 Cerrar</button>` : ''}
      <button data-a="ia-solicitud" data-id="${s.id}" class="btn btn-suave">✨ Analizar con IA</button>
      <span class="grow"></span><button data-a="eliminar-solicitud" data-id="${s.id}" class="btn btn-rojo">🗑 Eliminar</button></div>`,
  });
  acciones(m.el);
  mapaComparativo($('[data-mapa]', m.el), {
    exacta: ubPub ? { lat: ubPub.lat, lng: ubPub.lng, precision: ubPub.precision_m } : null,
    zona: s.zona_lat != null ? { lat: s.zona_lat, lng: s.zona_lng, radio: s.zona_radio } : null,
  });
}

// ======================================================================
// USUARIOS
// ======================================================================
async function secUsuarios(idAbrir) {
  const f = A.filtros.usuarios;
  const { data, error } = await db.rpc('admin_usuarios');
  if (error) throw error;
  const todos = data || [];
  todos.forEach((u) => A.perfiles.set(u.id, { ...A.perfiles.get(u.id), ...u }));
  const filtros = {
    todos: () => true,
    activos24: (u) => u.ultima_conexion && Date.now() - new Date(u.ultima_conexion) < 864e5,
    sin_ubicacion: (u) => !u.lat,
    verificados: (u) => u.verificado,
    suspendidos: (u) => u.estado === 'suspendido',
    admins: (u) => u.rol === 'admin',
    sin_terminos: (u) => !u.terminos_aceptados_at,
  };
  const txt = f.q.toLowerCase();
  const lista = todos.filter(filtros[f.filtro]).filter((u) => !txt || [u.nombre, u.whatsapp, u.municipio, u.departamento].some((v) => (v || '').toLowerCase().includes(txt)));
  contenido.innerHTML = `
    <div class="flex flex-wrap gap-3 items-center justify-between">
      ${tabs(Object.keys(filtros).map((k) => [k, { todos: 'Todos', activos24: 'Activos 24 h', sin_ubicacion: 'Sin ubicación', verificados: 'Verificados', suspendidos: 'Suspendidos', admins: 'Administradores', sin_terminos: 'Sin aceptar términos' }[k], todos.filter(filtros[k]).length]), f.filtro, 'filtro')}
      <input id="fBuscar" type="search" class="campo !py-2 text-sm w-64" placeholder="Nombre, WhatsApp, municipio…" value="${esc(f.q)}">
    </div>
    <div class="tarjeta mt-3 overflow-x-auto">
      <table class="w-full text-sm min-w-[980px]">
        <thead class="text-xs text-slate-500 bg-slate-50 text-left"><tr>
          <th class="p-3">Usuario</th><th class="p-3">WhatsApp</th><th class="p-3">Municipio</th><th class="p-3 text-center">Ofertas / Solic.</th><th class="p-3">Calificación</th><th class="p-3">Ubicación</th><th class="p-3">Última conexión</th><th class="p-3">Registro</th>
        </tr></thead>
        <tbody class="divide-y divide-slate-50">${lista.map((u) => `
          <tr class="fila cursor-pointer" data-a="ver-usuario" data-id="${u.id}">
            <td class="p-3"><div class="flex items-center gap-2.5">${avatar(u, 'w-9 h-9 text-sm')}<div><p class="font-semibold">${esc(u.nombre || 'Sin nombre')} ${u.verificado ? '<span class="text-sky-500">✔</span>' : ''}</p>
              <p class="flex gap-1 mt-0.5">${u.rol === 'admin' ? badge(['Admin', 'bg-indigo-100 text-indigo-800']) : ''}${u.estado === 'suspendido' ? badge(['Suspendido', 'bg-rose-100 text-rose-800']) : ''}</p></div></div></td>
            <td class="p-3 tabular-nums">${esc(u.whatsapp || '')}</td>
            <td class="p-3 text-xs">${esc(u.municipio || '—')}<br><span class="text-slate-400">${esc(u.departamento || '')}</span></td>
            <td class="p-3 text-center tabular-nums">${u.num_anuncios} / ${u.num_solicitudes}</td>
            <td class="p-3">${u.num_resenas ? `★ ${u.calificacion} <span class="text-xs text-slate-400">(${u.num_resenas})</span>` : '<span class="text-slate-300">—</span>'}</td>
            <td class="p-3 text-xs">${puntoRecencia(u.ubicacion_at)} ${u.ubicacion_at ? tiempoRelativo(u.ubicacion_at) : 'Nunca'}</td>
            <td class="p-3 text-xs">${u.ultima_conexion ? tiempoRelativo(u.ultima_conexion) : '—'}</td>
            <td class="p-3 text-xs">${new Date(u.created_at).toLocaleDateString('es-CO')}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="p-10 text-center text-slate-400">Sin resultados</td></tr>'}</tbody>
      </table>
    </div>`;
  $$('button[data-filtro]', contenido).forEach((b) => (b.onclick = () => { f.filtro = b.dataset.filtro; secUsuarios(); }));
  $('#fBuscar').oninput = debounce((e) => { f.q = e.target.value; secUsuarios().then(() => { const i = $('#fBuscar'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300);
  if (idAbrir) verUsuario(idAbrir);
}

async function verUsuario(id) {
  const [{ data: rows }, { data: hist }, { data: anuncios }, { data: sols }, { data: tickets }, { data: resenas }] = await Promise.all([
    db.rpc('admin_usuarios'),
    db.from('ubicaciones_historial').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(150),
    db.from('anuncios').select('id, titulo, estado, precio, precio_negociable, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    db.from('solicitudes').select('id, titulo, estado, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    db.from('tickets').select('id, numero, asunto, estado, updated_at').eq('user_id', id).order('updated_at', { ascending: false }),
    db.from('resenas').select('*').eq('usuario_id', id).order('created_at', { ascending: false }),
  ]);
  const u = (rows || []).find((x) => x.id === id);
  if (!u) return toast('Usuario no encontrado', 'error');
  A.perfiles.set(id, { ...A.perfiles.get(id), ...u });
  await perfilesDe((resenas || []).map((r) => r.autor_id));
  const m = modal({
    titulo: 'Detalle de usuario', ancho: 'sm:max-w-6xl',
    html: `<div class="grid lg:grid-cols-[1fr_1.3fr] gap-6">
      <div class="space-y-4">
        <div class="flex items-center gap-4">${avatar(u, 'w-16 h-16 text-2xl')}
          <div class="min-w-0"><h3 class="text-xl font-extrabold">${esc(u.nombre || 'Sin nombre')} ${u.verificado ? '<span class="text-sky-500">✔</span>' : ''}</h3>
          <div class="flex flex-wrap gap-1 mt-1">${badge([u.rol === 'admin' ? 'Administrador' : 'Usuario', u.rol === 'admin' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-600'])} ${badge(u.estado === 'activo' ? ['Activo', 'bg-emerald-100 text-emerald-800'] : ['Suspendido', 'bg-rose-100 text-rose-800'])}</div></div>
        </div>
        ${u.estado === 'suspendido' && u.motivo_suspension ? `<div class="rounded-xl bg-rose-50 text-rose-800 text-sm p-3">Motivo: ${esc(u.motivo_suspension)}</div>` : ''}
        <div class="grid grid-cols-2 gap-2 text-xs">
          ${[['WhatsApp', u.whatsapp ? `<a class="text-emerald-700 underline" target="_blank" href="${waLink(u.whatsapp)}">${esc(u.whatsapp)}</a>` : '—'], ['Edad', u.edad || '—'], ['Municipio', `${esc(u.municipio || '—')}, ${esc(u.departamento || '')}`], ['Calificación', u.num_resenas ? `★ ${u.calificacion} (${u.num_resenas})` : '—'],
             ['Registro', fechaHora(u.created_at)], ['Último ingreso', fechaHora(u.ultimo_ingreso)], ['Última conexión', u.ultima_conexion ? tiempoRelativo(u.ultima_conexion) : '—'], ['Ofertas / Solicitudes', `${u.num_anuncios} / ${u.num_solicitudes}`],
             ['Términos y condiciones', u.terminos_aceptados_at ? `✓ v${esc(u.terminos_version || '')} · ${fechaHora(u.terminos_aceptados_at)}` : '<span class="text-amber-600">Pendiente de aceptar</span>']]
            .map(([k, v]) => `<div class="rounded-lg bg-slate-50 p-2"><span class="text-slate-400 block">${k}</span><b class="text-slate-700">${v}</b></div>`).join('')}
        </div>
        ${u.bio ? `<p class="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">${esc(u.bio)}</p>` : ''}
        <div class="flex flex-wrap gap-2">
          <button data-a="u-verificar" data-id="${id}" data-valor="${u.verificado ? '0' : '1'}" class="btn btn-suave text-xs">${u.verificado ? 'Quitar verificación' : '✔ Verificar identidad'}</button>
          ${u.estado === 'activo' ? `<button data-a="u-suspender" data-id="${id}" class="btn btn-rojo text-xs">⛔ Suspender</button>` : `<button data-a="u-activar" data-id="${id}" class="btn btn-verde text-xs">✓ Reactivar</button>`}
          <button data-a="u-notificar" data-id="${id}" class="btn btn-suave text-xs">🔔 Enviar notificación</button>
          <button data-a="u-reset-pin" data-id="${id}" data-tel="${esc(u.whatsapp || '')}" class="btn btn-suave text-xs">🔑 Restablecer PIN</button>
          ${id !== A.user.id ? `<button data-a="u-rol" data-id="${id}" data-valor="${u.rol === 'admin' ? 'usuario' : 'admin'}" class="btn btn-suave text-xs">${u.rol === 'admin' ? 'Quitar rol admin' : '🛡️ Hacer administrador'}</button>` : ''}
          <a href="index.html#usuario=${id}" target="_blank" class="btn btn-suave text-xs">Perfil público ↗</a>
          ${id !== A.user.id ? `<button data-a="u-eliminar" data-id="${id}" class="btn btn-rojo text-xs">🗑 Eliminar cuenta</button>` : ''}
        </div>
        <details open class="rounded-xl border border-slate-100"><summary class="p-3 font-bold text-sm">Ofertas (${(anuncios || []).length})</summary>
          <div class="px-3 pb-3 space-y-1 max-h-52 overflow-y-auto">${(anuncios || []).map((a) => `<button data-a="ver-anuncio" data-id="${a.id}" class="w-full text-left flex justify-between gap-2 text-sm py-1 hover:text-indigo-600"><span class="truncate">${esc(a.titulo)}</span>${badge(ESTADOS_ANUNCIO[a.estado])}</button>`).join('') || '<p class="text-xs text-slate-400">Ninguna</p>'}</div></details>
        <details class="rounded-xl border border-slate-100"><summary class="p-3 font-bold text-sm">Solicitudes (${(sols || []).length})</summary>
          <div class="px-3 pb-3 space-y-1">${(sols || []).map((s) => `<button data-a="ver-solicitud" data-id="${s.id}" class="w-full text-left flex justify-between gap-2 text-sm py-1 hover:text-indigo-600"><span class="truncate">${esc(s.titulo)}</span>${badge(ESTADOS_SOLICITUD[s.estado])}</button>`).join('') || '<p class="text-xs text-slate-400">Ninguna</p>'}</div></details>
        <details class="rounded-xl border border-slate-100"><summary class="p-3 font-bold text-sm">Tickets (${(tickets || []).length})</summary>
          <div class="px-3 pb-3 space-y-1">${(tickets || []).map((t) => `<a href="#soporte=${t.id}" class="flex justify-between gap-2 text-sm py-1 hover:text-indigo-600"><span class="truncate">#${t.numero} ${esc(t.asunto)}</span>${badge(ESTADOS_TICKET[t.estado])}</a>`).join('') || '<p class="text-xs text-slate-400">Ninguno</p>'}</div></details>
        <details class="rounded-xl border border-slate-100"><summary class="p-3 font-bold text-sm">Reseñas recibidas (${(resenas || []).length})</summary>
          <div class="px-3 pb-3 space-y-2">${(resenas || []).map((r) => `<div class="text-sm flex gap-2 items-start"><div class="grow">${estrellas(r.estrellas, 'text-xs')} <b class="text-xs">${esc(A.perfiles.get(r.autor_id)?.nombre || '')}</b><p class="text-slate-600 text-xs">${esc(r.comentario || '')}</p></div><button data-a="borrar-resena" data-id="${r.id}" class="text-xs text-rose-600">Borrar</button></div>`).join('') || '<p class="text-xs text-slate-400">Ninguna</p>'}</div></details>
      </div>
      <div class="space-y-3">
        <div class="flex items-center justify-between"><h4 class="font-bold text-sm">📍 Ubicación exacta (privada)</h4>
          ${u.lat ? `<a target="_blank" href="${gmaps(u.lat, u.lng)}" class="text-xs text-indigo-600 font-semibold">Abrir en Google Maps ↗</a>` : ''}</div>
        <div class="mapa mapa-grande !h-[460px]" data-mapa></div>
        <p class="text-xs text-slate-600">${u.lat ? `<span class="inline-block w-3 h-3 rounded-full bg-rose-600 align-middle"></span> Actual: ${u.lat.toFixed(5)}, ${u.lng.toFixed(5)} · ±${Math.round(u.precision_m || 0)} m · ${tiempoRelativo(u.ubicacion_at)}` : 'Este usuario todavía no ha compartido su ubicación.'}
          ${u.zona_lat != null ? ` · <span class="inline-block w-3 h-3 rounded-full border-2 border-indigo-600 align-middle"></span> zona pública de ${u.zona_radio} m` : ''} · <span class="text-slate-400">línea gris = recorrido</span></p>
        <div class="rounded-xl border border-slate-100 max-h-64 overflow-y-auto">
          <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-500 sticky top-0"><tr><th class="p-2 text-left">Fecha</th><th class="p-2 text-left">Evento</th><th class="p-2 text-left">Coordenadas</th><th class="p-2 text-right">Precisión</th></tr></thead>
          <tbody class="divide-y divide-slate-50 tabular-nums">${(hist || []).map((h) => `<tr><td class="p-2">${fechaHora(h.created_at)}</td><td class="p-2">${esc(h.evento)}</td><td class="p-2"><a class="text-indigo-600" target="_blank" href="${gmaps(h.lat, h.lng)}">${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}</a></td><td class="p-2 text-right">±${Math.round(h.precision_m || 0)} m</td></tr>`).join('') || '<tr><td colspan="4" class="p-4 text-center text-slate-400">Sin historial</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`,
  });
  acciones(m.el);
  mapaComparativo($('[data-mapa]', m.el), {
    exacta: u.lat ? { lat: u.lat, lng: u.lng, precision: u.precision_m, etiqueta: 'Ubicación actual' } : null,
    zona: u.zona_lat != null ? { lat: u.zona_lat, lng: u.zona_lng, radio: u.zona_radio } : null,
    historial: (hist || []).slice().reverse(),
  });
}

async function actualizarPerfil(id, cambios, accion, detalle = {}) {
  const { error } = await db.from('perfiles').update(cambios).eq('id', id);
  if (error) throw error;
  A.perfiles.delete(id);
  await registrar(accion, 'usuario', id, detalle);
}

// ======================================================================
// MAPA
// ======================================================================
async function secMapa() {
  const [{ data: usuarios }, { data: pubs }] = await Promise.all([
    db.rpc('admin_usuarios'),
    db.from('ubicaciones_publicacion').select('*').order('created_at', { ascending: false }).limit(500),
  ]);
  const conUbic = (usuarios || []).filter((u) => u.lat);
  contenido.innerHTML = `
    <div class="flex flex-wrap items-center gap-4 text-xs text-slate-600 mb-3">
      <span class="font-bold text-slate-800">${conUbic.length} usuarios con ubicación</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-emerald-500"></span>Última hora</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-amber-400"></span>Últimas 24 h</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-slate-400"></span>Más antigua</span>
      <label class="inline-flex items-center gap-1.5 ml-auto"><input type="checkbox" id="verZonas" class="accent-indigo-600"> Zonas públicas</label>
      <label class="inline-flex items-center gap-1.5"><input type="checkbox" id="verPubs" class="accent-indigo-600" checked> Puntos de publicación (${(pubs || []).length})</label>
    </div>
    <div id="mapaGeneral" class="mapa !h-[calc(100vh-200px)] min-h-[420px]"></div>`;
  const mapa = crearMapa($('#mapaGeneral'), { centro: [6.5, -74], zoom: 6 });
  if (!mapa) return;
  const color = (f) => { const h = (Date.now() - new Date(f)) / 36e5; return h < 1 ? '#10b981' : h < 24 ? '#fbbf24' : '#94a3b8'; };
  const capaUsuarios = L.featureGroup(conUbic.map((u) => L.circleMarker([u.lat, u.lng], { radius: 8, color: '#fff', weight: 2, fillColor: color(u.ubicacion_at), fillOpacity: 1 })
    .bindPopup(`<b>${esc(u.nombre || 'Sin nombre')}</b><br>📱 ${esc(u.whatsapp || '')}<br>${esc(u.municipio || '')}<br>📍 ${tiempoRelativo(u.ubicacion_at)} (±${Math.round(u.precision_m || 0)} m)<br><a href="#usuarios=${u.id}">Ver usuario ›</a>`))).addTo(mapa);
  const capaZonas = L.featureGroup(conUbic.filter((u) => u.zona_lat != null).map((u) => L.circle([u.zona_lat, u.zona_lng], { radius: u.zona_radio || 1000, color: '#4f46e5', weight: 1, fillOpacity: 0.08 })));
  const capaPubs = L.featureGroup((pubs || []).map((p) => L.circleMarker([p.lat, p.lng], { radius: 5, color: p.entidad === 'anuncio' ? '#e11d48' : '#059669', weight: 1, fillOpacity: 0.7 })
    .bindPopup(`${p.entidad === 'anuncio' ? '🛍️ Oferta' : '🙋 Solicitud'} · ${fechaHora(p.created_at)}<br><a href="#" data-pub="${p.entidad}:${p.entidad_id}">Ver publicación ›</a>`))).addTo(mapa);
  if (conUbic.length) mapa.fitBounds(capaUsuarios.getBounds(), { padding: [40, 40], maxZoom: 13 });
  $('#verZonas').onchange = (e) => (e.target.checked ? capaZonas.addTo(mapa) : capaZonas.remove());
  $('#verPubs').onchange = (e) => (e.target.checked ? capaPubs.addTo(mapa) : capaPubs.remove());
  mapa.on('popupopen', (ev) => {
    const a = ev.popup.getElement().querySelector('[data-pub]');
    if (a) a.onclick = (e) => { e.preventDefault(); const [ent, id] = a.dataset.pub.split(':'); ent === 'anuncio' ? verAnuncio(id) : verSolicitud(id); };
  });
}

// ======================================================================
// SOPORTE
// ======================================================================
async function secSoporte(ticketId) {
  const f = A.filtros.soporte;
  let q = db.from('tickets').select('*').order('updated_at', { ascending: false }).limit(200);
  if (f.filtro === 'sin_leer') q = q.eq('no_leido_admin', true).neq('estado', 'cerrado');
  else if (f.filtro === 'abiertos') q = q.not('estado', 'in', '(resuelto,cerrado)');
  else if (f.filtro === 'resueltos') q = q.in('estado', ['resuelto', 'cerrado']);
  const { data, error } = await q;
  if (error) throw error;
  let lista = data || [];
  await perfilesDe(lista.map((t) => t.user_id));
  if (f.q) {
    const t = f.q.toLowerCase();
    lista = lista.filter((x) => [x.asunto, x.descripcion, x.contacto, x.nombre_contacto, A.perfiles.get(x.user_id)?.nombre, A.perfiles.get(x.user_id)?.whatsapp, String(x.numero)].some((v) => (v || '').toLowerCase().includes(t)));
  }
  const prio = { urgente: 'text-rose-600', alta: 'text-amber-600', normal: 'text-slate-400', baja: 'text-slate-300' };
  contenido.innerHTML = `
    <div class="tarjeta overflow-hidden grid lg:grid-cols-[380px_1fr] h-[calc(100vh-130px)] min-h-[520px]">
      <aside class="${ticketId ? 'hidden lg:flex' : 'flex'} flex-col border-r border-slate-100 min-h-0">
        <div class="p-3 border-b border-slate-100 space-y-2">
          ${tabs([['sin_leer', 'Sin leer'], ['abiertos', 'Abiertos'], ['resueltos', 'Resueltos'], ['todos', 'Todos']], f.filtro, 'fsop')}
          <input id="fBuscar" type="search" class="campo !py-2 text-sm" placeholder="Buscar ticket, usuario, número…" value="${esc(f.q)}">
        </div>
        <div class="overflow-y-auto grow divide-y divide-slate-50">${lista.map((t) => {
          const u = A.perfiles.get(t.user_id);
          return `<a href="#soporte=${t.id}" class="block p-3 hover:bg-slate-50 ${A.ticketAbierto === t.id || ticketId === t.id ? 'bg-indigo-50/70' : ''}">
            <div class="flex items-center gap-2">
              ${t.no_leido_admin ? '<span class="w-2 h-2 rounded-full bg-indigo-600 shrink-0"></span>' : ''}
              <span class="text-[11px] text-slate-400">#${t.numero}</span>
              <span class="text-[11px] font-bold ${prio[t.prioridad]}">${t.prioridad !== 'normal' ? t.prioridad.toUpperCase() : ''}</span>
              <span class="ml-auto text-[10px] text-slate-400">${tiempoRelativo(t.updated_at)}</span>
            </div>
            <p class="text-sm ${t.no_leido_admin ? 'font-bold' : 'font-medium'} truncate mt-0.5">${esc(t.asunto)}</p>
            <div class="flex items-center justify-between gap-2 mt-1"><p class="text-xs text-slate-500 truncate">${u ? esc(u.nombre || u.whatsapp) : `👤 ${esc(t.nombre_contacto || '')} (sin cuenta)`}</p>${badge(ESTADOS_TICKET[t.estado])}</div>
          </a>`;
        }).join('') || '<p class="p-8 text-center text-sm text-slate-400">No hay tickets</p>'}</div>
      </aside>
      <section id="panelTicket" class="${ticketId ? 'flex' : 'hidden lg:flex'} flex-col min-h-0 bg-slate-50">
        <div class="grow grid place-items-center text-slate-400 text-sm">Selecciona un ticket</div>
      </section>
    </div>`;
  $$('button[data-fsop]', contenido).forEach((b) => (b.onclick = () => { f.filtro = b.dataset.fsop; secSoporte(A.ticketAbierto); }));
  $('#fBuscar').oninput = debounce((e) => { f.q = e.target.value; secSoporte(ticketId).then(() => { const i = $('#fBuscar'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300);
  if (ticketId) await abrirTicket(ticketId);
}

async function abrirTicket(id) {
  A.ticketAbierto = id;
  const panel = $('#panelTicket');
  const [{ data: t }, { data: msjs }] = await Promise.all([
    db.from('tickets').select('*').eq('id', id).single(),
    db.from('tickets_mensajes').select('*').eq('ticket_id', id).order('created_at'),
  ]);
  if (!t) { panel.innerHTML = '<p class="p-8">Ticket no encontrado</p>'; return; }
  if (t.no_leido_admin) { db.from('tickets').update({ no_leido_admin: false }).eq('id', id).then(() => actualizarPendientes()); }
  await perfilesDe([t.user_id]);
  const u = A.perfiles.get(t.user_id);
  let cuentaAnon = null;
  if (!u && t.contacto) {
    const { data } = await db.from('perfiles').select('*').eq('whatsapp', t.contacto).maybeSingle();
    cuentaAnon = data;
  }
  panel.innerHTML = `
    <header class="bg-white border-b border-slate-100 p-4 shrink-0 space-y-3">
      <div class="flex items-start gap-3">
        <a href="#soporte" class="lg:hidden w-8 h-8 grid place-items-center rounded-full hover:bg-slate-100">‹</a>
        <div class="grow min-w-0">
          <p class="text-xs text-slate-400">#${t.numero} · ${CATEGORIAS_TICKET[t.categoria] || t.categoria} · ${fechaHora(t.created_at)}</p>
          <h2 class="font-extrabold text-lg leading-tight">${esc(t.asunto)}</h2>
          <p class="text-sm text-slate-600 mt-1">${u
            ? `<button data-a="ver-usuario" data-id="${u.id}" class="font-semibold text-indigo-600 hover:underline">${esc(u.nombre || 'Usuario')}</button> · 📱 <a class="underline" target="_blank" href="${waLink(u.whatsapp)}">${esc(u.whatsapp || '')}</a>`
            : `👤 ${esc(t.nombre_contacto || 'Sin nombre')} · 📱 <a class="underline" target="_blank" href="${waLink(t.contacto)}">${esc(t.contacto || '')}</a> · <span class="text-amber-700">sin sesión</span>`}</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        <select data-campo-ticket="estado" class="campo !w-auto !py-1.5 text-xs">${Object.entries(ESTADOS_TICKET).map(([k, [v]]) => `<option value="${k}" ${t.estado === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select data-campo-ticket="prioridad" class="campo !w-auto !py-1.5 text-xs">${['baja', 'normal', 'alta', 'urgente'].map((p) => `<option value="${p}" ${t.prioridad === p ? 'selected' : ''}>Prioridad ${p}</option>`).join('')}</select>
        ${t.referencia ? `<a href="${esc(/^https?:/.test(t.referencia) ? t.referencia : '#')}" target="_blank" class="text-xs text-indigo-600 underline truncate max-w-[220px]">🔗 ${esc(t.referencia)}</a>` : ''}
        ${!u ? (cuentaAnon
          ? `<button data-a="u-reset-pin" data-id="${cuentaAnon.id}" data-tel="${esc(cuentaAnon.whatsapp)}" class="btn btn-oscuro !py-1.5 text-xs ml-auto">🔑 Restablecer PIN de ${esc(cuentaAnon.nombre || cuentaAnon.whatsapp)}</button>`
          : '<span class="text-xs text-rose-600 ml-auto">No existe cuenta con ese número</span>') : ''}
      </div>
    </header>
    <div id="hiloAdmin" class="grow overflow-y-auto p-4 space-y-3">
      ${burbujaAdmin({ es_admin: false, texto: t.descripcion, created_at: t.created_at })}
      ${(msjs || []).map(burbujaAdmin).join('')}
    </div>
    <form id="fResp" class="bg-white border-t border-slate-100 p-3 space-y-2 shrink-0">
      <div class="flex flex-wrap gap-1.5">
        ${PLANTILLAS.map(([n], i) => `<button type="button" data-plantilla="${i}" class="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 hover:bg-slate-50">${n}</button>`).join('')}
        <button type="button" id="btnSugerir" class="text-[11px] px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100">✨ Sugerir con IA</button>
      </div>
      <div class="flex gap-2 items-end">
        <textarea name="texto" rows="3" class="campo resize-none" placeholder="${t.user_id ? 'Escribe tu respuesta… (el usuario recibirá una notificación)' : 'Este usuario no tiene sesión: contáctalo por WhatsApp. Puedes dejar notas internas aquí.'}"></textarea>
        <div class="flex flex-col gap-1.5 shrink-0">
          <button class="btn btn-primario">Enviar</button>
          <button type="button" data-a="responder-resolver" class="btn btn-suave text-xs">Enviar y resolver</button>
        </div>
      </div>
    </form>`;
  const hilo = $('#hiloAdmin');
  hilo.scrollTop = hilo.scrollHeight;
  $$('[data-campo-ticket]', panel).forEach((s) => (s.onchange = async () => {
    const { error } = await db.from('tickets').update({ [s.dataset.campoTicket]: s.value }).eq('id', id);
    if (error) return toast(errorMsg(error), 'error');
    registrar(`ticket_${s.dataset.campoTicket}`, 'ticket', id, { valor: s.value });
    toast('Ticket actualizado', 'ok');
  }));
  const f = $('#fResp');
  $$('[data-plantilla]', f).forEach((b) => (b.onclick = () => { const nombre = (u?.nombre || t.nombre_contacto || '').split(' ')[0]; f.texto.value = PLANTILLAS[+b.dataset.plantilla][1].replace('¡Hola!', `¡Hola${nombre ? ' ' + nombre : ''}!`).replace(/^Hola,/, `Hola${nombre ? ' ' + nombre : ''},`); f.texto.focus(); }));
  $('#btnSugerir').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = '⏳ Redactando…';
    try {
      const r = await llamarFuncion(db, 'ia', { accion: 'sugerir_respuesta', ticket_id: id });
      f.texto.value = r.texto;
    } catch (ex) { toast(errorMsg(ex), 'error'); }
    b.disabled = false; b.textContent = '✨ Sugerir con IA';
  };
  const enviar = async (resolver = false) => {
    const texto = f.texto.value.trim();
    if (!texto) return;
    const { data, error } = await db.from('tickets_mensajes').insert({ ticket_id: id, texto, es_admin: true }).select().single();
    if (error) return toast(errorMsg(error), 'error');
    f.reset();
    agregarBurbujaAdmin(data);
    if (resolver) await db.from('tickets').update({ estado: 'resuelto' }).eq('id', id);
    registrar(resolver ? 'ticket_responder_resolver' : 'ticket_responder', 'ticket', id);
    toast(resolver ? 'Respuesta enviada y ticket resuelto' : 'Respuesta enviada', 'ok');
    if (resolver) secSoporte(id);
  };
  f.onsubmit = (e) => { e.preventDefault(); enviar(false); };
  ACC['responder-resolver'] = () => enviar(true);
}

function burbujaAdmin(m) {
  return `<div class="flex ${m.es_admin ? 'justify-end' : 'justify-start'}" ${m.id ? `data-tm="${m.id}"` : ''}>
    <div class="max-w-[80%]"><p class="text-[10px] font-bold mb-1 ${m.es_admin ? 'text-right text-indigo-600' : 'text-slate-400'}">${m.es_admin ? '🛟 Soporte' : '👤 Usuario'} · ${fechaHora(m.created_at)}</p>
    <div class="px-4 py-2.5 text-sm whitespace-pre-wrap break-words shadow-sm ${m.es_admin ? 'burbuja-yo' : 'burbuja-otro'}">${esc(m.texto)}</div></div></div>`;
}

function agregarBurbujaAdmin(m) {
  const hilo = $('#hiloAdmin');
  if (!hilo || $(`[data-tm="${m.id}"]`, hilo)) return;
  hilo.insertAdjacentHTML('beforeend', burbujaAdmin(m));
  hilo.scrollTop = hilo.scrollHeight;
}

// ======================================================================
// REPORTES
// ======================================================================
async function secReportes() {
  const f = A.filtros.reportes;
  const conteos = await contarPorEstado('reportes', ['pendiente', 'revisado', 'descartado']);
  let q = db.from('reportes').select('*').order('created_at', { ascending: false }).limit(200);
  if (f.estado !== 'todos') q = q.eq('estado', f.estado);
  const { data, error } = await q;
  if (error) throw error;
  const lista = data || [];
  await perfilesDe([...lista.map((r) => r.reportante_id), ...lista.filter((r) => r.entidad === 'usuario').map((r) => r.entidad_id)]);
  const titulos = new Map();
  const ids = (ent) => lista.filter((r) => r.entidad === ent).map((r) => r.entidad_id);
  if (ids('anuncio').length) (await db.from('anuncios').select('id, titulo, user_id').in('id', ids('anuncio'))).data?.forEach((a) => titulos.set(a.id, a));
  if (ids('solicitud').length) (await db.from('solicitudes').select('id, titulo, user_id').in('id', ids('solicitud'))).data?.forEach((a) => titulos.set(a.id, a));
  contenido.innerHTML = `
    ${tabs([['pendiente', 'Pendientes', conteos.pendiente], ['revisado', 'Revisados', conteos.revisado], ['descartado', 'Descartados', conteos.descartado], ['todos', 'Todos']], f.estado, 'frep')}
    <div class="grid gap-3 mt-4">${lista.map((r) => {
      const rep = A.perfiles.get(r.reportante_id) || {};
      const obj = titulos.get(r.entidad_id);
      const objetivo = r.entidad === 'usuario' ? `👤 ${esc(A.perfiles.get(r.entidad_id)?.nombre || 'Usuario')}` : r.entidad === 'conversacion' ? '💬 Conversación' : `${r.entidad === 'anuncio' ? '🛍️' : '🙋'} ${esc(obj?.titulo || '(eliminado)')}`;
      const ver = r.entidad === 'usuario' ? `data-a="ver-usuario" data-id="${r.entidad_id}"` : r.entidad === 'anuncio' ? `data-a="ver-anuncio" data-id="${r.entidad_id}"` : r.entidad === 'solicitud' ? `data-a="ver-solicitud" data-id="${r.entidad_id}"` : `data-a="ver-conversacion" data-id="${r.entidad_id}"`;
      const duenio = r.entidad === 'usuario' ? r.entidad_id : obj?.user_id;
      return `<div class="tarjeta p-4 flex flex-col sm:flex-row gap-4">
        <div class="grow min-w-0">
          <div class="flex flex-wrap items-center gap-2">${badge(r.estado === 'pendiente' ? ['Pendiente', 'bg-amber-100 text-amber-800'] : r.estado === 'revisado' ? ['Revisado', 'bg-emerald-100 text-emerald-800'] : ['Descartado', 'bg-slate-100 text-slate-600'])}<b class="text-sm">${esc(r.motivo)}</b><span class="text-xs text-slate-400">${tiempoRelativo(r.created_at)}</span></div>
          <button ${ver} class="text-sm font-semibold text-indigo-600 hover:underline mt-1 text-left">${objetivo}</button>
          ${r.detalle ? `<p class="text-sm text-slate-600 mt-1">"${esc(r.detalle)}"</p>` : ''}
          <p class="text-xs text-slate-400 mt-1">Reportado por <button data-a="ver-usuario" data-id="${r.reportante_id}" class="underline">${esc(rep.nombre || 'usuario')}</button>${r.nota_admin ? ` · Nota: ${esc(r.nota_admin)}` : ''}</p>
        </div>
        <div class="flex sm:flex-col gap-1.5 shrink-0">
          ${r.estado === 'pendiente' ? `<button data-a="rep-revisado" data-id="${r.id}" class="btn btn-verde !py-1.5 text-xs">✓ Revisado</button><button data-a="rep-descartar" data-id="${r.id}" class="btn btn-suave !py-1.5 text-xs">Descartar</button>` : ''}
          ${duenio ? `<button data-a="u-suspender" data-id="${duenio}" class="btn btn-rojo !py-1.5 text-xs">⛔ Suspender autor</button>` : ''}
        </div></div>`;
    }).join('') || '<div class="tarjeta p-10 text-center text-slate-400">No hay reportes aquí 🎉</div>'}</div>`;
  $$('button[data-frep]', contenido).forEach((b) => (b.onclick = () => { f.estado = b.dataset.frep; secReportes(); }));
}

async function resolverReporte(id, estado) {
  const nota = await pedirTexto({ titulo: estado === 'revisado' ? 'Marcar como revisado' : 'Descartar reporte', etiqueta: 'Nota interna (opcional)', requerido: false, opciones: ['Publicación retirada', 'Usuario advertido', 'Usuario suspendido', 'No infringe las normas'] });
  if (nota === null) return;
  const { error } = await db.from('reportes').update({ estado, nota_admin: nota || null, resuelto_at: new Date().toISOString() }).eq('id', id);
  if (error) return toast(errorMsg(error), 'error');
  registrar(`reporte_${estado}`, 'reporte', id, { nota });
  toast('Reporte actualizado', 'ok');
  actualizarPendientes();
  secReportes();
}

// ======================================================================
// CONVERSACIONES
// ======================================================================
async function secConversaciones() {
  const { data, error } = await db.from('conversaciones').select('*').order('ultimo_mensaje_at', { ascending: false }).limit(200);
  if (error) throw error;
  const lista = data || [];
  await perfilesDe(lista.flatMap((c) => [c.usuario_a, c.usuario_b]));
  contenido.innerHTML = `
    <p class="text-sm text-slate-500 mb-3">Las conversaciones son privadas entre usuarios. Ábrelas solo para atender reportes o casos de seguridad; cada consulta queda registrada.</p>
    <div class="tarjeta divide-y divide-slate-50">${lista.map((c) => {
      const a = A.perfiles.get(c.usuario_a) || {}, b = A.perfiles.get(c.usuario_b) || {};
      return `<button data-a="ver-conversacion" data-id="${c.id}" class="w-full text-left p-4 hover:bg-slate-50 flex items-center gap-3">
        <div class="flex -space-x-2">${avatar(a, 'w-9 h-9 text-sm ring-2 ring-white')}${avatar(b, 'w-9 h-9 text-sm ring-2 ring-white')}</div>
        <div class="min-w-0 grow"><p class="text-sm font-semibold">${esc(a.nombre || '—')} ↔ ${esc(b.nombre || '—')}</p><p class="text-xs text-slate-500 truncate">${esc(c.ultimo_mensaje || '')}</p></div>
        <span class="text-xs text-slate-400 shrink-0">${tiempoRelativo(c.ultimo_mensaje_at)}</span></button>`;
    }).join('') || '<p class="p-10 text-center text-slate-400">Sin conversaciones</p>'}</div>`;
}

async function verConversacion(id) {
  const [{ data: c }, { data: msjs }] = await Promise.all([
    db.from('conversaciones').select('*').eq('id', id).single(),
    db.from('mensajes').select('*').eq('conversacion_id', id).order('created_at').limit(1000),
  ]);
  if (!c) return toast('Conversación no encontrada', 'error');
  registrar('ver_conversacion', 'conversacion', id);
  await perfilesDe([c.usuario_a, c.usuario_b]);
  const a = A.perfiles.get(c.usuario_a) || {}, b = A.perfiles.get(c.usuario_b) || {};
  const m = modal({
    titulo: `💬 ${esc(a.nombre || '—')} ↔ ${esc(b.nombre || '—')}`, ancho: 'sm:max-w-2xl',
    html: `<div class="space-y-2 bg-slate-50 -m-5 p-5 min-h-[300px]">${(msjs || []).map((x) => {
      const autor = x.emisor_id === c.usuario_a ? a : b;
      if (x.tipo === 'contexto' || x.tipo === 'sistema') return `<p class="text-center text-xs text-slate-500">📌 ${esc(x.texto)}</p>`;
      return `<div class="flex ${x.emisor_id === c.usuario_a ? 'justify-start' : 'justify-end'}"><div class="max-w-[80%]"><p class="text-[10px] text-slate-400 mb-0.5">${esc(autor.nombre || '')} · ${fechaHora(x.created_at)}</p>
        <div class="px-3 py-2 text-sm rounded-2xl ${x.emisor_id === c.usuario_a ? 'bg-white border border-slate-200' : 'bg-indigo-600 text-white'} whitespace-pre-wrap">${esc(x.texto)}</div></div></div>`;
    }).join('') || '<p class="text-center text-slate-400">Sin mensajes</p>'}</div>`,
    pie: `<div class="flex gap-2"><button data-a="ver-usuario" data-id="${c.usuario_a}" class="btn btn-suave text-xs">Ver ${esc(a.nombre || 'usuario A')}</button><button data-a="ver-usuario" data-id="${c.usuario_b}" class="btn btn-suave text-xs">Ver ${esc(b.nombre || 'usuario B')}</button></div>`,
  });
  acciones(m.el);
}

// ======================================================================
// AVISOS
// ======================================================================
async function secAvisos() {
  const { data: cfg } = await db.from('config').select('valor').eq('clave', 'aviso_global').single();
  const deptos = Object.keys(await fetch(new URL('../data/colombia.json', import.meta.url)).then((r) => r.json()).catch(() => ({})));
  contenido.innerHTML = `
    <div class="grid lg:grid-cols-2 gap-5">
      <section class="tarjeta p-5">
        <h2 class="font-bold">🔔 Notificación a usuarios</h2>
        <p class="text-xs text-slate-500 mt-1 mb-4">Llega a la campana de notificaciones de cada usuario (y como notificación del navegador si la tiene activada).</p>
        <form id="fNotif" class="space-y-3">
          <div><label class="etiqueta">Título</label><input name="titulo" required maxlength="120" class="campo" placeholder="Ej. ¡Nueva función disponible!"></div>
          <div><label class="etiqueta">Mensaje</label><textarea name="cuerpo" rows="3" maxlength="500" class="campo resize-none"></textarea></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="etiqueta">Enlace al tocar</label><select name="enlace" class="campo"><option value="">Ninguno</option><option value="#inicio">Inicio</option><option value="#solicitudes">Solicitudes</option><option value="#perfil">Mi perfil</option><option value="#soporte">Soporte</option><option value="#como-funciona">Cómo funciona</option></select></div>
            <div><label class="etiqueta">Destinatarios</label><select name="depto" class="campo"><option value="">Todos los usuarios</option>${deptos.map((d) => `<option>${esc(d)}</option>`).join('')}</select></div>
          </div>
          <button class="btn btn-primario w-full">Enviar notificación</button>
        </form>
      </section>
      <section class="tarjeta p-5">
        <h2 class="font-bold">📢 Aviso en el sitio</h2>
        <p class="text-xs text-slate-500 mt-1 mb-4">Franja visible en la parte superior de OFERTAL para todos los visitantes. Déjalo vacío para ocultarla.</p>
        <form id="fAviso" class="space-y-3">
          <textarea name="aviso" rows="3" maxlength="200" class="campo resize-none" placeholder="Ej. 🎉 Publicar es gratis este mes">${esc(typeof cfg?.valor === 'string' ? cfg.valor : '')}</textarea>
          <div class="flex gap-2"><button class="btn btn-oscuro grow">Guardar aviso</button><button type="button" id="btnQuitarAviso" class="btn btn-suave">Quitar</button></div>
        </form>
      </section>
    </div>`;
  $('#fNotif').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!(await confirmar(`Se enviará a ${f.depto.value ? 'los usuarios de ' + f.depto.value : 'TODOS los usuarios'}.`, { titulo: '¿Enviar notificación?', ok: 'Enviar' }))) return;
    const { data, error } = await db.rpc('admin_notificar_todos', { p_titulo: f.titulo.value.trim(), p_cuerpo: f.cuerpo.value.trim() || null, p_enlace: f.enlace.value || null, p_departamento: f.depto.value || null });
    if (error) return toast(errorMsg(error), 'error');
    f.reset();
    toast(`Notificación enviada a ${data} usuario(s)`, 'ok');
  };
  const guardarAviso = async (texto) => {
    const { error } = await db.from('config').update({ valor: texto, updated_at: new Date().toISOString() }).eq('clave', 'aviso_global');
    if (error) return toast(errorMsg(error), 'error');
    registrar('aviso_global', 'config', 'aviso_global', { texto });
    toast(texto ? 'Aviso publicado' : 'Aviso retirado', 'ok');
  };
  $('#fAviso').onsubmit = (e) => { e.preventDefault(); guardarAviso(e.target.aviso.value.trim()); };
  $('#btnQuitarAviso').onclick = () => { $('#fAviso').aviso.value = ''; guardarAviso(''); };
}

// ======================================================================
// CATEGORÍAS
// ======================================================================
async function secCategorias() {
  const [{ data: cats }, { data: usos }] = await Promise.all([
    db.from('categorias').select('*').order('orden'),
    db.from('anuncios').select('categoria'),
  ]);
  A.categorias = cats || [];
  const n = new Map();
  (usos || []).forEach((a) => n.set(a.categoria, (n.get(a.categoria) || 0) + 1));
  contenido.innerHTML = `
    <form id="fCat" class="tarjeta p-4 flex flex-wrap gap-2 items-end">
      <div class="w-20"><label class="etiqueta">Ícono</label><input name="icono" maxlength="4" class="campo text-center" value="📦"></div>
      <div class="grow min-w-[180px]"><label class="etiqueta">Nombre</label><input name="nombre" required maxlength="40" class="campo"></div>
      <div><label class="etiqueta">Tipo</label><select name="tipo" class="campo"><option value="ambos">Ambos</option><option value="producto">Producto</option><option value="servicio">Servicio</option></select></div>
      <div class="w-24"><label class="etiqueta">Orden</label><input name="orden" type="number" class="campo" value="50"></div>
      <button class="btn btn-primario">＋ Agregar</button>
    </form>
    <div class="tarjeta mt-4 overflow-x-auto"><table class="w-full text-sm">
      <thead class="text-xs text-slate-500 bg-slate-50 text-left"><tr><th class="p-3">Categoría</th><th class="p-3">Tipo</th><th class="p-3">Orden</th><th class="p-3">Ofertas</th><th class="p-3">Activa</th><th class="p-3"></th></tr></thead>
      <tbody class="divide-y divide-slate-50">${A.categorias.map((c) => `<tr class="fila">
        <td class="p-3 font-semibold">${c.icono} ${esc(c.nombre)}</td>
        <td class="p-3"><select data-cat-campo="tipo" data-id="${c.id}" class="campo !py-1 !w-auto text-xs">${['ambos', 'producto', 'servicio'].map((t) => `<option ${t === c.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td class="p-3"><input data-cat-campo="orden" data-id="${c.id}" type="number" value="${c.orden}" class="campo !py-1 !w-20 text-xs"></td>
        <td class="p-3 tabular-nums">${n.get(c.nombre) || 0}</td>
        <td class="p-3"><input data-cat-campo="activa" data-id="${c.id}" type="checkbox" ${c.activa ? 'checked' : ''} class="accent-indigo-600 w-4 h-4"></td>
        <td class="p-3 text-right"><button data-a="borrar-categoria" data-id="${c.id}" data-nombre="${esc(c.nombre)}" class="text-xs text-rose-600 hover:underline">Eliminar</button></td></tr>`).join('')}</tbody></table></div>
    <p class="text-xs text-slate-500 mt-2">Desactivar una categoría la oculta de los formularios, pero conserva las publicaciones existentes.</p>`;
  $('#fCat').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const { error } = await db.from('categorias').insert({ nombre: f.nombre.value.trim(), icono: f.icono.value.trim() || '📦', tipo: f.tipo.value, orden: +f.orden.value || 50 });
    if (error) return toast(errorMsg(error), 'error');
    registrar('categoria_crear', 'categoria', f.nombre.value.trim());
    toast('Categoría creada', 'ok');
    secCategorias();
  };
  $$('[data-cat-campo]', contenido).forEach((el) => (el.onchange = async () => {
    const campo = el.dataset.catCampo;
    const valor = campo === 'activa' ? el.checked : campo === 'orden' ? +el.value : el.value;
    const { error } = await db.from('categorias').update({ [campo]: valor }).eq('id', el.dataset.id);
    if (error) return toast(errorMsg(error), 'error');
    toast('Guardado', 'ok', 1200);
  }));
}

// ======================================================================
// CONFIGURACIÓN
// ======================================================================
async function secConfig() {
  const { data } = await db.from('config').select('*').order('clave');
  const cfg = Object.fromEntries((data || []).map((c) => [c.clave, c]));
  const interruptor = (clave, titulo) => `
    <label class="flex items-start justify-between gap-4 p-4 cursor-pointer">
      <span><b class="text-sm">${titulo}</b><span class="block text-xs text-slate-500 mt-0.5">${esc(cfg[clave]?.descripcion || '')}</span></span>
      <input type="checkbox" data-cfg="${clave}" ${cfg[clave]?.valor === true ? 'checked' : ''} class="accent-indigo-600 w-5 h-5 mt-0.5 shrink-0">
    </label>`;
  const numero = (clave, titulo, min, max, sufijo) => `
    <div class="flex items-center justify-between gap-4 p-4">
      <span><b class="text-sm">${titulo}</b><span class="block text-xs text-slate-500 mt-0.5">${esc(cfg[clave]?.descripcion || '')}</span></span>
      <span class="flex items-center gap-2 shrink-0"><input type="number" data-cfg-num="${clave}" min="${min}" max="${max}" value="${cfg[clave]?.valor ?? ''}" class="campo !w-28 text-right">${sufijo}</span>
    </div>`;
  contenido.innerHTML = `
    <div class="grid lg:grid-cols-2 gap-5">
      <section class="tarjeta divide-y divide-slate-50">
        <h2 class="font-bold p-4">Moderación</h2>
        ${interruptor('auto_aprobar_anuncios', 'Publicar ofertas sin revisión')}
        ${interruptor('auto_aprobar_solicitudes', 'Publicar solicitudes sin revisión')}
        ${interruptor('ia_auto_aprobar', 'Aprobación automática con IA')}
        ${numero('max_publicaciones_dia', 'Límite diario por usuario', 1, 200, 'pub.')}
      </section>
      <section class="tarjeta divide-y divide-slate-50">
        <h2 class="font-bold p-4">Ubicación y privacidad</h2>
        ${interruptor('requerir_ubicacion', 'Exigir ubicación para publicar')}
        ${numero('radio_zona_m', 'Radio de la zona pública', 300, 10000, 'm')}
        <div class="p-4 text-xs text-slate-600 bg-slate-50">
          <b>¿Cómo se protege la ubicación?</b> El usuario envía su posición exacta a una función privada. Los demás solo ven un círculo del radio configurado cuyo centro se desplaza al azar entre el 30 % y el 80 % del radio respecto del punto real. El círculo solo se regenera cuando el usuario sale de él, así que repetir la misma posición no permite promediar para descubrir el punto real.
        </div>
      </section>
    </div>`;
  $$('[data-cfg]', contenido).forEach((el) => (el.onchange = () => guardarConfig(el.dataset.cfg, el.checked)));
  $$('[data-cfg-num]', contenido).forEach((el) => (el.onchange = () => {
    const v = Math.max(+el.min, Math.min(+el.max, parseInt(el.value, 10) || +el.min));
    el.value = v;
    guardarConfig(el.dataset.cfgNum, v);
  }));
}

async function guardarConfig(clave, valor) {
  const { error } = await db.from('config').update({ valor, updated_at: new Date().toISOString() }).eq('clave', clave);
  if (error) return toast(errorMsg(error), 'error');
  registrar('config', 'config', clave, { valor });
  toast('Configuración guardada', 'ok', 1500);
}

// ======================================================================
// ACTIVIDAD
// ======================================================================
async function secActividad() {
  const { data } = await db.from('admin_log').select('*').order('created_at', { ascending: false }).limit(300);
  await perfilesDe((data || []).map((l) => l.admin_id));
  contenido.innerHTML = `<div class="tarjeta overflow-x-auto"><table class="w-full text-sm min-w-[700px]">
    <thead class="text-xs text-slate-500 bg-slate-50 text-left"><tr><th class="p-3">Fecha</th><th class="p-3">Quién</th><th class="p-3">Acción</th><th class="p-3">Elemento</th><th class="p-3">Detalle</th></tr></thead>
    <tbody class="divide-y divide-slate-50">${(data || []).map((l) => `<tr class="fila">
      <td class="p-3 text-xs whitespace-nowrap">${fechaHora(l.created_at)}</td>
      <td class="p-3 text-xs">${l.admin_id ? esc(A.perfiles.get(l.admin_id)?.nombre || 'Admin') : '🤖 Sistema / IA'}</td>
      <td class="p-3"><code class="text-xs bg-slate-100 rounded px-1.5 py-0.5">${esc(l.accion)}</code></td>
      <td class="p-3 text-xs">${esc(l.entidad || '')} ${l.entidad === 'anuncio' ? `<button data-a="ver-anuncio" data-id="${esc(l.entidad_id)}" class="text-indigo-600 underline">ver</button>` : l.entidad === 'usuario' ? `<button data-a="ver-usuario" data-id="${esc(l.entidad_id)}" class="text-indigo-600 underline">ver</button>` : l.entidad === 'solicitud' ? `<button data-a="ver-solicitud" data-id="${esc(l.entidad_id)}" class="text-indigo-600 underline">ver</button>` : ''}</td>
      <td class="p-3 text-xs text-slate-500 max-w-xs truncate">${esc(l.detalle ? Object.entries(l.detalle).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '')}</td></tr>`).join('') || '<tr><td colspan="5" class="p-10 text-center text-slate-400">Sin actividad registrada</td></tr>'}</tbody></table></div>`;
}

// ======================================================================
// MI CUENTA
// ======================================================================
async function secCuenta() {
  const esCorreo = !/^3\d{9}@ofertal\.com$/.test(A.user.email || '');
  const { data: admins } = await db.from('perfiles').select('id, nombre, whatsapp').eq('rol', 'admin');
  contenido.innerHTML = `
    <div class="grid lg:grid-cols-2 gap-5">
      <section class="tarjeta p-5">
        <h2 class="font-bold">🔐 Cambiar contraseña</h2>
        <p class="text-xs text-slate-500 mt-1 mb-4">Cuenta: <b>${esc(A.user.email)}</b></p>
        ${esCorreo ? `<form id="fPass" class="space-y-3">
          <input name="p1" type="password" minlength="10" required class="campo" placeholder="Nueva contraseña (mín. 10 caracteres)" autocomplete="new-password">
          <input name="p2" type="password" minlength="10" required class="campo" placeholder="Repetir contraseña" autocomplete="new-password">
          <button class="btn btn-oscuro w-full">Cambiar contraseña</button></form>`
        : '<p class="text-sm text-slate-600">Esta cuenta ingresa con WhatsApp + PIN. Cambia el PIN desde «Mi perfil» en el sitio.</p>'}
      </section>
      <section class="tarjeta p-5">
        <h2 class="font-bold">🛡️ Administradores</h2>
        <div class="mt-3 divide-y divide-slate-50">${(admins || []).map((a) => `<button data-a="ver-usuario" data-id="${a.id}" class="w-full text-left py-2 flex justify-between text-sm hover:text-indigo-600"><span>${esc(a.nombre || '—')}</span><span class="text-slate-400">${esc(a.whatsapp || '')}</span></button>`).join('')}</div>
        <p class="text-xs text-slate-500 mt-3">Para agregar otro administrador abre su ficha en <a href="#usuarios" class="underline">Usuarios</a> y usa «Hacer administrador».</p>
      </section>
    </div>`;
  const f = $('#fPass');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    if (f.p1.value !== f.p2.value) return toast('Las contraseñas no coinciden', 'aviso');
    try {
      await llamarFuncion(db, 'admin', { accion: 'cambiar_password', password: f.p1.value });
      f.reset();
      toast('Contraseña actualizada', 'ok');
    } catch (ex) { toast(errorMsg(ex), 'error'); }
  };
}

// ======================================================================
// ACCIONES
// ======================================================================
const refrescar = () => { actualizarPendientes(); if (!['soporte'].includes(A.seccion)) irSeccionSilenciosa(); };
async function irSeccionSilenciosa() {
  const { valor } = leerHash();
  const pos = window.scrollY;
  await SECCION_FN[A.seccion](A.seccion === 'usuarios' ? null : valor);
  window.scrollTo({ top: pos });
}

async function pedirMotivo(titulo) {
  return pedirTexto({ titulo, etiqueta: 'Motivo (lo verá el usuario)', opciones: MOTIVOS_RECHAZO, placeholder: 'Explica qué debe corregir…' });
}

const ACC = {
  'ver-anuncio': (d) => verAnuncio(d.id),
  'ver-solicitud': (d) => verSolicitud(d.id),
  'ver-usuario': (d) => verUsuario(d.id),
  'ver-conversacion': (d) => verConversacion(d.id),
  'aprobar-anuncio': async (d) => {
    try { await cambiarEstadoAnuncio(d.id, 'aprobado'); toast('Oferta aprobada ✓ Se notificó al usuario', 'ok'); cerrarTodosLosModales(); refrescar(); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'rechazar-anuncio': async (d) => {
    const motivo = await pedirMotivo('Rechazar oferta');
    if (!motivo) return;
    try { await cambiarEstadoAnuncio(d.id, 'rechazado', motivo); toast('Oferta rechazada', 'ok'); cerrarTodosLosModales(); refrescar(); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'pausar-anuncio': async (d) => {
    try { await cambiarEstadoAnuncio(d.id, 'pausado'); toast('Oferta pausada', 'ok'); cerrarTodosLosModales(); refrescar(); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'destacar-anuncio': async (d) => {
    const { error } = await db.from('anuncios').update({ destacado: d.valor === '1' }).eq('id', d.id);
    if (error) return toast(errorMsg(error), 'error');
    registrar(d.valor === '1' ? 'anuncio_destacar' : 'anuncio_quitar_destacado', 'anuncio', d.id);
    toast(d.valor === '1' ? 'Oferta destacada ⭐' : 'Destacado retirado', 'ok');
    cerrarTodosLosModales(); refrescar();
  },
  'eliminar-anuncio': async (d) => {
    if (!(await confirmar('Se eliminará definitivamente la oferta.', { titulo: '¿Eliminar oferta?', ok: 'Eliminar', peligro: true }))) return;
    const { data: a } = await db.from('anuncios').select('titulo, user_id').eq('id', d.id).single();
    const { error } = await db.from('anuncios').delete().eq('id', d.id);
    if (error) return toast(errorMsg(error), 'error');
    registrar('anuncio_eliminar', 'anuncio', d.id, { titulo: a?.titulo });
    if (a) db.rpc('admin_notificar', { p_user: a.user_id, p_titulo: 'Una de tus publicaciones fue eliminada', p_cuerpo: `"${a.titulo}" no cumplía las normas de OFERTAL. Escríbenos si tienes dudas.`, p_enlace: '#soporte' });
    toast('Oferta eliminada', 'ok'); cerrarTodosLosModales(); refrescar();
  },
  'ia-anuncio': async (d, b) => {
    b.textContent = '⏳ Analizando…';
    try { await llamarFuncion(db, 'ia', { accion: 'moderar', entidad: 'anuncio', id: d.id }); cerrarTodosLosModales(); verAnuncio(d.id); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'ia-solicitud': async (d, b) => {
    b.textContent = '⏳ Analizando…';
    try { await llamarFuncion(db, 'ia', { accion: 'moderar', entidad: 'solicitud', id: d.id }); cerrarTodosLosModales(); verSolicitud(d.id); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'masivo-anuncios': async (d) => {
    const ids = [...A.seleccion];
    let motivo = null;
    if (d.estado === 'rechazado') { motivo = await pedirMotivo(`Rechazar ${ids.length} oferta(s)`); if (!motivo) return; }
    else if (!(await confirmar(`Se aprobarán ${ids.length} oferta(s) y se notificará a sus autores.`, { titulo: 'Aprobar seleccionadas', ok: 'Aprobar' }))) return;
    let ok = 0;
    for (const id of ids) { try { await cambiarEstadoAnuncio(id, d.estado, motivo); ok++; } catch { /* sigue */ } }
    toast(`${ok} de ${ids.length} actualizada(s)`, 'ok');
    A.seleccion.clear(); refrescar();
  },
  'masivo-ia': async () => {
    const ids = [...A.seleccion];
    toast(`Analizando ${ids.length} oferta(s) con IA…`);
    for (const id of ids) await llamarFuncion(db, 'ia', { accion: 'moderar', entidad: 'anuncio', id }).catch(() => {});
    toast('Análisis terminado', 'ok');
    A.seleccion.clear(); refrescar();
  },
  'aprobar-solicitud': async (d) => {
    try { await cambiarEstadoSolicitud(d.id, 'abierta'); toast('Solicitud publicada ✓ Se notificó al usuario y a los proveedores', 'ok'); cerrarTodosLosModales(); refrescar(); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'rechazar-solicitud': async (d) => {
    const motivo = await pedirMotivo('Rechazar solicitud');
    if (!motivo) return;
    try { await cambiarEstadoSolicitud(d.id, 'rechazada', motivo); toast('Solicitud rechazada', 'ok'); cerrarTodosLosModales(); refrescar(); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'cerrar-solicitud': async (d) => {
    try { await cambiarEstadoSolicitud(d.id, 'cerrada'); toast('Solicitud cerrada', 'ok'); cerrarTodosLosModales(); refrescar(); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'eliminar-solicitud': async (d) => {
    if (!(await confirmar('Se eliminarán la solicitud y sus propuestas.', { titulo: '¿Eliminar solicitud?', ok: 'Eliminar', peligro: true }))) return;
    const { error } = await db.from('solicitudes').delete().eq('id', d.id);
    if (error) return toast(errorMsg(error), 'error');
    registrar('solicitud_eliminar', 'solicitud', d.id);
    toast('Solicitud eliminada', 'ok'); cerrarTodosLosModales(); refrescar();
  },
  'masivo-solicitudes': async (d) => {
    const ids = [...A.seleccion];
    let motivo = null;
    if (d.estado === 'rechazada') { motivo = await pedirMotivo(`Rechazar ${ids.length} solicitud(es)`); if (!motivo) return; }
    let ok = 0;
    for (const id of ids) { try { await cambiarEstadoSolicitud(id, d.estado, motivo); ok++; } catch { /* sigue */ } }
    toast(`${ok} de ${ids.length} actualizada(s)`, 'ok');
    A.seleccion.clear(); refrescar();
  },
  'u-verificar': async (d) => {
    try { await actualizarPerfil(d.id, { verificado: d.valor === '1' }, d.valor === '1' ? 'usuario_verificar' : 'usuario_quitar_verificacion'); toast('Actualizado', 'ok'); cerrarTodosLosModales(); verUsuario(d.id); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'u-suspender': async (d) => {
    const motivo = await pedirTexto({ titulo: 'Suspender usuario', etiqueta: 'Motivo (lo verá el usuario)', opciones: ['Sospecha de fraude', 'Publicaciones prohibidas reiteradas', 'Suplantación de identidad', 'Acoso a otros usuarios', 'Incumplimiento de normas'] });
    if (!motivo) return;
    try {
      await actualizarPerfil(d.id, { estado: 'suspendido', motivo_suspension: motivo }, 'usuario_suspender', { motivo });
      await db.rpc('admin_notificar', { p_user: d.id, p_titulo: 'Tu cuenta fue suspendida', p_cuerpo: motivo, p_enlace: '#soporte' });
      toast('Usuario suspendido. Sus publicaciones quedaron ocultas.', 'ok');
      cerrarTodosLosModales(); refrescar();
    } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'u-activar': async (d) => {
    try {
      await actualizarPerfil(d.id, { estado: 'activo', motivo_suspension: null }, 'usuario_reactivar');
      await db.rpc('admin_notificar', { p_user: d.id, p_titulo: 'Tu cuenta fue reactivada ✅', p_cuerpo: 'Ya puedes volver a publicar en OFERTAL.', p_enlace: '#inicio' });
      toast('Usuario reactivado', 'ok'); cerrarTodosLosModales(); verUsuario(d.id);
    } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'u-rol': async (d) => {
    const hacerAdmin = d.valor === 'admin';
    if (!(await confirmar(hacerAdmin ? 'Tendrá acceso completo a este panel, incluidas las ubicaciones exactas.' : 'Perderá el acceso al panel.', { titulo: hacerAdmin ? '¿Hacer administrador?' : '¿Quitar rol de administrador?', ok: 'Confirmar', peligro: hacerAdmin }))) return;
    try { await actualizarPerfil(d.id, { rol: d.valor }, 'usuario_rol', { rol: d.valor }); toast('Rol actualizado', 'ok'); cerrarTodosLosModales(); verUsuario(d.id); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'u-notificar': async (d) => {
    const titulo = await pedirTexto({ titulo: 'Enviar notificación', etiqueta: 'Mensaje para el usuario', multilinea: true });
    if (!titulo) return;
    const { error } = await db.rpc('admin_notificar', { p_user: d.id, p_titulo: '📢 Mensaje del equipo OFERTAL', p_cuerpo: titulo, p_enlace: '#notificaciones' });
    if (error) return toast(errorMsg(error), 'error');
    toast('Notificación enviada', 'ok');
  },
  'u-reset-pin': async (d) => {
    const sugerido = String(Math.floor(1000 + Math.random() * 9000));
    const pin = await pedirTexto({ titulo: '🔑 Restablecer PIN', etiqueta: 'Nuevo PIN de 4 dígitos (verifica antes la identidad del usuario)', valor: sugerido, multilinea: false, ok: 'Restablecer' });
    if (!pin) return;
    if (!/^\d{4}$/.test(pin)) return toast('El PIN debe tener 4 dígitos', 'aviso');
    try {
      await llamarFuncion(db, 'admin', { accion: 'reset_pin', user_id: d.id, pin });
      const texto = `Hola, somos el equipo de OFERTAL. Restablecimos el PIN de tu cuenta. Tu nuevo PIN es: ${pin}. Ingresa con tu número de WhatsApp y cámbialo en "Mi perfil".`;
      modal({ titulo: 'PIN restablecido', ancho: 'sm:max-w-sm', html: `<div class="space-y-3 text-center"><p class="text-sm text-slate-600">Nuevo PIN:</p><p class="text-4xl font-black tracking-[0.4em]">${pin}</p>
        <p class="text-xs text-slate-500">Envíaselo al usuario por un canal verificado.</p>
        ${d.tel ? `<a href="${waLink(d.tel, texto)}" target="_blank" class="btn btn-verde w-full">Enviar por WhatsApp</a>` : ''}
        <button data-cerrar class="btn btn-suave w-full">Listo</button></div>` });
    } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'u-eliminar': async (d) => {
    const conf = await pedirTexto({ titulo: '⚠️ Eliminar cuenta', etiqueta: 'Se borrarán la cuenta, sus publicaciones, mensajes e historial. Escribe ELIMINAR para confirmar.', multilinea: false, ok: 'Eliminar definitivamente' });
    if (conf !== 'ELIMINAR') return conf !== null && toast('Confirmación incorrecta', 'aviso');
    try { await llamarFuncion(db, 'admin', { accion: 'eliminar_usuario', user_id: d.id }); A.perfiles.delete(d.id); toast('Cuenta eliminada', 'ok'); cerrarTodosLosModales(); refrescar(); } catch (e) { toast(errorMsg(e), 'error'); }
  },
  'borrar-resena': async (d) => {
    if (!(await confirmar('Se eliminará la reseña.', { ok: 'Eliminar', peligro: true }))) return;
    await db.from('resenas').delete().eq('id', d.id);
    registrar('resena_eliminar', 'resena', d.id);
    toast('Reseña eliminada', 'ok');
    cerrarTodosLosModales();
  },
  'rep-revisado': (d) => resolverReporte(d.id, 'revisado'),
  'rep-descartar': (d) => resolverReporte(d.id, 'descartado'),
  'borrar-categoria': async (d) => {
    if (!(await confirmar(`Se eliminará "${d.nombre}". Las publicaciones conservarán el nombre, pero ya no aparecerá en los filtros.`, { ok: 'Eliminar', peligro: true }))) return;
    const { error } = await db.from('categorias').delete().eq('id', d.id);
    if (error) return toast(errorMsg(error), 'error');
    registrar('categoria_eliminar', 'categoria', d.nombre);
    secCategorias();
  },
};

acciones(contenido);

const SECCION_FN = {
  resumen: secResumen,
  ofertas: secOfertas,
  solicitudes: secSolicitudes,
  usuarios: secUsuarios,
  mapa: secMapa,
  soporte: secSoporte,
  reportes: secReportes,
  conversaciones: secConversaciones,
  avisos: secAvisos,
  categorias: secCategorias,
  config: secConfig,
  actividad: secActividad,
  cuenta: secCuenta,
};

// Pestañas de estado (ofertas/solicitudes) usan data-estado: se enlazan en cada sección.
contenido.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-estado]:not([data-a])');
  if (!b) return;
  if (A.seccion === 'ofertas') { A.filtros.ofertas.estado = b.dataset.estado; secOfertas(); }
  if (A.seccion === 'solicitudes') { A.filtros.solicitudes.estado = b.dataset.estado; secSolicitudes(); }
});

// ======================================================================
// TIEMPO REAL
// ======================================================================
function iniciarRealtime() {
  detenerRealtime();
  const avisar = debounce(() => { actualizarPendientes(); if (A.seccion === 'resumen') irSeccionSilenciosa(); }, 800);
  A.canal = db.channel('admin-panel')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'anuncios' }, ({ new: a }) => {
      if (a.estado === 'pendiente') toast(`🛍️ Nueva oferta por revisar: ${a.titulo}`, 'aviso', 5000);
      avisar();
      if (A.seccion === 'ofertas') irSeccionSilenciosa();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'anuncios' }, () => avisar())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'solicitudes' }, ({ new: s }) => {
      toast(`🙋 Nueva solicitud: ${s.titulo}`, 'aviso', 5000);
      avisar();
      if (A.seccion === 'solicitudes') irSeccionSilenciosa();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, ({ new: t }) => {
      toast(`🛟 Nuevo ticket #${t.numero}: ${t.asunto}`, 'aviso', 6000);
      avisar();
      if (A.seccion === 'soporte') secSoporte(A.ticketAbierto);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets_mensajes' }, ({ new: m }) => {
      if (A.ticketAbierto === m.ticket_id) {
        agregarBurbujaAdmin(m);
        if (!m.es_admin) db.from('tickets').update({ no_leido_admin: false }).eq('id', m.ticket_id);
      } else if (!m.es_admin) toast('🛟 Nueva respuesta en un ticket', 'aviso');
      avisar();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reportes' }, ({ new: r }) => {
      toast(`⚑ Nuevo reporte: ${r.motivo}`, 'aviso', 6000);
      avisar();
      if (A.seccion === 'reportes') secReportes();
    })
    .subscribe((estado) => $('#enVivo').classList.toggle('hidden', estado !== 'SUBSCRIBED'));
}

function detenerRealtime() {
  if (A.canal) db.removeChannel(A.canal);
  A.canal = null;
}

iniciar();
