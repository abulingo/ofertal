// OFERTAL · aplicación principal (index.html)
import {
  crearCliente, esc, fmtNum, precioTexto, fmtCOP, tiempoRelativo, fechaHora, mascaraPrecio, leerPrecio,
  parseImagenes, errorMsg, codigoError, distanciaKm, textoDistancia, toast, modal, cerrarTodosLosModales,
  confirmar, pedirTexto, llenarSelectDepartamentos, subirImagen, mapaZona, llamarFuncion, debounce,
  estrellas, avatar, badge, ESTADOS_ANUNCIO, ESTADOS_SOLICITUD, ESTADOS_TICKET, CATEGORIAS_TICKET, URGENCIAS,
  PIN_SALT, COLS_ANUNCIO_PUBLICO,
} from './common.js';

const db = crearCliente();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const PAGINA = 24;
const COLS_ANUNCIO_SESION = COLS_ANUNCIO_PUBLICO + ',contacto';

// ======================================================================
// ESTADO
// ======================================================================
const S = {
  user: null,
  perfil: null,
  inicializado: false,
  config: {},
  categorias: [],
  vista: null,
  hashVista: '#inicio',
  filtros: { tipo: 'todos', categoria: '', departamento: '', q: '', distancia: 0, orden: 'recientes' },
  filtrosSol: { categoria: '', departamento: '', paraMi: false, distancia: 0 },
  anuncios: [],
  pagina: 0,
  hayMas: false,
  perfiles: new Map(),
  favoritos: new Set(),
  miUbic: null,               // ubicación exacta: SOLO se usa en este navegador y se envía a la RPC privada
  permisoUbic: 'prompt',
  noLeidasNotif: 0,
  noLeidosChat: new Map(),
  canal: null,
  chatAbierto: null,
  ticketAbierto: null,
  misCategorias: null,
};

// ======================================================================
// ARRANQUE
// ======================================================================
async function cargarBase() {
  const [cfg, cats] = await Promise.all([
    db.from('config').select('clave, valor'),
    db.from('categorias').select('*').eq('activa', true).order('orden'),
  ]);
  (cfg.data || []).forEach((c) => (S.config[c.clave] = c.valor));
  S.categorias = cats.data || [];
  const aviso = String(S.config.aviso_global || '').trim();
  if (aviso) {
    const el = $('#avisoGlobal');
    el.textContent = aviso;
    el.classList.remove('hidden');
  }
}

async function init() {
  $('#anio').textContent = new Date().getFullYear();
  await cargarBase();
  db.auth.onAuthStateChange((evento, session) => {
    // Supabase recomienda no hacer llamadas dentro del callback directamente
    setTimeout(() => aplicarSesion(session, evento), 0);
  });
  window.addEventListener('hashchange', router);
  configurarBuscador();
  configurarNavInferior();
}

async function aplicarSesion(session, evento) {
  const nuevoId = session?.user?.id || null;
  if (S.inicializado && nuevoId === (S.user?.id || null) && evento !== 'USER_UPDATED') return;
  S.user = session?.user || null;
  S.perfil = null;
  S.favoritos = new Set();
  S.noLeidosChat = new Map();
  S.noLeidasNotif = 0;
  S.misCategorias = null;
  detenerRealtime();

  if (S.user) {
    const { data } = await db.from('perfiles').select('*').eq('id', S.user.id).maybeSingle();
    S.perfil = data || { id: S.user.id, nombre: S.user.user_metadata?.primer_nombre };
    cargarFavoritos();
    iniciarRealtime();
    contarPendientes();
    db.rpc('registrar_conexion');
    gestionarUbicacionAlIngresar();
  } else {
    detenerSeguimiento();
  }
  renderNav();
  renderBanners();
  const primeraVez = !S.inicializado;
  S.inicializado = true;
  if (primeraVez || evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') router();
}

// ======================================================================
// NAVEGACIÓN
// ======================================================================
const VISTAS = {
  inicio: vistaInicio,
  solicitudes: vistaSolicitudes,
  'mis-publicaciones': vistaMisPublicaciones,
  'mis-solicitudes': vistaMisSolicitudes,
  favoritos: vistaFavoritos,
  mensajes: vistaMensajes,
  chat: vistaMensajes,
  notificaciones: vistaNotificaciones,
  perfil: vistaPerfil,
  usuario: vistaUsuario,
  soporte: vistaSoporte,
  ticket: vistaTicket,
  'como-funciona': vistaComoFunciona,
};
const REQUIERE_SESION = new Set(['mis-publicaciones', 'mis-solicitudes', 'favoritos', 'mensajes', 'chat', 'notificaciones', 'perfil', 'ticket']);
const RUTAS_MODAL = { anuncio: abrirAnuncio, solicitud: abrirSolicitud };

function leerHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const i = h.indexOf('=');
  return i === -1 ? { ruta: h || 'inicio', valor: null } : { ruta: h.slice(0, i), valor: h.slice(i + 1) };
}

async function router() {
  const { ruta, valor } = leerHash();
  if (RUTAS_MODAL[ruta]) {
    if (!S.vista) await mostrarVista('inicio');
    RUTAS_MODAL[ruta](valor);
    return;
  }
  cerrarTodosLosModales();
  if (REQUIERE_SESION.has(ruta) && !S.user) {
    await mostrarVista('inicio');
    abrirAuth('login');
    return;
  }
  await mostrarVista(VISTAS[ruta] ? ruta : 'inicio', valor);
}

async function mostrarVista(ruta, valor = null) {
  const cambio = S.vista !== ruta;
  S.vista = ruta;
  S.hashVista = location.hash && !location.hash.match(/^#(anuncio|solicitud)=/) ? location.hash : '#' + ruta;
  if (ruta !== 'mensajes' && ruta !== 'chat') S.chatAbierto = null;
  if (ruta !== 'ticket') S.ticketAbierto = null;
  $('#zonaBuscador').classList.toggle('md:block', ['inicio', 'solicitudes'].includes(ruta));
  $('#buscadorMovil').classList.toggle('hidden', !['inicio', 'solicitudes'].includes(ruta));
  $$('#navInferior [data-ruta]').forEach((a) => {
    const activo = a.dataset.ruta === ruta || (a.dataset.ruta === 'mensajes' && ruta === 'chat') || (a.dataset.ruta === 'perfil' && ['mis-publicaciones', 'mis-solicitudes', 'favoritos'].includes(ruta));
    a.classList.toggle('text-indigo-600', activo);
    a.classList.toggle('text-slate-500', !activo);
  });
  if (cambio) window.scrollTo({ top: 0 });
  await VISTAS[ruta](valor);
}

const irA = (hash) => { if (location.hash === hash) router(); else location.hash = hash; };

let suprimirVolver = false;
function volverAVista() {
  if (suprimirVolver) return;
  if (/^#(anuncio|solicitud)=/.test(location.hash)) history.replaceState(null, '', S.hashVista || '#inicio');
}

// ======================================================================
// CABECERA
// ======================================================================
function renderNav() {
  const nav = $('#navAcciones');
  if (!S.user) {
    nav.innerHTML = `
      <button data-accion="login" class="btn text-slate-600 hover:text-indigo-600 px-3">Ingresar</button>
      <button data-accion="registro" class="btn btn-oscuro">Crear cuenta</button>`;
  } else {
    const nombre = S.perfil?.nombre || 'Mi cuenta';
    nav.innerHTML = `
      <button data-accion="publicar" class="hidden md:inline-flex btn btn-primario"><span class="text-lg leading-none">＋</span> Publicar</button>
      <a href="#mensajes" class="relative w-10 h-10 grid place-items-center rounded-full hover:bg-slate-100 text-xl" title="Mensajes" aria-label="Mensajes">💬<span id="badgeChat" class="punto-badge hidden"></span></a>
      <button data-accion="notificaciones" class="relative w-10 h-10 grid place-items-center rounded-full hover:bg-slate-100 text-xl" title="Notificaciones" aria-label="Notificaciones">🔔<span id="badgeNotif" class="punto-badge hidden"></span></button>
      <div class="relative">
        <button data-accion="menu-usuario" class="flex items-center gap-2 rounded-full hover:bg-slate-100 p-1 sm:pr-3" aria-haspopup="true">
          ${avatar(S.perfil, 'w-8 h-8 text-sm')}
          <span class="hidden sm:block text-sm font-semibold max-w-[120px] truncate">${esc(nombre)}</span>
        </button>
        <div id="menuUsuario" class="hidden absolute right-0 mt-2 w-60 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-40 fade-in">
          <div class="px-4 py-2 border-b border-slate-100 mb-1">
            <p class="font-bold text-sm truncate">${esc(nombre)} ${S.perfil?.verificado ? '<span title="Verificado" class="text-sky-500">✔</span>' : ''}</p>
            <p class="text-xs text-slate-400">${esc(S.perfil?.whatsapp || '')}</p>
          </div>
          ${[
            ['#perfil', '👤', 'Mi perfil'],
            ['#mis-publicaciones', '📦', 'Mis publicaciones'],
            ['#mis-solicitudes', '🙋', 'Mis solicitudes'],
            ['#favoritos', '❤️', 'Favoritos'],
            ['#mensajes', '💬', 'Mensajes'],
            ['#soporte', '🛟', 'Soporte'],
          ].map(([h, i, t]) => `<a href="${h}" class="flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50"><span>${i}</span>${t}</a>`).join('')}
          ${S.perfil?.rol === 'admin' ? '<a href="admin.html" class="flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50 text-indigo-700 font-semibold"><span>🛡️</span>Panel de administración</a>' : ''}
          <button data-accion="logout" class="w-full text-left flex items-center gap-3 px-4 py-2 text-sm hover:bg-rose-50 text-rose-600 mt-1 border-t border-slate-100"><span>↩</span>Cerrar sesión</button>
        </div>
      </div>`;
  }
  actualizarBadges();
  const cuenta = $('#navInferior [data-ruta="perfil"] span:last-child');
  if (cuenta) cuenta.textContent = S.user ? 'Cuenta' : 'Ingresar';
}

function actualizarBadges() {
  const nChat = [...S.noLeidosChat.values()].reduce((a, b) => a + b, 0);
  [['#badgeNotif', S.noLeidasNotif], ['#badgeChat', nChat], ['#badgeChatMovil', nChat]].forEach(([sel, n]) => {
    const el = $(sel);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('hidden', !n);
  });
  document.title = (S.noLeidasNotif + nChat ? `(${S.noLeidasNotif + nChat}) ` : '') + 'OFERTAL · Productos y servicios cerca de ti';
}

document.addEventListener('click', (e) => {
  const menu = $('#menuUsuario');
  if (menu && !menu.classList.contains('hidden') && !e.target.closest('[data-accion="menu-usuario"]')) menu.classList.add('hidden');
});

function configurarBuscador() {
  const inputs = [$('#buscarDesktop'), $('#buscarMovil')];
  const aplicar = debounce((v) => {
    S.filtros.q = v.trim();
    if (S.vista === 'solicitudes') renderListaSolicitudes();
    else if (S.vista === 'inicio') cargarAnuncios(true);
  }, 350);
  inputs.forEach((inp) => inp.addEventListener('input', () => {
    inputs.forEach((o) => { if (o !== inp) o.value = inp.value; });
    aplicar(inp.value);
  }));
}

function configurarNavInferior() {
  $('#navInferior').addEventListener('click', (e) => {
    const a = e.target.closest('[data-ruta="perfil"]');
    if (a && !S.user) { e.preventDefault(); abrirAuth('login'); }
  });
}

function renderBanners() {
  const el = $('#bannerUbicacion');
  el.classList.add('hidden');
  if (!S.user || !S.perfil) return;
  if (S.perfil.estado === 'suspendido') {
    el.className = 'bg-rose-600 text-white text-sm px-4 py-2.5 text-center';
    el.innerHTML = `Tu cuenta está suspendida${S.perfil.motivo_suspension ? ': ' + esc(S.perfil.motivo_suspension) : ''}. <a href="#soporte" class="underline font-bold">Contactar a soporte</a>`;
    return;
  }
  if (S.permisoUbic !== 'granted') {
    el.className = 'bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-4 py-2.5';
    el.innerHTML = `<div class="max-w-7xl mx-auto flex flex-wrap items-center gap-2 justify-between">
      <span>📍 <b>Activa tu ubicación</b> para publicar y ver ofertas cerca de ti. Los demás solo verán un área aproximada.</span>
      <button data-accion="activar-ubicacion" class="btn btn-oscuro py-1.5 text-xs">${S.permisoUbic === 'denied' ? 'Cómo activarla' : 'Activar ubicación'}</button></div>`;
  }
}

// ======================================================================
// UBICACIÓN
// ======================================================================
// Privacidad: la posición exacta se envía únicamente a una función privada de la base
// de datos (solo el equipo de OFERTAL puede verla). Los demás usuarios reciben un
// círculo de ~1 km cuyo centro está desplazado al azar respecto del punto real.
const UBIC = { watchId: null, ultimoEnvio: 0, ultimaPos: null };

async function leerPermisoUbic() {
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    S.permisoUbic = p.state;
    p.onchange = () => { S.permisoUbic = p.state; renderBanners(); if (p.state === 'granted' && S.user) iniciarSeguimiento(); };
  } catch { S.permisoUbic = 'prompt'; }
  return S.permisoUbic;
}

function obtenerPosicion() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej({ code: 2, message: 'Tu navegador no soporta ubicación' });
    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  });
}

async function enviarUbicacion(pos, evento = 'seguimiento') {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  S.miUbic = { lat, lng, precision: accuracy, ts: Date.now() };
  if (!S.user) return;
  UBIC.ultimoEnvio = Date.now();
  UBIC.ultimaPos = { lat, lng };
  const { data, error } = await db.rpc('actualizar_ubicacion', { p_lat: lat, p_lng: lng, p_precision: accuracy, p_evento: evento });
  if (error) throw error;
  if (data && S.perfil) Object.assign(S.perfil, data, { ubicacion_permitida: true });
}

function iniciarSeguimiento() {
  if (UBIC.watchId != null || !navigator.geolocation || !S.user) return;
  UBIC.watchId = navigator.geolocation.watchPosition((pos) => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    S.miUbic = { lat, lng, precision: accuracy, ts: Date.now() };
    const movidoM = UBIC.ultimaPos ? distanciaKm(UBIC.ultimaPos.lat, UBIC.ultimaPos.lng, lat, lng) * 1000 : Infinity;
    if (Date.now() - UBIC.ultimoEnvio > 3 * 60 * 1000 || movidoM > 150) enviarUbicacion(pos).catch(() => {});
  }, (err) => {
    if (err.code === 1) { S.permisoUbic = 'denied'; detenerSeguimiento(); renderBanners(); }
  }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 });
}

function detenerSeguimiento() {
  if (UBIC.watchId != null) navigator.geolocation.clearWatch(UBIC.watchId);
  UBIC.watchId = null;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.user && S.permisoUbic === 'granted' && Date.now() - UBIC.ultimoEnvio > 3 * 60 * 1000) {
    obtenerPosicion().then((p) => enviarUbicacion(p)).catch(() => {});
  }
});

async function gestionarUbicacionAlIngresar() {
  await leerPermisoUbic();
  renderBanners();
  if (S.permisoUbic === 'granted') {
    obtenerPosicion().then((p) => enviarUbicacion(p, 'ingreso')).catch(() => {});
    iniciarSeguimiento();
  }
}

// Pide la ubicación (si hace falta) y la registra. Devuelve true si quedó activa.
async function asegurarUbicacion(evento = 'manual', { silencioso = false } = {}) {
  try {
    const pos = await obtenerPosicion();
    await enviarUbicacion(pos, evento);
    S.permisoUbic = 'granted';
    renderBanners();
    iniciarSeguimiento();
    return true;
  } catch (e) {
    if (e?.code === 1) S.permisoUbic = 'denied';
    renderBanners();
    if (!silencioso) ayudaUbicacion(e?.code === 1);
    return false;
  }
}

function ayudaUbicacion(bloqueada) {
  const m = modal({
    titulo: '📍 Necesitamos tu ubicación',
    ancho: 'sm:max-w-md',
    html: `<div class="space-y-4 text-sm text-slate-600">
      <p>Para mantener OFERTAL seguro, cada publicación registra desde dónde se hace. <b>Los demás usuarios solo ven un área aproximada de ~1 km</b> y el centro de esa área <b>no</b> es tu posición real.</p>
      <div class="rounded-xl bg-indigo-50 text-indigo-900 p-3 text-xs">🔒 Tu ubicación exacta solo la conoce el equipo de OFERTAL y se usa para prevenir fraudes y dar respaldo a quienes contratan tus servicios.</div>
      ${bloqueada ? `<div class="rounded-xl bg-amber-50 text-amber-900 p-3">
        <p class="font-semibold mb-1">Tu navegador bloqueó la ubicación. Para activarla:</p>
        <ol class="list-decimal ml-5 space-y-1 text-xs">
          <li>Toca el ícono 🔒 o ⓘ junto a la dirección web.</li>
          <li>Entra a <b>Permisos</b> o <b>Configuración del sitio</b> → <b>Ubicación</b> → <b>Permitir</b>.</li>
          <li>Verifica que el GPS/ubicación del celular esté encendido.</li>
          <li>Recarga la página.</li>
        </ol></div>` : ''}
      <button data-reintentar class="btn btn-primario w-full py-3">${bloqueada ? 'Ya la activé, reintentar' : 'Permitir ubicación'}</button>
    </div>`,
  });
  m.el.querySelector('[data-reintentar]').onclick = async () => {
    const ok = await asegurarUbicacion('manual', { silencioso: true });
    if (ok) { m.cerrar(); toast('Ubicación activada', 'ok'); }
    else toast('Aún no tenemos acceso a tu ubicación', 'error');
  };
}

async function ubicacionLocalParaFiltro() {
  if (S.miUbic && Date.now() - S.miUbic.ts < 10 * 60 * 1000) return true;
  try {
    const pos = await obtenerPosicion();
    if (S.user) await enviarUbicacion(pos).catch(() => {});
    else S.miUbic = { lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy, ts: Date.now() };
    return true;
  } catch {
    toast('Activa la ubicación del navegador para ver lo que está cerca', 'error');
    return false;
  }
}

// ======================================================================
// AUTENTICACIÓN (WhatsApp + PIN)
// ======================================================================
function abrirAuth(modo = 'login') {
  cerrarTodosLosModales();
  const esLogin = modo === 'login';
  const m = modal({
    ancho: 'sm:max-w-md',
    html: `
      <div class="text-center mb-5">
        <div class="text-3xl font-extrabold tracking-tighter">OFERTAL<span class="text-indigo-600">.</span></div>
        <h2 class="text-xl font-bold mt-3">${esLogin ? 'Bienvenido de nuevo' : 'Crea tu cuenta gratis'}</h2>
        <p class="text-sm text-slate-500 mt-1">${esLogin ? 'Ingresa con tu WhatsApp y tu PIN de 4 dígitos' : 'Solo toma un minuto'}</p>
      </div>
      <form id="fAuth" class="space-y-3" novalidate>
        <div>
          <label class="etiqueta">Número de WhatsApp</label>
          <div class="flex"><span class="px-3 grid place-items-center rounded-l-xl border border-r-0 border-slate-200 bg-slate-50 text-sm text-slate-500">🇨🇴 +57</span>
          <input name="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" required class="campo rounded-l-none" placeholder="3001234567"></div>
        </div>
        <div>
          <label class="etiqueta">PIN de 4 dígitos</label>
          <input name="pin" type="password" inputmode="numeric" autocomplete="${esLogin ? 'current-password' : 'new-password'}" maxlength="4" required class="campo text-center tracking-[0.6em] text-lg font-bold" placeholder="••••">
        </div>
        ${esLogin ? '' : `
        <div><label class="etiqueta">Confirma tu PIN</label><input name="pin2" type="password" inputmode="numeric" maxlength="4" class="campo text-center tracking-[0.6em] text-lg font-bold" placeholder="••••"></div>
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2"><label class="etiqueta">Tu nombre</label><input name="nombre" maxlength="40" class="campo" placeholder="Nombre"></div>
          <div><label class="etiqueta">Edad</label><input name="edad" type="number" min="14" max="110" class="campo" placeholder="25"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">Departamento</label><select name="depto" class="campo"></select></div>
          <div><label class="etiqueta">Municipio</label><select name="mun" class="campo"></select></div>
        </div>
        <label class="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 rounded-xl p-3">
          <input type="checkbox" name="acepto" class="mt-0.5 accent-indigo-600">
          <span>Acepto que OFERTAL registre mi ubicación mientras uso la plataforma, por seguridad. Los demás usuarios <b>solo verán un área aproximada</b>, nunca mi ubicación exacta.</span>
        </label>`}
        <p id="authError" class="hidden text-sm text-rose-600 bg-rose-50 rounded-xl px-3 py-2"></p>
        <button data-enviar class="btn btn-oscuro w-full py-3 text-base">${esLogin ? 'Ingresar' : 'Crear cuenta'}</button>
      </form>
      <div class="text-center text-sm text-slate-600 mt-4 space-y-2">
        <p>${esLogin ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'} <button data-accion="${esLogin ? 'registro' : 'login'}" class="text-indigo-600 font-semibold hover:underline">${esLogin ? 'Regístrate' : 'Inicia sesión'}</button></p>
        ${esLogin ? '<p><a href="#soporte" data-cerrar class="text-slate-400 hover:text-slate-600 text-xs">¿Olvidaste tu PIN?</a></p>' : ''}
      </div>`,
  });
  const f = m.el.querySelector('#fAuth');
  if (!esLogin) llenarSelectDepartamentos(f.depto, f.mun);
  const err = m.el.querySelector('#authError');
  const mostrarError = (t) => { err.textContent = t; err.classList.remove('hidden'); };
  f.tel.addEventListener('input', () => (f.tel.value = f.tel.value.replace(/\D/g, '')));
  f.pin.addEventListener('input', () => (f.pin.value = f.pin.value.replace(/\D/g, '')));
  setTimeout(() => f.tel.focus(), 60);

  f.onsubmit = async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    const tel = f.tel.value.trim();
    const pin = f.pin.value.trim();
    if (!/^3\d{9}$/.test(tel)) return mostrarError('El número debe ser colombiano: 10 dígitos y empezar por 3.');
    if (!/^\d{4}$/.test(pin)) return mostrarError('El PIN debe tener exactamente 4 números.');
    if (!esLogin) {
      if (f.pin2.value !== pin) return mostrarError('Los PIN no coinciden.');
      if (/^(\d)\1{3}$/.test(pin) || ['1234', '4321', '0000'].includes(pin)) return mostrarError('Elige un PIN menos obvio (no 1234, 0000, 1111…).');
      if (f.nombre.value.trim().length < 2) return mostrarError('Escribe tu nombre.');
      if (!f.depto.value || !f.mun.value) return mostrarError('Selecciona tu departamento y municipio.');
      if (!f.acepto.checked) return mostrarError('Debes aceptar el uso de la ubicación para continuar.');
    }
    const btn = f.querySelector('[data-enviar]');
    btn.disabled = true; btn.textContent = 'Procesando…';
    try {
      const email = `${tel}@ofertal.com`;
      const password = pin + PIN_SALT;
      if (esLogin) {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        m.cerrar();
        toast('¡Hola de nuevo!', 'ok');
      } else {
        const { data, error } = await db.auth.signUp({
          email, password,
          options: { data: { whatsapp: tel, primer_nombre: f.nombre.value.trim(), edad: parseInt(f.edad.value, 10) || null, departamento: f.depto.value, municipio: f.mun.value } },
        });
        if (error) throw error;
        if (!data.session) {
          const r = await db.auth.signInWithPassword({ email, password });
          if (r.error) throw r.error;
        }
        m.cerrar();
        bienvenidaNuevoUsuario();
      }
    } catch (ex) {
      mostrarError(esLogin ? errorMsg(ex, 'Número o PIN incorrectos.') : errorMsg(ex, 'No pudimos crear la cuenta. Puede que el número ya exista.'));
    } finally {
      btn.disabled = false; btn.textContent = esLogin ? 'Ingresar' : 'Crear cuenta';
    }
  };
}

function bienvenidaNuevoUsuario() {
  const m = modal({
    ancho: 'sm:max-w-md',
    html: `<div class="text-center space-y-4">
      <div class="text-5xl">🎉</div>
      <h2 class="text-xl font-bold">¡Bienvenido a OFERTAL!</h2>
      <p class="text-sm text-slate-600">Un último paso: activa tu ubicación para poder publicar y ver lo que está cerca de ti.</p>
      <div class="text-left text-xs bg-slate-50 rounded-xl p-3 space-y-1.5 text-slate-600">
        <p>✅ Los demás solo ven un <b>área aproximada</b> (~1 km).</p>
        <p>✅ El centro del área <b>no</b> es tu posición real.</p>
        <p>🔒 Tu ubicación exacta solo la conoce el equipo de OFERTAL, por seguridad.</p>
      </div>
      <button data-si class="btn btn-primario w-full py-3">📍 Activar ubicación</button>
      <button data-cerrar class="text-sm text-slate-400 hover:text-slate-600">Ahora no</button>
    </div>`,
  });
  m.el.querySelector('[data-si]').onclick = async () => {
    const ok = await asegurarUbicacion('registro');
    if (ok) { m.cerrar(); toast('¡Listo! Ya puedes publicar', 'ok'); }
  };
}

async function cerrarSesion() {
  detenerSeguimiento();
  await db.auth.signOut();
  location.hash = '#inicio';
  toast('Sesión cerrada');
}

// ======================================================================
// DATOS AUXILIARES
// ======================================================================
async function cargarPerfiles(ids) {
  const faltan = [...new Set(ids.filter((id) => id && !S.perfiles.has(id)))];
  if (faltan.length) {
    const { data } = await db.from('perfiles_publicos').select('*').in('id', faltan);
    (data || []).forEach((p) => S.perfiles.set(p.id, p));
  }
  return S.perfiles;
}

async function cargarFavoritos() {
  if (!S.user) return;
  const { data } = await db.from('favoritos').select('anuncio_id').eq('user_id', S.user.id);
  S.favoritos = new Set((data || []).map((f) => f.anuncio_id));
  $$('[data-accion="favorito"]').forEach((b) => marcarFavBtn(b));
}

const catIcono = (nombre) => S.categorias.find((c) => c.nombre === nombre)?.icono || '📦';
const categoriasPara = (tipo) => S.categorias.filter((c) => c.tipo === 'ambos' || c.tipo === tipo);

async function misCategorias() {
  if (S.misCategorias) return S.misCategorias;
  const { data } = await db.from('anuncios').select('categoria').eq('user_id', S.user.id).eq('estado', 'aprobado');
  S.misCategorias = new Set((data || []).map((a) => a.categoria).filter(Boolean));
  return S.misCategorias;
}

function distanciaA(item) {
  if (!S.miUbic || item.zona_lat == null) return null;
  return distanciaKm(S.miUbic.lat, S.miUbic.lng, item.zona_lat, item.zona_lng);
}

function htmlZona(item, etiqueta) {
  if (item.zona_lat == null) {
    return `<div class="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-sm text-slate-500">📍 ${esc(item.municipio || 'Colombia')}${item.departamento ? ', ' + esc(item.departamento) : ''}</div>`;
  }
  return `<div>
    <div class="mapa" data-mapa-zona data-lat="${item.zona_lat}" data-lng="${item.zona_lng}" data-radio="${item.zona_radio || 1000}"></div>
    <p class="text-[11px] text-slate-400 mt-1.5">🔒 ${etiqueta} Por privacidad mostramos un área aproximada de ~${Math.round((item.zona_radio || 1000) / 100) / 10} km, no la ubicación exacta.</p>
  </div>`;
}

function activarMapas(raiz) {
  $$('[data-mapa-zona]', raiz).forEach((el) => {
    if (el.dataset.listo) return;
    el.dataset.listo = '1';
    mapaZona(el, { lat: +el.dataset.lat, lng: +el.dataset.lng, radio: +el.dataset.radio });
  });
}

// ======================================================================
// VISTA: INICIO (OFERTAS)
// ======================================================================
function encabezadoExplorar(activo) {
  const hero = !S.user ? `
    <section class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 text-white p-6 sm:p-10 mt-5">
      <div class="absolute -right-16 -top-16 w-72 h-72 rounded-full bg-white/10"></div>
      <div class="absolute right-24 -bottom-24 w-56 h-56 rounded-full bg-white/5"></div>
      <div class="relative max-w-2xl">
        <p class="text-indigo-200 text-sm font-semibold mb-2">Marketplace colombiano</p>
        <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">Compra, vende y contrata servicios cerca de ti</h1>
        <p class="text-indigo-100 mt-3 text-sm sm:text-base">Publica gratis lo que ofreces o cuenta qué necesitas: los proveedores de tu zona te enviarán propuestas.</p>
        <div class="flex flex-wrap gap-3 mt-6">
          <button data-accion="nueva-oferta" class="btn bg-white text-indigo-700 hover:bg-indigo-50 py-3 px-5">🛍️ Quiero ofrecer</button>
          <button data-accion="nueva-solicitud" class="btn bg-indigo-900/40 hover:bg-indigo-900/60 text-white py-3 px-5 ring-1 ring-white/30">🙋 Necesito un servicio</button>
        </div>
      </div>
    </section>` : `
    <section class="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">Hola, ${esc(S.perfil?.nombre || '')} 👋</h1>
        <p class="text-sm text-slate-500">¿Qué quieres hacer hoy?</p>
      </div>
      <div class="flex gap-2">
        <button data-accion="nueva-oferta" class="btn btn-primario">🛍️ Ofrecer</button>
        <button data-accion="nueva-solicitud" class="btn btn-oscuro">🙋 Solicitar servicio</button>
      </div>
    </section>`;
  return `${hero}
    <div class="mt-6 inline-flex p-1 bg-slate-200/70 rounded-2xl">
      <a href="#inicio" class="px-4 sm:px-6 py-2 rounded-xl text-sm font-bold ${activo === 'inicio' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}">🛍️ Ofertas</a>
      <a href="#solicitudes" class="px-4 sm:px-6 py-2 rounded-xl text-sm font-bold ${activo === 'solicitudes' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}">🙋 Solicitudes</a>
    </div>`;
}

function selectDistancia(valor) {
  return `<select data-filtro="distancia" class="campo !w-auto !py-2 text-xs sm:text-sm">
    ${[[0, 'Cualquier distancia'], [5, 'A menos de 5 km'], [10, 'A menos de 10 km'], [25, 'A menos de 25 km'], [50, 'A menos de 50 km']]
      .map(([v, t]) => `<option value="${v}" ${+valor === v ? 'selected' : ''}>📍 ${t}</option>`).join('')}
  </select>`;
}

async function vistaInicio() {
  const f = S.filtros;
  app.innerHTML = `
    ${encabezadoExplorar('inicio')}
    <div class="mt-5 flex gap-2 overflow-x-auto hide-scrollbar pb-1" id="chipsCategorias">
      <button data-filtro-cat="" class="chip ${!f.categoria ? 'activo' : ''}">Todas</button>
      ${S.categorias.map((c) => `<button data-filtro-cat="${esc(c.nombre)}" class="chip ${f.categoria === c.nombre ? 'activo' : ''}">${c.icono} ${esc(c.nombre)}</button>`).join('')}
    </div>
    <div class="mt-3 flex flex-wrap gap-2 items-center">
      <div class="inline-flex bg-white border border-slate-200 rounded-xl p-0.5">
        ${[['todos', 'Todo'], ['producto', 'Productos'], ['servicio', 'Servicios']].map(([v, t]) => `<button data-filtro-tipo="${v}" class="px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold ${f.tipo === v ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}">${t}</button>`).join('')}
      </div>
      <select data-filtro="departamento" class="campo !w-auto !py-2 text-xs sm:text-sm" id="filtroDepto"></select>
      ${selectDistancia(f.distancia)}
      <select data-filtro="orden" class="campo !w-auto !py-2 text-xs sm:text-sm">
        ${[['recientes', 'Más recientes'], ['cercanos', 'Más cercanos'], ['precio_asc', 'Menor precio'], ['precio_desc', 'Mayor precio']]
          .map(([v, t]) => `<option value="${v}" ${f.orden === v ? 'selected' : ''}>↕ ${t}</option>`).join('')}
      </select>
    </div>
    <div id="feed" class="mt-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5"></div>
    <div id="feedVacio" class="hidden text-center py-16">
      <div class="text-5xl mb-3">🔎</div>
      <h3 class="font-bold text-lg">No encontramos ofertas</h3>
      <p class="text-slate-500 text-sm mt-1">Prueba con otros filtros o <button data-accion="nueva-solicitud" class="text-indigo-600 font-semibold hover:underline">publica lo que necesitas</button> y deja que te encuentren.</p>
    </div>
    <div class="text-center mt-8"><button id="btnMas" data-accion="mas-anuncios" class="hidden btn btn-suave px-8">Cargar más</button></div>`;
  await llenarSelectDepartamentos($('#filtroDepto'), null, { depto: f.departamento, todos: true });
  enlazarFiltros();
  await cargarAnuncios(true);
}

function enlazarFiltros() {
  $$('[data-filtro-cat]').forEach((b) => (b.onclick = () => {
    S.filtros.categoria = b.dataset.filtroCat;
    $$('[data-filtro-cat]').forEach((x) => x.classList.toggle('activo', x === b));
    cargarAnuncios(true);
  }));
  $$('[data-filtro-tipo]').forEach((b) => (b.onclick = () => { S.filtros.tipo = b.dataset.filtroTipo; vistaInicio(); }));
  $$('select[data-filtro]').forEach((s) => (s.onchange = async () => {
    const k = s.dataset.filtro;
    const v = k === 'distancia' ? +s.value : s.value;
    if ((k === 'distancia' && v) || (k === 'orden' && v === 'cercanos')) {
      if (!(await ubicacionLocalParaFiltro())) { s.value = k === 'distancia' ? '0' : 'recientes'; return; }
    }
    S.filtros[k] = v;
    cargarAnuncios(true);
  }));
}

function esqueletos(n = 8) {
  return Array.from({ length: n }, () => `<div class="tarjeta overflow-hidden"><div class="esqueleto aspect-[4/3] !rounded-none"></div><div class="p-3 space-y-2"><div class="esqueleto h-4 w-4/5"></div><div class="esqueleto h-3 w-1/2"></div><div class="esqueleto h-5 w-2/5"></div></div></div>`).join('');
}

async function cargarAnuncios(reiniciar = true) {
  const feed = $('#feed');
  if (!feed) return;
  const f = S.filtros;
  const porDistancia = f.distancia > 0 || f.orden === 'cercanos';
  if (reiniciar) { S.pagina = 0; S.anuncios = []; feed.innerHTML = esqueletos(); }
  const tam = porDistancia ? 300 : PAGINA;
  let q = db.from('anuncios').select(S.user ? COLS_ANUNCIO_SESION : COLS_ANUNCIO_PUBLICO).eq('estado', 'aprobado');
  if (S.user) q = q.neq('user_id', S.user.id);
  if (f.tipo !== 'todos') q = q.eq('tipo', f.tipo);
  if (f.categoria) q = q.eq('categoria', f.categoria);
  if (f.departamento) q = q.eq('departamento', f.departamento);
  if (f.q) {
    const t = f.q.replace(/[%,()*"\\]/g, ' ').trim();
    if (t) q = q.or(`titulo.ilike.%${t}%,descripcion.ilike.%${t}%,municipio.ilike.%${t}%,categoria.ilike.%${t}%`);
  }
  if (f.orden === 'precio_asc') q = q.order('precio', { ascending: true });
  else if (f.orden === 'precio_desc') q = q.order('precio', { ascending: false });
  else q = q.order('destacado', { ascending: false }).order('created_at', { ascending: false });
  q = q.range(S.pagina * tam, S.pagina * tam + tam - 1);

  const { data, error } = await q;
  if (!$('#feed')) return;
  if (error) { feed.innerHTML = `<p class="col-span-full text-center text-rose-600 py-10">${esc(errorMsg(error))}</p>`; return; }
  let lista = data || [];
  S.hayMas = !porDistancia && lista.length === tam;
  if (porDistancia) {
    lista = lista.map((a) => ({ ...a, _dist: distanciaA(a) }));
    if (f.distancia > 0) lista = lista.filter((a) => a._dist != null && a._dist <= f.distancia);
    if (f.orden === 'cercanos') lista.sort((a, b) => (a._dist ?? 1e9) - (b._dist ?? 1e9));
  }
  S.anuncios = reiniciar ? lista : S.anuncios.concat(lista);
  await cargarPerfiles(S.anuncios.map((a) => a.user_id));
  if (reiniciar) feed.innerHTML = '';
  feed.insertAdjacentHTML('beforeend', lista.map(tarjetaAnuncio).join(''));
  $('#feedVacio').classList.toggle('hidden', S.anuncios.length > 0);
  $('#btnMas').classList.toggle('hidden', !S.hayMas);
}

function tarjetaAnuncio(a) {
  const imgs = parseImagenes(a.imagen_urls);
  const vendedor = S.perfiles.get(a.user_id);
  const dist = textoDistancia(a._dist ?? distanciaA(a));
  const esFav = S.favoritos.has(a.id);
  return `
    <article data-accion="ver-anuncio" data-id="${a.id}" class="tarjeta overflow-hidden cursor-pointer group hover:shadow-lg hover:-translate-y-0.5 transition duration-200 flex flex-col">
      <div class="relative aspect-[4/3] bg-slate-100 overflow-hidden">
        <img src="${esc(imgs[0])}" alt="" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-500">
        <div class="absolute top-2 left-2 flex gap-1">
          <span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-white/95 ${a.tipo === 'producto' ? 'text-blue-700' : 'text-emerald-700'}">${a.tipo}</span>
          ${a.destacado ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-400 text-amber-950">★ DESTACADO</span>' : ''}
        </div>
        ${imgs.length > 1 && S.user ? `<span class="absolute bottom-2 left-2 text-[10px] font-bold bg-black/55 text-white px-1.5 py-0.5 rounded">📷 ${imgs.length}</span>` : ''}
        ${S.user ? `<button data-accion="favorito" data-id="${a.id}" class="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 grid place-items-center text-base shadow ${esFav ? 'text-rose-500' : 'text-slate-400'}" aria-label="Favorito">${esFav ? '♥' : '♡'}</button>` : ''}
      </div>
      <div class="p-3 flex flex-col grow">
        <p class="text-base sm:text-lg font-extrabold text-slate-900">${precioTexto(a.precio, a.precio_negociable)}</p>
        <h3 class="text-sm font-semibold text-slate-700 line-clamp-2 leading-snug mt-0.5">${esc(a.titulo)}</h3>
        <p class="text-[11px] text-slate-400 mt-1.5 line-clamp-1">📍 ${esc(a.municipio || 'Colombia')}${dist ? ` · ${dist}` : ''}</p>
        <div class="mt-auto pt-2 flex items-center justify-between gap-1 text-[11px] text-slate-400">
          <span class="truncate">${a.categoria ? `${catIcono(a.categoria)} ${esc(a.categoria)}` : ''}</span>
          ${vendedor?.num_resenas ? `<span class="shrink-0 text-amber-500 font-semibold">★ ${vendedor.calificacion}</span>` : ''}
        </div>
      </div>
    </article>`;
}

function marcarFavBtn(b) {
  const on = S.favoritos.has(b.dataset.id);
  b.textContent = on ? '♥' : '♡';
  b.classList.toggle('text-rose-500', on);
  b.classList.toggle('text-slate-400', !on);
}

async function alternarFavorito(id) {
  if (!S.user) return abrirAuth('login');
  const on = S.favoritos.has(id);
  if (on) S.favoritos.delete(id); else S.favoritos.add(id);
  $$(`[data-accion="favorito"][data-id="${id}"]`).forEach(marcarFavBtn);
  const { error } = on
    ? await db.from('favoritos').delete().eq('user_id', S.user.id).eq('anuncio_id', id)
    : await db.from('favoritos').insert({ user_id: S.user.id, anuncio_id: id });
  if (error) {
    if (on) S.favoritos.add(id); else S.favoritos.delete(id);
    $$(`[data-accion="favorito"][data-id="${id}"]`).forEach(marcarFavBtn);
    toast(errorMsg(error), 'error');
  } else if (!on) toast('Guardado en favoritos ❤️', 'ok', 1800);
}

// ======================================================================
// DETALLE DE OFERTA
// ======================================================================
function cerrarModalesSinVolver() {
  suprimirVolver = true;
  cerrarTodosLosModales();
  suprimirVolver = false;
}

async function abrirAnuncio(id) {
  cerrarModalesSinVolver();
  const cols = S.user ? COLS_ANUNCIO_SESION + ',motivo_rechazo' : COLS_ANUNCIO_PUBLICO;
  let a = S.anuncios.find((x) => x.id === id);
  if (!a || (S.user && a.contacto === undefined)) {
    const { data } = await db.from('anuncios').select(cols).eq('id', id).maybeSingle();
    a = data;
  }
  if (!a) { toast('Esta publicación ya no está disponible', 'error'); volverAVista(); return; }
  await cargarPerfiles([a.user_id]);
  const v = S.perfiles.get(a.user_id) || {};
  const esMio = S.user?.id === a.user_id;
  let imgs = parseImagenes(a.imagen_urls);
  const totalImgs = imgs.length;
  if (!S.user) imgs = imgs.slice(0, 1);
  const enlace = `${location.origin}${location.pathname}#anuncio=${a.id}`;
  const wa = a.contacto ? `https://wa.me/57${a.contacto}?text=${encodeURIComponent(`Hola ${v.nombre || ''}, vi tu publicación en OFERTAL: "${a.titulo}". ${enlace}`)}` : null;

  const m = modal({
    ancho: 'sm:max-w-3xl', sinPadding: true,
    onClose: volverAVista,
    html: `
      <div class="relative bg-slate-900">
        <div class="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar" data-galeria>
          ${imgs.map((u) => `<div class="w-full shrink-0 snap-center h-72 sm:h-[420px] grid place-items-center"><img src="${esc(u)}" alt="" class="max-w-full max-h-full object-contain"></div>`).join('')}
        </div>
        ${imgs.length > 1 ? `
          <button data-gal="-1" class="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white hidden sm:grid place-items-center">‹</button>
          <button data-gal="1" class="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white hidden sm:grid place-items-center">›</button>
          <div class="absolute bottom-3 inset-x-0 flex justify-center gap-1.5" data-puntos>${imgs.map((_, i) => `<span class="w-2 h-2 rounded-full ${i ? 'bg-white/40' : 'bg-white'}"></span>`).join('')}</div>` : ''}
        ${!S.user && totalImgs > 1 ? `<button data-accion="login" class="absolute bottom-3 right-3 text-xs font-bold bg-white/95 text-slate-800 px-3 py-1.5 rounded-full">📷 Inicia sesión para ver ${totalImgs} fotos</button>` : ''}
        <button data-cerrar class="absolute top-3 right-3 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white grid place-items-center text-lg" aria-label="Cerrar">✕</button>
      </div>
      <div class="p-5 sm:p-6 space-y-5">
        <div>
          <div class="flex flex-wrap gap-1.5 mb-2">
            <span class="px-2 py-0.5 rounded-md text-[11px] font-extrabold uppercase ${a.tipo === 'producto' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}">${a.tipo}</span>
            ${a.categoria ? `<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600">${catIcono(a.categoria)} ${esc(a.categoria)}</span>` : ''}
            ${esMio ? badge(ESTADOS_ANUNCIO[a.estado] || ['', '']) : ''}
          </div>
          <h2 class="text-xl sm:text-2xl font-extrabold text-slate-900 leading-tight">${esc(a.titulo)}</h2>
          <p class="text-2xl sm:text-3xl font-black text-indigo-600 mt-2">${precioTexto(a.precio, a.precio_negociable)}</p>
          <p class="text-xs text-slate-400 mt-2">📍 ${esc(a.municipio || 'Colombia')}${a.departamento ? ', ' + esc(a.departamento) : ''} · ${tiempoRelativo(a.aprobado_at || a.created_at)} · 👁 ${fmtNum(a.vistas)} vistas${distanciaA(a) != null ? ' · ' + textoDistancia(distanciaA(a)) : ''}</p>
        </div>
        ${esMio && a.estado === 'rechazado' && a.motivo_rechazo ? `<div class="rounded-xl bg-rose-50 text-rose-800 text-sm p-3"><b>Motivo del rechazo:</b> ${esc(a.motivo_rechazo)}</div>` : ''}
        <div>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Descripción</h3>
          <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">${esc(a.descripcion)}</p>
        </div>
        <a href="#usuario=${a.user_id}" class="flex items-center gap-3 p-3 rounded-2xl border border-slate-100 hover:bg-slate-50">
          ${avatar(v, 'w-12 h-12 text-lg')}
          <div class="grow min-w-0">
            <p class="font-bold text-slate-800 truncate">${esc(v.nombre || 'Usuario')} ${v.verificado ? '<span class="text-sky-500" title="Identidad verificada por OFERTAL">✔</span>' : ''}</p>
            <p class="text-xs text-slate-500">${v.num_resenas ? `${estrellas(v.calificacion, 'text-xs')} ${v.calificacion} (${v.num_resenas})` : 'Sin calificaciones aún'} · ${v.ultima_conexion ? 'Activo ' + tiempoRelativo(v.ultima_conexion) : 'Miembro desde ' + new Date(v.created_at || Date.now()).getFullYear()}</p>
          </div>
          <span class="text-slate-300">›</span>
        </a>
        <div>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Zona de publicación</h3>
          ${htmlZona(a, 'El vendedor publicó desde dentro de esta área.')}
        </div>
        <div class="rounded-xl bg-amber-50 text-amber-900 text-xs p-3">🛡️ <b>Consejo de seguridad:</b> no pagues anticipos a desconocidos, revisa el producto antes de pagar y reúnete en lugares públicos.</div>
      </div>`,
    pie: `<div class="flex flex-wrap gap-2">
      ${esMio ? `
        <button data-accion="editar-oferta" data-id="${a.id}" class="btn btn-oscuro grow">✏️ Editar</button>
        <a href="#mis-publicaciones" class="btn btn-suave grow">📦 Mis publicaciones</a>` : S.user ? `
        <button data-accion="chatear" data-usuario="${a.user_id}" data-anuncio="${a.id}" class="btn btn-primario grow py-3">💬 Chatear</button>
        ${wa ? `<a href="${wa}" target="_blank" rel="noopener" class="btn btn-verde grow py-3">WhatsApp</a>` : ''}
        <button data-accion="favorito" data-id="${a.id}" class="btn btn-suave w-12 text-lg ${S.favoritos.has(a.id) ? 'text-rose-500' : 'text-slate-400'}" aria-label="Favorito">${S.favoritos.has(a.id) ? '♥' : '♡'}</button>` : `
        <button data-accion="login" class="btn btn-primario grow py-3">Inicia sesión para contactar</button>`}
      <button data-accion="compartir" data-url="${esc(enlace)}" data-titulo="${esc(a.titulo)}" class="btn btn-suave" aria-label="Compartir">🔗</button>
      ${S.user && !esMio ? `<button data-accion="reportar" data-entidad="anuncio" data-id="${a.id}" class="btn btn-suave text-slate-500" title="Reportar">⚑</button>` : ''}
    </div>`,
  });
  activarGaleria(m.el);
  activarMapas(m.el);
  if (!esMio) db.rpc('sumar_vista', { p_entidad: 'anuncio', p_id: a.id });
}

function activarGaleria(raiz) {
  const gal = $('[data-galeria]', raiz);
  if (!gal) return;
  const puntos = $$('[data-puntos] span', raiz);
  gal.addEventListener('scroll', debounce(() => {
    const i = Math.round(gal.scrollLeft / gal.clientWidth);
    puntos.forEach((p, j) => p.className = `w-2 h-2 rounded-full ${i === j ? 'bg-white' : 'bg-white/40'}`);
  }, 60));
  $$('[data-gal]', raiz).forEach((b) => (b.onclick = () => gal.scrollBy({ left: gal.clientWidth * +b.dataset.gal, behavior: 'smooth' })));
}

async function compartir(url, titulo) {
  if (navigator.share) {
    try { await navigator.share({ title: titulo, text: `${titulo} · OFERTAL`, url }); return; } catch { /* cancelado */ }
  }
  await navigator.clipboard.writeText(url).catch(() => {});
  toast('Enlace copiado 🔗', 'ok');
}

// ======================================================================
// PUBLICAR / EDITAR OFERTA
// ======================================================================
function elegirPublicacion() {
  if (!S.user) return abrirAuth('login');
  const m = modal({
    titulo: '¿Qué quieres publicar?', ancho: 'sm:max-w-md',
    html: `<div class="grid gap-3">
      <button data-accion="nueva-oferta" class="text-left p-4 rounded-2xl border-2 border-slate-100 hover:border-indigo-400 hover:bg-indigo-50/40 flex gap-4 items-center">
        <span class="text-4xl">🛍️</span><span><b class="block text-slate-800">Ofrecer un producto o servicio</b><span class="text-sm text-slate-500">Vende algo o da a conocer tu trabajo.</span></span></button>
      <button data-accion="nueva-solicitud" class="text-left p-4 rounded-2xl border-2 border-slate-100 hover:border-emerald-400 hover:bg-emerald-50/40 flex gap-4 items-center">
        <span class="text-4xl">🙋</span><span><b class="block text-slate-800">Necesito un servicio o producto</b><span class="text-sm text-slate-500">Describe lo que buscas y recibe propuestas de proveedores cercanos.</span></span></button>
    </div>`,
  });
  return m;
}

function estadoUbicacionHtml() {
  const ok = S.permisoUbic === 'granted';
  return `<div class="rounded-xl ${ok ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'} p-3 text-xs flex gap-2">
    <span>📍</span><span>${ok
      ? 'Registraremos la zona desde donde publicas. Los demás solo verán un área aproximada de ~1 km.'
      : 'Al enviar te pediremos permiso de ubicación. Es obligatorio para publicar; los demás solo verán un área aproximada.'}</span></div>`;
}

function campoIA(clase) {
  return `<button type="button" data-ia="${clase}" class="text-xs font-bold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1">✨ Mejorar con IA</button>`;
}

async function mejorarConIA(form, clase, btn) {
  const titulo = form.titulo.value.trim();
  const descripcion = form.descripcion.value.trim();
  if (titulo.length < 3 && descripcion.length < 5) return toast('Escribe primero un título o una descripción', 'aviso');
  const original = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '⏳ Mejorando…';
  try {
    const tipo = form.querySelector('[name="tipo"]:checked')?.value;
    const r = await llamarFuncion(db, 'ia', { accion: 'mejorar_texto', clase, tipo, titulo, descripcion, categoria: form.categoria.value });
    const previo = { titulo, descripcion, categoria: form.categoria.value };
    form.titulo.value = r.titulo;
    form.descripcion.value = r.descripcion;
    if (r.categoria && [...form.categoria.options].some((o) => o.value === r.categoria)) form.categoria.value = r.categoria;
    const t = toast('Texto mejorado ✨ Revísalo antes de publicar', 'ok', 6000);
    const deshacer = document.createElement('button');
    deshacer.className = 'underline font-bold ml-2 shrink-0';
    deshacer.textContent = 'Deshacer';
    deshacer.onclick = () => { form.titulo.value = previo.titulo; form.descripcion.value = previo.descripcion; form.categoria.value = previo.categoria; t.remove(); };
    t.appendChild(deshacer);
  } catch (e) {
    toast(errorMsg(e), 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = original;
  }
}

async function formularioOferta(id = null) {
  if (!S.user) return abrirAuth('login');
  cerrarTodosLosModales();
  let a = null;
  if (id) {
    const { data } = await db.from('anuncios').select('*').eq('id', id).single();
    a = data;
    if (!a) return toast('No se encontró la publicación', 'error');
  }
  const imgsActuales = a ? parseImagenes(a.imagen_urls).filter((u) => !u.includes('unsplash.com')) : [];
  let nuevas = [];
  const m = modal({
    titulo: a ? 'Editar publicación' : 'Ofrecer producto o servicio', ancho: 'sm:max-w-xl',
    html: `<form id="fOferta" class="space-y-4">
      <div class="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
        ${[['producto', '🛍️ Producto'], ['servicio', '🧰 Servicio']].map(([v, t]) => `
          <label class="cursor-pointer"><input type="radio" name="tipo" value="${v}" class="peer sr-only" ${(a?.tipo || 'producto') === v ? 'checked' : ''}>
          <span class="block text-center py-2 rounded-lg text-sm font-bold text-slate-500 peer-checked:bg-white peer-checked:text-indigo-700 peer-checked:shadow">${t}</span></label>`).join('')}
      </div>
      <div><label class="etiqueta">Título</label><input name="titulo" maxlength="100" required class="campo" placeholder="Ej. Bicicleta de montaña aro 29 / Plomero a domicilio" value="${esc(a?.titulo || '')}"></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label class="etiqueta">Categoría</label><select name="categoria" required class="campo"></select></div>
        <div><label class="etiqueta">Precio (COP)</label><input name="precio" inputmode="numeric" class="campo font-bold" placeholder="Ej. 50.000" value="${a && +a.precio ? fmtNum(a.precio) : ''}"></div>
      </div>
      <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
        <label class="flex items-center gap-2"><input type="checkbox" name="convenir" class="accent-indigo-600" ${a && !+a.precio ? 'checked' : ''}> Precio a convenir</label>
        <label class="flex items-center gap-2"><input type="checkbox" name="negociable" class="accent-indigo-600" ${a?.precio_negociable ? 'checked' : ''}> Negociable</label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="etiqueta">Departamento</label><select name="depto" required class="campo"></select></div>
        <div><label class="etiqueta">Municipio</label><select name="mun" required class="campo"></select></div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1"><label class="etiqueta !mb-0">Descripción</label>${campoIA('oferta')}</div>
        <textarea name="descripcion" rows="5" maxlength="2000" required class="campo resize-y" placeholder="Estado, características, horarios, qué incluye el servicio…">${esc(a?.descripcion || '')}</textarea>
      </div>
      <div>
        <label class="etiqueta">Fotos <span class="font-normal text-slate-400">(máximo 3 · la primera es la portada)</span></label>
        <div id="fotos" class="grid grid-cols-3 gap-2"></div>
        <input type="file" accept="image/*" multiple class="hidden" id="inFotos">
      </div>
      ${a ? '<p class="text-xs text-slate-500 bg-slate-50 rounded-xl p-3">ℹ️ Si cambias el contenido, la publicación volverá a revisión antes de mostrarse.</p>' : estadoUbicacionHtml()}
      <button data-enviar class="btn btn-primario w-full py-3 text-base">${a ? 'Guardar cambios' : 'Enviar publicación'}</button>
    </form>`,
  });
  const f = m.el.querySelector('#fOferta');
  mascaraPrecio(f.precio);
  llenarSelectDepartamentos(f.depto, f.mun, { depto: a?.departamento || S.perfil?.departamento || '', mun: a?.municipio || S.perfil?.municipio || '' });
  const llenarCats = () => {
    const tipo = f.querySelector('[name="tipo"]:checked').value;
    const actual = f.categoria.value || a?.categoria || '';
    f.categoria.innerHTML = '<option value="">Elige…</option>' + categoriasPara(tipo).map((c) => `<option value="${esc(c.nombre)}" ${c.nombre === actual ? 'selected' : ''}>${c.icono} ${esc(c.nombre)}</option>`).join('');
  };
  llenarCats();
  $$('[name="tipo"]', f).forEach((r) => (r.onchange = llenarCats));
  f.convenir.onchange = () => { f.precio.disabled = f.convenir.checked; if (f.convenir.checked) f.precio.value = ''; };
  f.precio.disabled = f.convenir.checked;
  $('[data-ia]', f).onclick = (e) => mejorarConIA(f, 'oferta', e.currentTarget);

  const inFotos = $('#inFotos', m.el);
  const renderFotos = () => {
    const total = imgsActuales.length + nuevas.length;
    $('#fotos', m.el).innerHTML = [
      ...imgsActuales.map((u, i) => `<div class="relative aspect-square"><img src="${esc(u)}" class="w-full h-full object-cover rounded-xl"><button type="button" data-quitar-act="${i}" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs">✕</button></div>`),
      ...nuevas.map((n, i) => `<div class="relative aspect-square"><img src="${n.url}" class="w-full h-full object-cover rounded-xl"><button type="button" data-quitar-nueva="${i}" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs">✕</button></div>`),
      total < 3 ? `<label for="inFotos" class="aspect-square rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 grid place-items-center text-center cursor-pointer text-slate-400 text-xs"><span><span class="text-2xl block">📷</span>Agregar</span></label>` : '',
    ].join('');
    $$('[data-quitar-act]', m.el).forEach((b) => (b.onclick = () => { imgsActuales.splice(+b.dataset.quitarAct, 1); renderFotos(); }));
    $$('[data-quitar-nueva]', m.el).forEach((b) => (b.onclick = () => { URL.revokeObjectURL(nuevas[+b.dataset.quitarNueva].url); nuevas.splice(+b.dataset.quitarNueva, 1); renderFotos(); }));
  };
  inFotos.onchange = () => {
    const libres = 3 - imgsActuales.length - nuevas.length;
    const files = [...inFotos.files].filter((fl) => fl.type.startsWith('image/'));
    if (files.length > libres) toast(`Solo puedes agregar ${libres} foto(s) más`, 'aviso');
    files.slice(0, libres).forEach((file) => nuevas.push({ file, url: URL.createObjectURL(file) }));
    inFotos.value = '';
    renderFotos();
  };
  renderFotos();

  f.onsubmit = async (e) => {
    e.preventDefault();
    const precio = f.convenir.checked ? 0 : leerPrecio(f.precio.value);
    if (!f.convenir.checked && !precio) return toast('Escribe un precio o marca "a convenir"', 'aviso');
    if (!f.categoria.value) return toast('Elige una categoría', 'aviso');
    if (!f.mun.value) return toast('Elige el municipio', 'aviso');
    if (f.titulo.value.trim().length < 4) return toast('El título es muy corto', 'aviso');
    if (f.descripcion.value.trim().length < 10) return toast('Describe un poco más tu publicación', 'aviso');
    const btn = f.querySelector('[data-enviar]');
    btn.disabled = true;
    try {
      if (!a) {
        btn.textContent = '📍 Verificando ubicación…';
        const ok = await asegurarUbicacion('publicacion');
        if (!ok && S.config.requerir_ubicacion !== false) throw Object.assign(new Error('UBICACION'), { silencio: true });
      }
      btn.textContent = nuevas.length ? 'Subiendo fotos…' : 'Guardando…';
      const urls = [...imgsActuales];
      for (const n of nuevas) urls.push(await subirImagen(db, S.user.id, n.file, 'anuncio'));
      const datos = {
        titulo: f.titulo.value.trim(),
        tipo: f.querySelector('[name="tipo"]:checked').value,
        categoria: f.categoria.value,
        precio,
        precio_negociable: f.negociable.checked,
        descripcion: f.descripcion.value.trim(),
        departamento: f.depto.value,
        municipio: f.mun.value,
        imagen_urls: urls,
      };
      btn.textContent = 'Publicando…';
      let resultado;
      if (a) {
        resultado = await db.from('anuncios').update(datos).eq('id', a.id).select('id, estado').single();
      } else {
        resultado = await db.from('anuncios').insert({ ...datos, contacto: S.perfil?.whatsapp || '' }).select('id, estado').single();
      }
      if (resultado.error) throw resultado.error;
      const guardado = resultado.data;
      m.cerrar();
      S.misCategorias = null;
      if (guardado.estado === 'pendiente') {
        llamarFuncion(db, 'ia', { accion: 'moderar', entidad: 'anuncio', id: guardado.id })
          .then((r) => { if (r.auto_aprobado) toast('¡Tu publicación ya está visible! 🎉', 'ok'); })
          .catch(() => {});
      }
      exitoPublicacion(guardado.estado, 'anuncio', guardado.id);
      if (S.vista === 'mis-publicaciones') vistaMisPublicaciones();
    } catch (ex) {
      if (ex.silencio) return;
      if (codigoError(ex) === 'UBICACION_REQUERIDA') ayudaUbicacion(S.permisoUbic === 'denied');
      else toast(errorMsg(ex), 'error');
    } finally {
      btn.disabled = false; btn.textContent = a ? 'Guardar cambios' : 'Enviar publicación';
    }
  };
}

function exitoPublicacion(estado, clase, id) {
  const pendiente = estado === 'pendiente';
  const m = modal({
    ancho: 'sm:max-w-sm',
    html: `<div class="text-center space-y-3">
      <div class="w-16 h-16 mx-auto rounded-full ${pendiente ? 'bg-amber-100' : 'bg-emerald-100'} grid place-items-center text-3xl">${pendiente ? '⏳' : '✅'}</div>
      <h3 class="text-lg font-bold">${pendiente ? '¡Recibimos tu publicación!' : '¡Publicado!'}</h3>
      <p class="text-sm text-slate-600">${pendiente
        ? 'Nuestro equipo la revisará pronto. Te avisaremos con una notificación 🔔 cuando esté visible.'
        : clase === 'solicitud' ? 'Los proveedores de tu zona ya pueden verla y recibirán una notificación. Te llegarán sus propuestas aquí.' : 'Tu publicación ya está visible para todos.'}</p>
      <div class="flex gap-2 pt-2">
        <a href="${clase === 'solicitud' ? '#mis-solicitudes' : '#mis-publicaciones'}" data-cerrar class="btn btn-suave grow">Ver mis ${clase === 'solicitud' ? 'solicitudes' : 'publicaciones'}</a>
        <button data-cerrar class="btn btn-oscuro grow">Entendido</button>
      </div></div>`,
  });
  return m;
}

// ======================================================================
// SOLICITUDES
// ======================================================================
async function vistaSolicitudes() {
  const f = S.filtrosSol;
  app.innerHTML = `
    ${encabezadoExplorar('solicitudes')}
    <div class="mt-5 rounded-2xl bg-emerald-50 border border-emerald-100 p-4 flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-emerald-900"><b>Personas que necesitan un servicio o producto.</b> ¿Puedes ayudar? Envía tu propuesta con precio.</p>
      <button data-accion="nueva-solicitud" class="btn btn-verde">🙋 Publicar lo que necesito</button>
    </div>
    <div class="mt-4 flex flex-wrap gap-2 items-center">
      <select data-fsol="categoria" class="campo !w-auto !py-2 text-xs sm:text-sm">
        <option value="">Todas las categorías</option>
        ${S.categorias.map((c) => `<option value="${esc(c.nombre)}" ${f.categoria === c.nombre ? 'selected' : ''}>${c.icono} ${esc(c.nombre)}</option>`).join('')}
      </select>
      <select data-fsol="departamento" id="solDepto" class="campo !w-auto !py-2 text-xs sm:text-sm"></select>
      ${selectDistancia(f.distancia).replace('data-filtro="distancia"', 'data-fsol="distancia"')}
      ${S.user ? `<label class="chip flex items-center gap-2 cursor-pointer ${f.paraMi ? 'activo' : ''}"><input type="checkbox" data-fsol="paraMi" class="hidden" ${f.paraMi ? 'checked' : ''}>✨ Para mí</label>` : ''}
    </div>
    <div id="listaSol" class="mt-5 grid gap-3 md:grid-cols-2"></div>`;
  await llenarSelectDepartamentos($('#solDepto'), null, { depto: f.departamento, todos: true });
  $$('[data-fsol]').forEach((el) => (el.onchange = async () => {
    const k = el.dataset.fsol;
    if (k === 'paraMi') { f.paraMi = el.checked; el.parentElement.classList.toggle('activo', el.checked); }
    else if (k === 'distancia') {
      if (+el.value && !(await ubicacionLocalParaFiltro())) { el.value = '0'; return; }
      f.distancia = +el.value;
    } else f[k] = el.value;
    renderListaSolicitudes();
  }));
  renderListaSolicitudes();
}

async function renderListaSolicitudes() {
  const cont = $('#listaSol');
  if (!cont) return;
  const f = S.filtrosSol;
  cont.innerHTML = Array.from({ length: 4 }, () => '<div class="tarjeta p-4 space-y-2"><div class="esqueleto h-4 w-1/3"></div><div class="esqueleto h-5 w-4/5"></div><div class="esqueleto h-3 w-full"></div></div>').join('');
  let q = db.from('solicitudes').select('*').eq('estado', 'abierta').order('created_at', { ascending: false }).limit(200);
  if (S.user) q = q.neq('user_id', S.user.id);
  if (f.categoria) q = q.eq('categoria', f.categoria);
  if (f.departamento) q = q.eq('departamento', f.departamento);
  if (S.filtros.q) {
    const t = S.filtros.q.replace(/[%,()*"\\]/g, ' ').trim();
    if (t) q = q.or(`titulo.ilike.%${t}%,descripcion.ilike.%${t}%,municipio.ilike.%${t}%`);
  }
  const { data, error } = await q;
  if (!$('#listaSol')) return;
  if (error) { cont.innerHTML = `<p class="text-rose-600">${esc(errorMsg(error))}</p>`; return; }
  let lista = data || [];
  if (f.paraMi && S.user) {
    const cats = await misCategorias();
    lista = lista.filter((s) => cats.has(s.categoria));
  }
  if (f.distancia) lista = lista.filter((s) => { const d = distanciaA(s); return d != null && d <= f.distancia; });
  await cargarPerfiles(lista.map((s) => s.user_id));
  const conteos = new Map();
  if (lista.length) {
    const { data: c } = await db.rpc('contar_propuestas', { p_solicitudes: lista.map((s) => s.id) });
    (c || []).forEach((x) => conteos.set(x.solicitud_id, x.total));
  }
  if (!lista.length) {
    cont.innerHTML = `<div class="md:col-span-2 text-center py-14">
      <div class="text-5xl mb-3">🙌</div>
      <h3 class="font-bold text-lg">No hay solicitudes ${f.paraMi ? 'para tus categorías' : 'con estos filtros'}</h3>
      <p class="text-sm text-slate-500 mt-1">${f.paraMi ? 'Publica ofertas en más categorías para recibir más oportunidades.' : 'Vuelve pronto: aquí aparecen las personas que buscan servicios.'}</p></div>`;
    return;
  }
  cont.innerHTML = lista.map((s) => tarjetaSolicitud(s, conteos.get(s.id) || 0)).join('');
}

function tarjetaSolicitud(s, nProp = 0) {
  const u = S.perfiles.get(s.user_id) || {};
  const d = distanciaA(s);
  return `
    <article data-accion="ver-solicitud" data-id="${s.id}" class="tarjeta p-4 cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-1.5">
        ${badge(URGENCIAS[s.urgencia] || URGENCIAS.normal)}
        ${s.categoria ? `<span class="text-[11px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">${catIcono(s.categoria)} ${esc(s.categoria)}</span>` : ''}
        <span class="ml-auto text-[11px] text-slate-400">${tiempoRelativo(s.created_at)}</span>
      </div>
      <h3 class="font-bold text-slate-800 leading-snug">${esc(s.titulo)}</h3>
      <p class="text-sm text-slate-500 line-clamp-2">${esc(s.descripcion)}</p>
      <div class="flex items-center justify-between gap-2 mt-1 pt-2 border-t border-slate-50">
        <div class="flex items-center gap-2 min-w-0">
          ${avatar(u, 'w-7 h-7 text-xs')}
          <p class="text-xs text-slate-500 truncate">${esc(u.nombre || 'Usuario')} · 📍 ${esc(s.municipio || '')}${d != null ? ` · ${textoDistancia(d)}` : ''}</p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-sm font-extrabold text-emerald-700">${s.presupuesto ? fmtCOP(s.presupuesto) : 'A convenir'}</p>
          <p class="text-[10px] text-slate-400">${nProp} propuesta${nProp === 1 ? '' : 's'}</p>
        </div>
      </div>
    </article>`;
}

async function abrirSolicitud(id) {
  cerrarModalesSinVolver();
  const { data: s } = await db.from('solicitudes').select('*').eq('id', id).maybeSingle();
  if (!s) { toast('Esta solicitud ya no está disponible', 'error'); volverAVista(); return; }
  await cargarPerfiles([s.user_id]);
  const u = S.perfiles.get(s.user_id) || {};
  const esMia = S.user?.id === s.user_id;
  let miPropuesta = null;
  if (S.user && !esMia) {
    const { data } = await db.from('propuestas').select('*').eq('solicitud_id', s.id).eq('proveedor_id', S.user.id).maybeSingle();
    miPropuesta = data;
  }
  const { data: c } = await db.rpc('contar_propuestas', { p_solicitudes: [s.id] });
  const nProp = c?.[0]?.total || 0;
  const enlace = `${location.origin}${location.pathname}#solicitud=${s.id}`;
  let acciones;
  if (esMia) acciones = `<a href="#mis-solicitudes" data-cerrar class="btn btn-oscuro grow py-3">Ver propuestas (${nProp})</a>`;
  else if (!S.user) acciones = '<button data-accion="login" class="btn btn-primario grow py-3">Inicia sesión para enviar tu propuesta</button>';
  else if (s.estado !== 'abierta') acciones = '<p class="grow text-sm text-slate-500 text-center py-3">Esta solicitud ya no recibe propuestas.</p>';
  else if (miPropuesta && miPropuesta.estado !== 'retirada') acciones = `<a href="#chat=${miPropuesta.conversacion_id}" data-cerrar class="btn btn-primario grow py-3">💬 Ya enviaste propuesta · Ir al chat</a>`;
  else acciones = `<button data-accion="proponer" data-id="${s.id}" class="btn btn-verde grow py-3">💼 Enviar propuesta</button>
      <button data-accion="chatear" data-usuario="${s.user_id}" data-solicitud="${s.id}" class="btn btn-suave">💬</button>`;

  const m = modal({
    ancho: 'sm:max-w-2xl', titulo: 'Solicitud', onClose: volverAVista,
    html: `<div class="space-y-5">
      <div>
        <div class="flex flex-wrap gap-1.5 mb-2">
          ${badge(URGENCIAS[s.urgencia] || URGENCIAS.normal)}
          ${esMia ? badge(ESTADOS_SOLICITUD[s.estado]) : ''}
          <span class="text-[11px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">${s.tipo === 'producto' ? '🛍️ Busca producto' : '🧰 Busca servicio'}</span>
          ${s.categoria ? `<span class="text-[11px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">${catIcono(s.categoria)} ${esc(s.categoria)}</span>` : ''}
        </div>
        <h2 class="text-xl sm:text-2xl font-extrabold text-slate-900">${esc(s.titulo)}</h2>
        <p class="mt-2 text-sm"><span class="text-slate-500">Presupuesto:</span> <b class="text-emerald-700 text-lg">${s.presupuesto ? fmtCOP(s.presupuesto) : 'A convenir'}</b></p>
        <p class="text-xs text-slate-400 mt-1">📍 ${esc(s.municipio || '')}${s.departamento ? ', ' + esc(s.departamento) : ''} · ${tiempoRelativo(s.created_at)} · ${nProp} propuesta${nProp === 1 ? '' : 's'}${distanciaA(s) != null ? ' · ' + textoDistancia(distanciaA(s)) : ''}</p>
      </div>
      ${esMia && s.motivo_rechazo && s.estado === 'rechazada' ? `<div class="rounded-xl bg-rose-50 text-rose-800 text-sm p-3"><b>Motivo:</b> ${esc(s.motivo_rechazo)}</div>` : ''}
      <div><h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Detalles</h3>
        <p class="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">${esc(s.descripcion)}</p></div>
      <a href="#usuario=${s.user_id}" class="flex items-center gap-3 p-3 rounded-2xl border border-slate-100 hover:bg-slate-50">
        ${avatar(u, 'w-11 h-11')}
        <div class="grow min-w-0"><p class="font-bold truncate">${esc(u.nombre || 'Usuario')} ${u.verificado ? '<span class="text-sky-500">✔</span>' : ''}</p>
        <p class="text-xs text-slate-500">${u.num_resenas ? `★ ${u.calificacion} (${u.num_resenas})` : 'Sin calificaciones aún'}</p></div><span class="text-slate-300">›</span>
      </a>
      <div><h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Zona</h3>${htmlZona(s, 'Quien solicita está dentro de esta área.')}</div>
    </div>`,
    pie: `<div class="flex gap-2">${acciones}
      <button data-accion="compartir" data-url="${esc(enlace)}" data-titulo="${esc(s.titulo)}" class="btn btn-suave">🔗</button>
      ${S.user && !esMia ? `<button data-accion="reportar" data-entidad="solicitud" data-id="${s.id}" class="btn btn-suave text-slate-500">⚑</button>` : ''}</div>`,
  });
  activarMapas(m.el);
  if (!esMia) db.rpc('sumar_vista', { p_entidad: 'solicitud', p_id: s.id });
}

function formularioPropuesta(solicitudId) {
  if (!S.user) return abrirAuth('login');
  const m = modal({
    titulo: '💼 Enviar propuesta', ancho: 'sm:max-w-md',
    html: `<form class="space-y-4">
      <div><label class="etiqueta">Tu precio (COP) <span class="font-normal text-slate-400">opcional</span></label>
        <input name="precio" inputmode="numeric" class="campo font-bold" placeholder="Ej. 80.000"></div>
      <div><label class="etiqueta">Mensaje</label>
        <textarea name="mensaje" rows="5" maxlength="1500" required class="campo resize-none" placeholder="Cuéntale tu experiencia, cuándo puedes, qué incluye tu precio…"></textarea></div>
      <p class="text-xs text-slate-500">Se abrirá un chat con la persona para acordar los detalles.</p>
      <button class="btn btn-verde w-full py-3">Enviar propuesta</button></form>`,
  });
  const f = m.el.querySelector('form');
  mascaraPrecio(f.precio);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true; btn.textContent = 'Enviando…';
    const { data, error } = await db.rpc('enviar_propuesta', { p_solicitud: solicitudId, p_mensaje: f.mensaje.value.trim(), p_precio: leerPrecio(f.precio.value) });
    btn.disabled = false; btn.textContent = 'Enviar propuesta';
    if (error) return toast(errorMsg(error), 'error');
    m.cerrar();
    toast('¡Propuesta enviada! 🎉', 'ok');
    location.hash = `#chat=${data}`;
  };
}

async function formularioSolicitud(id = null) {
  if (!S.user) return abrirAuth('login');
  cerrarTodosLosModales();
  let s = null;
  if (id) {
    const { data } = await db.from('solicitudes').select('*').eq('id', id).single();
    s = data;
  }
  const m = modal({
    titulo: s ? 'Editar solicitud' : '🙋 ¿Qué necesitas?', ancho: 'sm:max-w-xl',
    html: `<form class="space-y-4">
      <div class="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
        ${[['servicio', '🧰 Un servicio'], ['producto', '🛍️ Un producto']].map(([v, t]) => `
          <label class="cursor-pointer"><input type="radio" name="tipo" value="${v}" class="peer sr-only" ${(s?.tipo || 'servicio') === v ? 'checked' : ''}>
          <span class="block text-center py-2 rounded-lg text-sm font-bold text-slate-500 peer-checked:bg-white peer-checked:text-emerald-700 peer-checked:shadow">${t}</span></label>`).join('')}
      </div>
      <div><label class="etiqueta">¿Qué necesitas?</label><input name="titulo" maxlength="120" required class="campo" placeholder="Ej. Necesito un electricista para revisar un corto" value="${esc(s?.titulo || '')}"></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label class="etiqueta">Categoría</label><select name="categoria" required class="campo"></select></div>
        <div><label class="etiqueta">Presupuesto (COP) <span class="font-normal text-slate-400">opcional</span></label><input name="presupuesto" inputmode="numeric" class="campo font-bold" placeholder="Ej. 100.000" value="${s?.presupuesto ? fmtNum(s.presupuesto) : ''}"></div>
      </div>
      <div><label class="etiqueta">¿Para cuándo?</label>
        <div class="grid grid-cols-3 gap-2">
          ${Object.entries(URGENCIAS).map(([k, [t]]) => `<label class="cursor-pointer"><input type="radio" name="urgencia" value="${k}" class="peer sr-only" ${(s?.urgencia || 'normal') === k ? 'checked' : ''}><span class="block text-center py-2 rounded-xl border border-slate-200 text-xs sm:text-sm font-semibold text-slate-600 peer-checked:border-emerald-500 peer-checked:bg-emerald-50 peer-checked:text-emerald-800">${t}</span></label>`).join('')}
        </div></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="etiqueta">Departamento</label><select name="depto" required class="campo"></select></div>
        <div><label class="etiqueta">Municipio</label><select name="mun" required class="campo"></select></div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1"><label class="etiqueta !mb-0">Describe lo que necesitas</label>${campoIA('solicitud')}</div>
        <textarea name="descripcion" rows="5" maxlength="2000" required class="campo resize-y" placeholder="Detalles, medidas, horario, cualquier cosa que ayude a los proveedores a darte un buen precio…">${esc(s?.descripcion || '')}</textarea>
      </div>
      ${s ? '' : estadoUbicacionHtml()}
      <button data-enviar class="btn btn-verde w-full py-3 text-base">${s ? 'Guardar cambios' : 'Publicar solicitud'}</button>
    </form>`,
  });
  const f = m.el.querySelector('form');
  mascaraPrecio(f.presupuesto);
  llenarSelectDepartamentos(f.depto, f.mun, { depto: s?.departamento || S.perfil?.departamento || '', mun: s?.municipio || S.perfil?.municipio || '' });
  const llenarCats = () => {
    const tipo = f.querySelector('[name="tipo"]:checked').value;
    const actual = f.categoria.value || s?.categoria || '';
    f.categoria.innerHTML = '<option value="">Elige…</option>' + categoriasPara(tipo).map((c) => `<option value="${esc(c.nombre)}" ${c.nombre === actual ? 'selected' : ''}>${c.icono} ${esc(c.nombre)}</option>`).join('');
  };
  llenarCats();
  $$('[name="tipo"]', f).forEach((r) => (r.onchange = llenarCats));
  $('[data-ia]', f).onclick = (e) => mejorarConIA(f, 'solicitud', e.currentTarget);

  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.categoria.value) return toast('Elige una categoría', 'aviso');
    if (!f.mun.value) return toast('Elige el municipio', 'aviso');
    if (f.titulo.value.trim().length < 4) return toast('Cuéntanos qué necesitas en el título', 'aviso');
    if (f.descripcion.value.trim().length < 5) return toast('Agrega una descripción', 'aviso');
    const btn = f.querySelector('[data-enviar]');
    btn.disabled = true;
    try {
      if (!s) {
        btn.textContent = '📍 Verificando ubicación…';
        const ok = await asegurarUbicacion('solicitud');
        if (!ok && S.config.requerir_ubicacion !== false) throw Object.assign(new Error('UBICACION'), { silencio: true });
      }
      btn.textContent = 'Publicando…';
      const datos = {
        tipo: f.querySelector('[name="tipo"]:checked').value,
        titulo: f.titulo.value.trim(),
        categoria: f.categoria.value,
        presupuesto: leerPrecio(f.presupuesto.value),
        urgencia: f.querySelector('[name="urgencia"]:checked').value,
        departamento: f.depto.value,
        municipio: f.mun.value,
        descripcion: f.descripcion.value.trim(),
      };
      const r = s
        ? await db.from('solicitudes').update(datos).eq('id', s.id).select('id, estado').single()
        : await db.from('solicitudes').insert(datos).select('id, estado').single();
      if (r.error) throw r.error;
      m.cerrar();
      if (r.data.estado === 'pendiente') {
        llamarFuncion(db, 'ia', { accion: 'moderar', entidad: 'solicitud', id: r.data.id })
          .then((x) => { if (x.auto_aprobado) toast('¡Tu solicitud ya está publicada! 🎉', 'ok'); }).catch(() => {});
      } else {
        llamarFuncion(db, 'ia', { accion: 'moderar', entidad: 'solicitud', id: r.data.id }).catch(() => {});
      }
      exitoPublicacion(r.data.estado, 'solicitud', r.data.id);
      if (S.vista === 'mis-solicitudes') vistaMisSolicitudes();
    } catch (ex) {
      if (ex.silencio) return;
      if (codigoError(ex) === 'UBICACION_REQUERIDA') ayudaUbicacion(S.permisoUbic === 'denied');
      else toast(errorMsg(ex), 'error');
    } finally {
      btn.disabled = false; btn.textContent = s ? 'Guardar cambios' : 'Publicar solicitud';
    }
  };
}

// ======================================================================
// MIS PUBLICACIONES
// ======================================================================
function tituloSeccion(titulo, sub = '', extra = '') {
  return `<div class="mt-6 mb-5 flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="text-2xl font-extrabold tracking-tight">${titulo}</h1>${sub ? `<p class="text-sm text-slate-500 mt-0.5">${sub}</p>` : ''}</div>${extra}</div>`;
}

async function vistaMisPublicaciones() {
  app.innerHTML = tituloSeccion('📦 Mis publicaciones', 'Administra tus ofertas', '<button data-accion="nueva-oferta" class="btn btn-primario">＋ Nueva oferta</button>') + '<div id="misPub" class="space-y-3">' + esqueletos(3) + '</div>';
  const { data, error } = await db.from('anuncios').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false });
  const cont = $('#misPub');
  if (!cont) return;
  if (error) { cont.innerHTML = `<p class="text-rose-600">${esc(errorMsg(error))}</p>`; return; }
  const lista = data || [];
  const stats = {
    total: lista.length,
    visibles: lista.filter((a) => a.estado === 'aprobado').length,
    revision: lista.filter((a) => a.estado === 'pendiente').length,
    vistas: lista.reduce((s, a) => s + (a.vistas || 0), 0),
  };
  cont.className = 'space-y-3';
  cont.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
      ${[['Publicaciones', stats.total], ['Visibles', stats.visibles], ['En revisión', stats.revision], ['Vistas totales', stats.vistas]]
        .map(([t, v]) => `<div class="tarjeta p-4"><p class="text-xs text-slate-500">${t}</p><p class="text-2xl font-extrabold mt-1">${fmtNum(v)}</p></div>`).join('')}
    </div>
    ${lista.length ? lista.map((a) => {
      const img = parseImagenes(a.imagen_urls)[0];
      return `<div class="tarjeta p-3 flex gap-3">
        <img src="${esc(img)}" class="w-24 h-24 sm:w-28 sm:h-28 rounded-xl object-cover shrink-0 cursor-pointer" data-accion="ver-anuncio" data-id="${a.id}">
        <div class="min-w-0 grow flex flex-col">
          <div class="flex flex-wrap items-center gap-1.5">${badge(ESTADOS_ANUNCIO[a.estado])}<span class="text-[11px] text-slate-400">${tiempoRelativo(a.created_at)} · 👁 ${fmtNum(a.vistas)}</span></div>
          <h3 class="font-bold text-slate-800 line-clamp-1 mt-1">${esc(a.titulo)}</h3>
          <p class="text-sm font-extrabold text-indigo-600">${precioTexto(a.precio, a.precio_negociable)}</p>
          ${a.estado === 'rechazado' && a.motivo_rechazo ? `<p class="text-xs text-rose-700 mt-1">Motivo: ${esc(a.motivo_rechazo)}</p>` : ''}
          ${a.estado === 'pendiente' ? '<p class="text-xs text-amber-700 mt-1">Te avisaremos cuando sea aprobada.</p>' : ''}
          <div class="mt-auto pt-2 flex flex-wrap gap-1.5">
            <button data-accion="editar-oferta" data-id="${a.id}" class="btn btn-suave !py-1.5 !px-3 text-xs">✏️ Editar</button>
            ${a.estado === 'aprobado' ? `<button data-accion="estado-oferta" data-id="${a.id}" data-estado="pausado" class="btn btn-suave !py-1.5 !px-3 text-xs">⏸ Pausar</button>
              <button data-accion="estado-oferta" data-id="${a.id}" data-estado="vendido" class="btn btn-suave !py-1.5 !px-3 text-xs">✅ Vendido</button>` : ''}
            ${['pausado', 'vendido'].includes(a.estado) && a.aprobado_at ? `<button data-accion="estado-oferta" data-id="${a.id}" data-estado="aprobado" class="btn btn-suave !py-1.5 !px-3 text-xs">▶️ Reactivar</button>` : ''}
            <button data-accion="eliminar-oferta" data-id="${a.id}" class="btn btn-rojo !py-1.5 !px-3 text-xs">🗑 Eliminar</button>
          </div>
        </div></div>`;
    }).join('') : `<div class="text-center py-14 tarjeta"><div class="text-5xl mb-3">📦</div><h3 class="font-bold">Aún no tienes publicaciones</h3>
      <p class="text-sm text-slate-500 mt-1 mb-4">Publica gratis tu primer producto o servicio.</p><button data-accion="nueva-oferta" class="btn btn-primario">＋ Publicar ahora</button></div>`}`;
}

async function cambiarEstadoOferta(id, estado) {
  const { data, error } = await db.from('anuncios').update({ estado }).eq('id', id).select('estado').single();
  if (error) return toast(errorMsg(error), 'error');
  if (data.estado !== estado) toast('No se pudo cambiar el estado en este momento', 'aviso');
  else toast({ pausado: 'Publicación pausada', vendido: '¡Felicitaciones por tu venta! 🎉', aprobado: 'Publicación reactivada' }[estado], 'ok');
  vistaMisPublicaciones();
}

async function eliminarOferta(id) {
  if (!(await confirmar('La publicación se eliminará de forma permanente.', { titulo: '¿Eliminar publicación?', ok: 'Eliminar', peligro: true }))) return;
  const { data: a } = await db.from('anuncios').select('imagen_urls').eq('id', id).single();
  const { error } = await db.from('anuncios').delete().eq('id', id);
  if (error) return toast(errorMsg(error), 'error');
  const rutas = parseImagenes(a?.imagen_urls).map((u) => u.split('/imagenes/')[1]).filter((r) => r && r.startsWith(S.user.id + '/'));
  if (rutas.length) db.storage.from('imagenes').remove(rutas);
  toast('Publicación eliminada', 'ok');
  vistaMisPublicaciones();
}

// ======================================================================
// MIS SOLICITUDES
// ======================================================================
async function vistaMisSolicitudes() {
  app.innerHTML = tituloSeccion('🙋 Mis solicitudes', 'Revisa y responde las propuestas que recibes', '<button data-accion="nueva-solicitud" class="btn btn-verde">＋ Nueva solicitud</button>') + '<div id="misSol" class="space-y-4">' + esqueletos(2) + '</div>';
  const { data: sols } = await db.from('solicitudes').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false });
  const cont = $('#misSol');
  if (!cont) return;
  const lista = sols || [];
  if (!lista.length) {
    cont.innerHTML = `<div class="text-center py-14 tarjeta"><div class="text-5xl mb-3">🙋</div><h3 class="font-bold">No has publicado solicitudes</h3>
      <p class="text-sm text-slate-500 mt-1 mb-4">Cuéntanos qué necesitas y los proveedores cercanos te enviarán propuestas.</p>
      <button data-accion="nueva-solicitud" class="btn btn-verde">Publicar lo que necesito</button></div>`;
    return;
  }
  const { data: props } = await db.from('propuestas').select('*').in('solicitud_id', lista.map((s) => s.id)).neq('estado', 'retirada').order('created_at', { ascending: false });
  await cargarPerfiles((props || []).map((p) => p.proveedor_id));
  cont.innerHTML = lista.map((s) => {
    const ps = (props || []).filter((p) => p.solicitud_id === s.id);
    return `<section class="tarjeta overflow-hidden">
      <div class="p-4 flex flex-wrap gap-3 justify-between items-start">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-1.5">${badge(ESTADOS_SOLICITUD[s.estado])}${badge(URGENCIAS[s.urgencia])}<span class="text-[11px] text-slate-400">${tiempoRelativo(s.created_at)} · 👁 ${fmtNum(s.vistas)}</span></div>
          <h3 class="font-bold text-slate-800 mt-1 cursor-pointer hover:text-indigo-600" data-accion="ver-solicitud" data-id="${s.id}">${esc(s.titulo)}</h3>
          <p class="text-sm text-slate-500">${s.presupuesto ? 'Presupuesto ' + fmtCOP(s.presupuesto) : 'Presupuesto a convenir'} · 📍 ${esc(s.municipio || '')}</p>
          ${s.estado === 'rechazada' && s.motivo_rechazo ? `<p class="text-xs text-rose-700 mt-1">Motivo: ${esc(s.motivo_rechazo)}</p>` : ''}
          ${s.estado === 'pendiente' ? '<p class="text-xs text-amber-700 mt-1">En revisión. Te avisaremos cuando se publique.</p>' : ''}
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button data-accion="editar-solicitud" data-id="${s.id}" class="btn btn-suave !py-1.5 !px-3 text-xs">✏️ Editar</button>
          ${['abierta', 'asignada', 'pendiente'].includes(s.estado) ? `<button data-accion="estado-solicitud" data-id="${s.id}" data-estado="cerrada" class="btn btn-suave !py-1.5 !px-3 text-xs">🔒 Cerrar</button>` : ''}
          ${s.estado === 'cerrada' ? `<button data-accion="estado-solicitud" data-id="${s.id}" data-estado="abierta" class="btn btn-suave !py-1.5 !px-3 text-xs">🔓 Reabrir</button>` : ''}
          <button data-accion="eliminar-solicitud" data-id="${s.id}" class="btn btn-rojo !py-1.5 !px-3 text-xs">🗑</button>
        </div>
      </div>
      <div class="border-t border-slate-100 bg-slate-50/60 p-4">
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Propuestas recibidas (${ps.length})</h4>
        ${ps.length ? `<div class="space-y-2">${ps.map((p) => {
          const pr = S.perfiles.get(p.proveedor_id) || {};
          return `<div class="bg-white rounded-xl border ${p.estado === 'aceptada' ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-slate-100'} p-3">
            <div class="flex items-center gap-3">
              <a href="#usuario=${p.proveedor_id}">${avatar(pr, 'w-10 h-10')}</a>
              <div class="grow min-w-0">
                <a href="#usuario=${p.proveedor_id}" class="font-bold text-sm hover:underline">${esc(pr.nombre || 'Proveedor')} ${pr.verificado ? '<span class="text-sky-500">✔</span>' : ''}</a>
                <p class="text-xs text-slate-500">${pr.num_resenas ? `★ ${pr.calificacion} (${pr.num_resenas})` : 'Nuevo'} · ${tiempoRelativo(p.created_at)}</p>
              </div>
              <div class="text-right"><p class="font-extrabold text-emerald-700">${p.precio ? fmtCOP(p.precio) : 'A convenir'}</p>${p.estado !== 'enviada' ? badge(p.estado === 'aceptada' ? ['Aceptada', 'bg-emerald-100 text-emerald-800'] : ['No seleccionada', 'bg-slate-100 text-slate-600']) : ''}</div>
            </div>
            <p class="text-sm text-slate-600 mt-2 whitespace-pre-wrap">${esc(p.mensaje)}</p>
            <div class="flex flex-wrap gap-1.5 mt-3">
              ${p.conversacion_id ? `<a href="#chat=${p.conversacion_id}" class="btn btn-primario !py-1.5 !px-3 text-xs">💬 Chatear</a>` : ''}
              ${p.estado === 'enviada' && s.estado === 'abierta' ? `
                <button data-accion="responder-propuesta" data-id="${p.id}" data-aceptar="1" class="btn btn-verde !py-1.5 !px-3 text-xs">✅ Aceptar</button>
                <button data-accion="responder-propuesta" data-id="${p.id}" data-aceptar="0" class="btn btn-suave !py-1.5 !px-3 text-xs">No, gracias</button>` : ''}
            </div></div>`;
        }).join('')}</div>` : `<p class="text-sm text-slate-500">${s.estado === 'abierta' ? 'Aún no hay propuestas. Avisamos a los proveedores de tu zona; te notificaremos cuando llegue una.' : 'Sin propuestas.'}</p>`}
      </div></section>`;
  }).join('');
}

async function responderPropuesta(id, aceptar) {
  if (aceptar && !(await confirmar('Al aceptar, tu solicitud quedará asignada a este proveedor y dejará de recibir propuestas.', { titulo: '¿Aceptar propuesta?', ok: 'Aceptar' }))) return;
  const { error } = await db.rpc('responder_propuesta', { p_propuesta: id, p_aceptar: aceptar });
  if (error) return toast(errorMsg(error), 'error');
  toast(aceptar ? '¡Propuesta aceptada! Coordina por el chat 🤝' : 'Propuesta rechazada', 'ok');
  vistaMisSolicitudes();
}

async function cambiarEstadoSolicitud(id, estado) {
  const { data, error } = await db.from('solicitudes').update({ estado }).eq('id', id).select('estado').single();
  if (error) return toast(errorMsg(error), 'error');
  toast(data.estado === 'cerrada' ? 'Solicitud cerrada' : data.estado === 'abierta' ? 'Solicitud reabierta' : 'Enviada a revisión', 'ok');
  vistaMisSolicitudes();
}

async function eliminarSolicitud(id) {
  if (!(await confirmar('Se eliminarán la solicitud y sus propuestas.', { titulo: '¿Eliminar solicitud?', ok: 'Eliminar', peligro: true }))) return;
  const { error } = await db.from('solicitudes').delete().eq('id', id);
  if (error) return toast(errorMsg(error), 'error');
  toast('Solicitud eliminada', 'ok');
  vistaMisSolicitudes();
}

// ======================================================================
// FAVORITOS
// ======================================================================
async function vistaFavoritos() {
  app.innerHTML = tituloSeccion('❤️ Favoritos', 'Las ofertas que guardaste') + `<div id="feed" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">${esqueletos(4)}</div>`;
  const { data } = await db.from('favoritos').select(`created_at, anuncios(${COLS_ANUNCIO_SESION})`).eq('user_id', S.user.id).order('created_at', { ascending: false });
  const lista = (data || []).map((f) => f.anuncios).filter((a) => a && a.estado === 'aprobado');
  S.anuncios = lista;
  await cargarPerfiles(lista.map((a) => a.user_id));
  const feed = $('#feed');
  if (!feed) return;
  feed.innerHTML = lista.length ? lista.map(tarjetaAnuncio).join('')
    : '<div class="col-span-full text-center py-14"><div class="text-5xl mb-3">🤍</div><p class="font-bold">Aún no tienes favoritos</p><p class="text-sm text-slate-500 mt-1">Toca el ♡ en una oferta para guardarla.</p><a href="#inicio" class="btn btn-primario mt-4">Explorar ofertas</a></div>';
}

// ======================================================================
// MENSAJES / CHAT
// ======================================================================
async function iniciarChat(usuarioId, anuncioId = null, solicitudId = null) {
  if (!S.user) return abrirAuth('login');
  const { data, error } = await db.rpc('iniciar_conversacion', { p_otro: usuarioId, p_anuncio: anuncioId, p_solicitud: solicitudId });
  if (error) return toast(errorMsg(error), 'error');
  cerrarTodosLosModales();
  location.hash = `#chat=${data}`;
}

async function vistaMensajes(convId = null) {
  const { ruta } = leerHash();
  if (ruta !== 'chat') convId = null;
  S.chatAbierto = convId;
  app.innerHTML = `
    <div class="mt-4 md:mt-6 tarjeta overflow-hidden grid md:grid-cols-[340px_1fr] h-[calc(100vh-190px)] md:h-[calc(100vh-150px)] min-h-[460px]">
      <aside class="${convId ? 'hidden md:flex' : 'flex'} flex-col border-r border-slate-100 min-h-0">
        <div class="p-4 border-b border-slate-100"><h1 class="text-lg font-extrabold">💬 Mensajes</h1></div>
        <div id="listaConv" class="overflow-y-auto grow"></div>
      </aside>
      <section id="panelChat" class="${convId ? 'flex' : 'hidden md:flex'} flex-col min-h-0 bg-slate-50">
        ${convId ? '' : '<div class="grow grid place-items-center text-center p-8 text-slate-400"><div><div class="text-5xl mb-2">💬</div><p>Elige una conversación</p></div></div>'}
      </section>
    </div>`;
  await renderListaConversaciones();
  if (convId) await abrirConversacion(convId);
}

async function renderListaConversaciones() {
  const cont = $('#listaConv');
  if (!cont) return;
  const uid = S.user.id;
  const { data } = await db.from('conversaciones').select('*').or(`usuario_a.eq.${uid},usuario_b.eq.${uid}`).order('ultimo_mensaje_at', { ascending: false });
  const convs = data || [];
  await cargarPerfiles(convs.map((c) => (c.usuario_a === uid ? c.usuario_b : c.usuario_a)));
  if (!$('#listaConv')) return;
  if (!convs.length) {
    cont.innerHTML = '<div class="p-8 text-center text-sm text-slate-500">No tienes conversaciones todavía.<br>Escribe a un vendedor desde una oferta o envía una propuesta.</div>';
    return;
  }
  cont.innerHTML = convs.map((c) => {
    const otro = S.perfiles.get(c.usuario_a === uid ? c.usuario_b : c.usuario_a) || { nombre: 'Usuario' };
    const n = S.noLeidosChat.get(c.id) || 0;
    return `<a href="#chat=${c.id}" class="flex items-center gap-3 px-4 py-3 border-b border-slate-50 hover:bg-slate-50 ${S.chatAbierto === c.id ? 'bg-indigo-50/60' : ''}">
      ${avatar(otro, 'w-11 h-11')}
      <div class="min-w-0 grow">
        <div class="flex justify-between gap-2"><p class="font-bold text-sm truncate">${esc(otro.nombre)}</p><span class="text-[10px] text-slate-400 shrink-0">${tiempoRelativo(c.ultimo_mensaje_at)}</span></div>
        <p class="text-xs truncate ${n ? 'text-slate-800 font-semibold' : 'text-slate-500'}">${c.ultimo_emisor === uid ? 'Tú: ' : ''}${esc(c.ultimo_mensaje || '')}</p>
      </div>
      ${n ? `<span class="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold grid place-items-center">${n}</span>` : ''}
    </a>`;
  }).join('');
}

async function abrirConversacion(convId) {
  const panel = $('#panelChat');
  const { data: c } = await db.from('conversaciones').select('*').eq('id', convId).maybeSingle();
  if (!c) { panel.innerHTML = '<p class="p-8 text-slate-500">Conversación no encontrada.</p>'; return; }
  const uid = S.user.id;
  const otroId = c.usuario_a === uid ? c.usuario_b : c.usuario_a;
  await cargarPerfiles([otroId]);
  const otro = S.perfiles.get(otroId) || { nombre: 'Usuario' };
  const { data: puede } = await db.rpc('puede_resenar', { p_usuario: otroId });
  panel.innerHTML = `
    <header class="flex items-center gap-3 px-3 sm:px-4 py-3 bg-white border-b border-slate-100 shrink-0">
      <a href="#mensajes" class="md:hidden w-9 h-9 grid place-items-center rounded-full hover:bg-slate-100">‹</a>
      <a href="#usuario=${otroId}" class="flex items-center gap-3 min-w-0 grow">
        ${avatar(otro, 'w-10 h-10')}
        <div class="min-w-0"><p class="font-bold text-sm truncate">${esc(otro.nombre)} ${otro.verificado ? '<span class="text-sky-500">✔</span>' : ''}</p>
        <p class="text-[11px] text-slate-400">${otro.ultima_conexion ? 'Activo ' + tiempoRelativo(otro.ultima_conexion) : ''}</p></div>
      </a>
      ${puede ? `<button data-accion="resenar" data-usuario="${otroId}" class="btn btn-suave !py-1.5 !px-3 text-xs">⭐ Calificar</button>` : ''}
      <button data-accion="reportar" data-entidad="conversacion" data-id="${c.id}" class="w-9 h-9 grid place-items-center rounded-full hover:bg-slate-100 text-slate-400" title="Reportar">⚑</button>
    </header>
    <div id="mensajes" class="grow overflow-y-auto px-3 sm:px-5 py-4 space-y-2"></div>
    <form id="fMsj" class="p-3 bg-white border-t border-slate-100 flex gap-2 items-end shrink-0">
      <textarea name="texto" rows="1" maxlength="2000" class="campo resize-none max-h-32" placeholder="Escribe un mensaje…"></textarea>
      <button class="btn btn-primario h-11 w-11 !p-0 shrink-0 text-lg" aria-label="Enviar">➤</button>
    </form>`;
  const { data: msjs } = await db.from('mensajes').select('*').eq('conversacion_id', convId).order('created_at').limit(500);
  const cont = $('#mensajes');
  cont.innerHTML = (msjs || []).map(burbuja).join('') || '<p class="text-center text-xs text-slate-400 py-8">Saluda y empieza la conversación 👋</p>';
  cont.scrollTop = cont.scrollHeight;
  const f = $('#fMsj');
  const ta = f.texto;
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 128) + 'px'; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) { e.preventDefault(); f.requestSubmit(); } });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const texto = ta.value.trim();
    if (!texto) return;
    ta.value = ''; ta.style.height = 'auto';
    const { data, error } = await db.from('mensajes').insert({ conversacion_id: convId, emisor_id: uid, texto }).select().single();
    if (error) { ta.value = texto; return toast(errorMsg(error), 'error'); }
    agregarMensaje(data);
    renderListaConversaciones();
  };
  if (window.innerWidth > 768) ta.focus();
  await db.rpc('marcar_leidos', { p_conv: convId });
  S.noLeidosChat.delete(convId);
  actualizarBadges();
  renderListaConversaciones();
}

function burbuja(m) {
  const mio = m.emisor_id === S.user?.id;
  if (m.tipo === 'contexto' || m.tipo === 'sistema') {
    const enlace = m.anuncio_id ? `#anuncio=${m.anuncio_id}` : m.solicitud_id ? `#solicitud=${m.solicitud_id}` : null;
    return `<div class="flex justify-center my-3" data-msj="${m.id}"><${enlace ? `a href="${enlace}"` : 'div'} class="text-xs bg-white border border-slate-200 rounded-full px-3 py-1.5 text-slate-600 hover:bg-slate-50 max-w-[90%] truncate">${m.tipo === 'contexto' ? '📌 ' : ''}${esc(m.texto)}</${enlace ? 'a' : 'div'}></div>`;
  }
  const esProp = m.tipo === 'propuesta';
  return `<div class="flex ${mio ? 'justify-end' : 'justify-start'}" data-msj="${m.id}">
    <div class="max-w-[80%] px-3.5 py-2 text-sm shadow-sm ${mio ? 'burbuja-yo' : 'burbuja-otro'} ${esProp ? 'ring-2 ring-emerald-300' : ''}">
      <p class="whitespace-pre-wrap break-words">${esc(m.texto)}</p>
      <p class="text-[10px] mt-1 text-right ${mio ? 'text-indigo-200' : 'text-slate-400'}">${new Date(m.created_at).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}${mio ? (m.leido_at ? ' ✓✓' : ' ✓') : ''}</p>
    </div></div>`;
}

function agregarMensaje(m) {
  const cont = $('#mensajes');
  if (!cont || $(`[data-msj="${m.id}"]`, cont)) return;
  const vacio = cont.querySelector('p.text-center');
  if (vacio && !cont.querySelector('[data-msj]')) vacio.remove();
  const cerca = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 150;
  cont.insertAdjacentHTML('beforeend', burbuja(m));
  if (cerca || m.emisor_id === S.user?.id) cont.scrollTop = cont.scrollHeight;
}

// ======================================================================
// NOTIFICACIONES Y TIEMPO REAL
// ======================================================================
async function contarPendientes() {
  if (!S.user) return;
  const [{ count }, { data: chats }] = await Promise.all([
    db.from('notificaciones').select('id', { count: 'exact', head: true }).eq('user_id', S.user.id).eq('leida', false).neq('tipo', 'mensaje'),
    db.rpc('mis_no_leidos'),
  ]);
  S.noLeidasNotif = count || 0;
  S.noLeidosChat = new Map((chats || []).map((c) => [c.conversacion_id, c.total]));
  actualizarBadges();
}

function iniciarRealtime() {
  if (!S.user) return;
  const uid = S.user.id;
  S.canal = db.channel('usuario-' + uid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: `user_id=eq.${uid}` }, ({ new: n }) => {
      if (n.tipo === 'mensaje') return; // los mensajes tienen su propio contador
      S.noLeidasNotif++;
      actualizarBadges();
      toast(n.titulo, 'aviso', 5000);
      notificarNavegador(n.titulo, n.cuerpo, n.enlace);
      if (n.tipo.startsWith('anuncio_') && S.vista === 'mis-publicaciones') vistaMisPublicaciones();
      if (n.tipo.startsWith('propuesta') && S.vista === 'mis-solicitudes') vistaMisSolicitudes();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, async ({ new: m }) => {
      if (S.chatAbierto === m.conversacion_id) {
        agregarMensaje(m);
        if (m.emisor_id !== uid) db.rpc('marcar_leidos', { p_conv: m.conversacion_id });
      } else if (m.emisor_id !== uid) {
        S.noLeidosChat.set(m.conversacion_id, (S.noLeidosChat.get(m.conversacion_id) || 0) + 1);
        actualizarBadges();
        await cargarPerfiles([m.emisor_id]);
        const nombre = S.perfiles.get(m.emisor_id)?.nombre || 'Alguien';
        if (!['mensajes', 'chat'].includes(S.vista)) toast(`💬 ${nombre}: ${m.texto.slice(0, 60)}`, 'info', 4500);
        notificarNavegador(`Mensaje de ${nombre}`, m.texto, `#chat=${m.conversacion_id}`);
      }
      if (['mensajes', 'chat'].includes(S.vista)) renderListaConversaciones();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mensajes' }, ({ new: m }) => {
      if (S.chatAbierto === m.conversacion_id && m.emisor_id === uid && m.leido_at) {
        const el = $(`[data-msj="${m.id}"]`);
        if (el) el.outerHTML = burbuja(m);
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets_mensajes' }, ({ new: tm }) => {
      if (S.ticketAbierto === tm.ticket_id) agregarMensajeTicket(tm);
    })
    .subscribe();
}

function detenerRealtime() {
  if (S.canal) db.removeChannel(S.canal);
  S.canal = null;
}

function notificarNavegador(titulo, cuerpo, enlace) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(titulo, { body: cuerpo || '', icon: 'assets/img/logo-192.png', tag: enlace || titulo });
    n.onclick = () => { window.focus(); if (enlace) location.hash = enlace; n.close(); };
  } catch { /* algunos navegadores móviles no lo permiten */ }
}

async function panelNotificaciones() {
  const m = modal({ titulo: '🔔 Notificaciones', ancho: 'sm:max-w-md', sinPadding: true, html: '<div id="listaNotif" class="divide-y divide-slate-50"><p class="p-6 text-center text-slate-400 text-sm">Cargando…</p></div>',
    pie: '<div class="flex gap-2"><button data-accion="leer-todas" class="btn btn-suave grow text-xs">✓ Marcar todas como leídas</button><a href="#notificaciones" data-cerrar class="btn btn-suave grow text-xs">Ver todas</a></div>' });
  await renderNotificaciones($('#listaNotif', m.el), 30);
}

async function renderNotificaciones(cont, limite = 100) {
  const { data } = await db.from('notificaciones').select('*').eq('user_id', S.user.id).neq('tipo', 'mensaje').order('created_at', { ascending: false }).limit(limite);
  const iconos = { anuncio_aprobado: '✅', anuncio_rechazado: '❌', anuncio_pausado: '⏸', solicitud_nueva: '🙋', solicitud_aprobada: '✅', solicitud_rechazada: '❌', propuesta: '💼', propuesta_aceptada: '🤝', propuesta_rechazada: '📭', soporte: '🛟', resena: '⭐', aviso: '📢' };
  cont.innerHTML = (data || []).length ? data.map((n) => `
    <a href="${esc(n.enlace || '#inicio')}" data-accion="abrir-notif" data-id="${n.id}" class="flex gap-3 px-4 py-3 hover:bg-slate-50 ${n.leida ? '' : 'bg-indigo-50/50'}">
      <span class="text-xl shrink-0">${iconos[n.tipo] || '🔔'}</span>
      <div class="min-w-0 grow"><p class="text-sm ${n.leida ? 'text-slate-700' : 'font-bold text-slate-900'}">${esc(n.titulo)}</p>
      ${n.cuerpo ? `<p class="text-xs text-slate-500 line-clamp-2">${esc(n.cuerpo)}</p>` : ''}
      <p class="text-[10px] text-slate-400 mt-0.5">${tiempoRelativo(n.created_at)}</p></div>
      ${n.leida ? '' : '<span class="w-2 h-2 rounded-full bg-indigo-600 mt-2 shrink-0"></span>'}
    </a>`).join('') : '<div class="p-10 text-center text-slate-400"><div class="text-4xl mb-2">🔕</div><p class="text-sm">No tienes notificaciones</p></div>';
}

async function vistaNotificaciones() {
  app.innerHTML = tituloSeccion('🔔 Notificaciones', '', `<div class="flex gap-2">
      ${'Notification' in window && Notification.permission !== 'granted' ? '<button data-accion="permiso-notif" class="btn btn-suave text-xs">Activar en este dispositivo</button>' : ''}
      <button data-accion="leer-todas" class="btn btn-suave text-xs">✓ Marcar todas como leídas</button></div>`) +
    '<div id="listaNotif" class="tarjeta overflow-hidden divide-y divide-slate-50"></div>';
  await renderNotificaciones($('#listaNotif'));
}

async function marcarTodasLeidas() {
  await db.from('notificaciones').update({ leida: true }).eq('user_id', S.user.id).eq('leida', false);
  S.noLeidasNotif = 0;
  actualizarBadges();
  $$('#listaNotif .bg-indigo-50\\/50').forEach((el) => el.classList.remove('bg-indigo-50/50'));
  $$('#listaNotif .font-bold').forEach((el) => el.classList.replace('font-bold', 'text-slate-700'));
  $$('#listaNotif span.rounded-full.bg-indigo-600').forEach((el) => el.remove());
}

// ======================================================================
// PERFIL
// ======================================================================
async function vistaPerfil() {
  const { data: p } = await db.from('perfiles').select('*').eq('id', S.user.id).single();
  S.perfil = p || S.perfil;
  const { data: pub } = await db.from('perfiles_publicos').select('calificacion, num_resenas').eq('id', S.user.id).maybeSingle();
  const { data: ub } = await db.from('ubicaciones').select('updated_at, precision_m').eq('user_id', S.user.id).maybeSingle();
  await leerPermisoUbic();
  const perm = S.permisoUbic;
  app.innerHTML = `
    ${tituloSeccion('👤 Mi perfil', 'Así te conocen en OFERTAL', `<a href="#usuario=${S.user.id}" class="btn btn-suave text-xs">Ver mi perfil público ›</a>`)}
    <div class="grid lg:grid-cols-[1fr_1.1fr] gap-5">
      <div class="space-y-5">
        <section class="tarjeta p-5">
          <div class="flex items-center gap-4">
            <label class="relative cursor-pointer group" title="Cambiar foto">
              ${avatar(S.perfil, 'w-20 h-20 text-3xl')}
              <span class="absolute inset-0 rounded-full bg-black/40 text-white text-xs font-bold grid place-items-center opacity-0 group-hover:opacity-100 transition">Cambiar</span>
              <input type="file" accept="image/*" class="hidden" id="inAvatar">
            </label>
            <div class="min-w-0">
              <h2 class="text-xl font-extrabold truncate">${esc(S.perfil.nombre || 'Sin nombre')} ${S.perfil.verificado ? '<span class="text-sky-500 text-base" title="Verificado">✔</span>' : ''}</h2>
              <p class="text-sm text-slate-500">📱 ${esc(S.perfil.whatsapp || '')}</p>
              <p class="text-xs text-slate-500 mt-1">${pub?.num_resenas ? `${estrellas(pub.calificacion)} ${pub.calificacion} · ${pub.num_resenas} reseña(s)` : 'Sin calificaciones aún'}</p>
            </div>
          </div>
        </section>
        <section class="tarjeta p-5">
          <h3 class="font-bold mb-4">Mis datos</h3>
          <form id="fPerfil" class="space-y-3">
            <div class="grid grid-cols-3 gap-3">
              <div class="col-span-2"><label class="etiqueta">Nombre</label><input name="nombre" maxlength="40" required class="campo" value="${esc(S.perfil.nombre || '')}"></div>
              <div><label class="etiqueta">Edad</label><input name="edad" type="number" min="14" max="110" class="campo" value="${S.perfil.edad || ''}"></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="etiqueta">Departamento</label><select name="depto" class="campo"></select></div>
              <div><label class="etiqueta">Municipio</label><select name="mun" class="campo"></select></div>
            </div>
            <div><label class="etiqueta">Sobre mí <span class="font-normal text-slate-400">(experiencia, horarios…)</span></label>
              <textarea name="bio" rows="3" maxlength="400" class="campo resize-none">${esc(S.perfil.bio || '')}</textarea></div>
            <button class="btn btn-primario w-full">Guardar cambios</button>
          </form>
        </section>
        <section class="tarjeta p-5">
          <h3 class="font-bold mb-1">🔑 Cambiar PIN</h3>
          <p class="text-xs text-slate-500 mb-3">Tu PIN de 4 dígitos para ingresar.</p>
          <form id="fPin" class="flex gap-2">
            <input name="pin" type="password" inputmode="numeric" maxlength="4" class="campo text-center tracking-[0.5em] placeholder:tracking-normal font-bold" placeholder="Nuevo">
            <input name="pin2" type="password" inputmode="numeric" maxlength="4" class="campo text-center tracking-[0.5em] placeholder:tracking-normal font-bold" placeholder="Repetir">
            <button class="btn btn-oscuro shrink-0">Cambiar</button>
          </form>
        </section>
      </div>
      <div class="space-y-5">
        <section class="tarjeta p-5">
          <div class="flex items-start justify-between gap-3 mb-3">
            <div><h3 class="font-bold">📍 Mi ubicación</h3>
            <p class="text-xs text-slate-500 mt-0.5">${perm === 'granted' ? '<span class="text-emerald-600 font-semibold">● Activa</span>' : perm === 'denied' ? '<span class="text-rose-600 font-semibold">● Bloqueada en el navegador</span>' : '<span class="text-amber-600 font-semibold">● Sin activar</span>'}
            ${ub ? ` · actualizada ${tiempoRelativo(ub.updated_at)}` : ''}</p></div>
            <button data-accion="actualizar-ubicacion" class="btn btn-suave !py-1.5 text-xs shrink-0">↻ Actualizar</button>
          </div>
          ${S.perfil.zona_lat != null ? `<div class="mapa mapa-grande" data-mapa-zona data-lat="${S.perfil.zona_lat}" data-lng="${S.perfil.zona_lng}" data-radio="${S.perfil.zona_radio || 1000}"></div>
            <p class="text-xs text-slate-600 mt-3"><b>Así te ven los demás:</b> un círculo de ~${Math.round((S.perfil.zona_radio || 1000) / 100) / 10} km. Estás dentro de él, pero <b>el centro no es tu posición real</b>. El círculo cambia solo cuando te mueves fuera de él.</p>`
            : '<div class="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Aún no hemos registrado tu ubicación.<br><button data-accion="activar-ubicacion" class="btn btn-primario mt-3">Activar ubicación</button></div>'}
          <div class="mt-3 rounded-xl bg-indigo-50 text-indigo-900 text-xs p-3">🔒 Tu ubicación exacta solo la conoce el equipo de OFERTAL. Se usa por seguridad y para respaldar a quienes contratan servicios; nunca se muestra a otros usuarios.</div>
        </section>
        <section class="tarjeta divide-y divide-slate-50">
          ${[['#mis-publicaciones', '📦', 'Mis publicaciones'], ['#mis-solicitudes', '🙋', 'Mis solicitudes'], ['#favoritos', '❤️', 'Favoritos'], ['#mensajes', '💬', 'Mensajes'], ['#notificaciones', '🔔', 'Notificaciones'], ['#soporte', '🛟', 'Soporte y ayuda'], ['#como-funciona', '📖', 'Cómo funciona OFERTAL']]
            .map(([h, i, t]) => `<a href="${h}" class="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 text-sm font-medium"><span>${i}</span><span class="grow">${t}</span><span class="text-slate-300">›</span></a>`).join('')}
          ${S.perfil.rol === 'admin' ? '<a href="admin.html" class="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 text-sm font-bold text-indigo-700"><span>🛡️</span><span class="grow">Panel de administración</span><span>›</span></a>' : ''}
          <button data-accion="logout" class="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-rose-50 text-sm font-medium text-rose-600"><span>↩</span>Cerrar sesión</button>
        </section>
      </div>
    </div>`;
  activarMapas(app);
  const f = $('#fPerfil');
  llenarSelectDepartamentos(f.depto, f.mun, { depto: S.perfil.departamento || '', mun: S.perfil.municipio || '' });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const cambios = { nombre: f.nombre.value.trim(), edad: parseInt(f.edad.value, 10) || null, departamento: f.depto.value || null, municipio: f.mun.value || null, bio: f.bio.value.trim() || null };
    const { error } = await db.from('perfiles').update(cambios).eq('id', S.user.id);
    if (error) return toast(errorMsg(error), 'error');
    Object.assign(S.perfil, cambios);
    S.perfiles.delete(S.user.id);
    renderNav();
    toast('Perfil actualizado', 'ok');
  };
  const fp = $('#fPin');
  fp.onsubmit = async (e) => {
    e.preventDefault();
    const pin = fp.pin.value.trim();
    if (!/^\d{4}$/.test(pin)) return toast('El PIN debe tener 4 números', 'aviso');
    if (pin !== fp.pin2.value.trim()) return toast('Los PIN no coinciden', 'aviso');
    if (/^(\d)\1{3}$/.test(pin) || ['1234', '4321'].includes(pin)) return toast('Elige un PIN menos obvio', 'aviso');
    const { error } = await db.auth.updateUser({ password: pin + PIN_SALT });
    if (error) return toast(errorMsg(error), 'error');
    fp.reset();
    toast('PIN actualizado. Úsalo la próxima vez que ingreses.', 'ok');
  };
  $('#inAvatar').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast('Subiendo foto…');
      const url = await subirImagen(db, S.user.id, file, 'avatar');
      const { error } = await db.from('perfiles').update({ avatar_url: url }).eq('id', S.user.id);
      if (error) throw error;
      S.perfil.avatar_url = url;
      S.perfiles.delete(S.user.id);
      renderNav();
      vistaPerfil();
      toast('Foto actualizada', 'ok');
    } catch (ex) { toast(errorMsg(ex), 'error'); }
  };
}

async function vistaUsuario(id) {
  if (!id) return irA('#inicio');
  S.perfiles.delete(id);
  await cargarPerfiles([id]);
  const u = S.perfiles.get(id);
  if (!u) { app.innerHTML = '<div class="text-center py-20"><div class="text-5xl mb-3">🙈</div><p class="font-bold">Este perfil no está disponible</p><a href="#inicio" class="btn btn-primario mt-4">Volver al inicio</a></div>'; return; }
  const esYo = S.user?.id === id;
  const [{ data: anuncios }, { data: resenas }, puede] = await Promise.all([
    db.from('anuncios').select(S.user ? COLS_ANUNCIO_SESION : COLS_ANUNCIO_PUBLICO).eq('user_id', id).eq('estado', 'aprobado').order('created_at', { ascending: false }).limit(40),
    db.from('resenas').select('*').eq('usuario_id', id).order('created_at', { ascending: false }).limit(50),
    S.user && !esYo ? db.rpc('puede_resenar', { p_usuario: id }).then((r) => r.data) : Promise.resolve(false),
  ]);
  await cargarPerfiles((resenas || []).map((r) => r.autor_id));
  S.anuncios = anuncios || [];
  app.innerHTML = `
    <section class="tarjeta mt-6 p-5 sm:p-6">
      <div class="flex flex-col sm:flex-row gap-5">
        ${avatar(u, 'w-24 h-24 text-4xl')}
        <div class="grow min-w-0">
          <h1 class="text-2xl font-extrabold">${esc(u.nombre || 'Usuario')} ${u.verificado ? '<span class="text-sky-500 text-lg" title="Identidad verificada por OFERTAL">✔ <span class="text-xs font-bold align-middle">Verificado</span></span>' : ''}</h1>
          <p class="text-sm text-slate-500 mt-1">📍 ${esc(u.municipio || '')}${u.departamento ? ', ' + esc(u.departamento) : ''} · Miembro desde ${new Date(u.created_at).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}${u.ultima_conexion ? ' · Activo ' + tiempoRelativo(u.ultima_conexion) : ''}</p>
          <p class="mt-2">${u.num_resenas ? `${estrellas(u.calificacion, 'text-lg')} <b>${u.calificacion}</b> <span class="text-sm text-slate-500">(${u.num_resenas} reseña${u.num_resenas === 1 ? '' : 's'})</span>` : '<span class="text-sm text-slate-400">Sin calificaciones aún</span>'}</p>
          ${u.bio ? `<p class="text-sm text-slate-600 mt-3 whitespace-pre-wrap">${esc(u.bio)}</p>` : ''}
          <div class="flex flex-wrap gap-2 mt-4">
            ${esYo ? '<a href="#perfil" class="btn btn-suave">✏️ Editar mi perfil</a>' : S.user ? `
              <button data-accion="chatear" data-usuario="${id}" class="btn btn-primario">💬 Enviar mensaje</button>
              ${puede ? `<button data-accion="resenar" data-usuario="${id}" class="btn btn-suave">⭐ Calificar</button>` : ''}
              <button data-accion="reportar" data-entidad="usuario" data-id="${id}" class="btn btn-suave text-slate-500">⚑ Reportar</button>` : '<button data-accion="login" class="btn btn-primario">Inicia sesión para contactar</button>'}
          </div>
        </div>
        ${u.zona_lat != null ? `<div class="sm:w-72 shrink-0">${htmlZona(u, 'Zona aproximada actual.')}</div>` : ''}
      </div>
    </section>
    <h2 class="text-lg font-extrabold mt-8 mb-4">Ofertas publicadas (${S.anuncios.length})</h2>
    <div id="feed" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">${S.anuncios.map(tarjetaAnuncio).join('') || '<p class="col-span-full text-sm text-slate-500">No tiene ofertas activas.</p>'}</div>
    <h2 class="text-lg font-extrabold mt-10 mb-4">Reseñas (${(resenas || []).length})</h2>
    <div class="grid md:grid-cols-2 gap-3">${(resenas || []).map((r) => {
      const a = S.perfiles.get(r.autor_id) || {};
      return `<div class="tarjeta p-4"><div class="flex items-center gap-3">${avatar(a, 'w-9 h-9 text-sm')}<div class="grow"><p class="text-sm font-bold">${esc(a.nombre || 'Usuario')}</p><p class="text-[11px] text-slate-400">${tiempoRelativo(r.created_at)}</p></div>${estrellas(r.estrellas)}</div>
        ${r.comentario ? `<p class="text-sm text-slate-600 mt-2">${esc(r.comentario)}</p>` : ''}</div>`;
    }).join('') || '<p class="text-sm text-slate-500">Todavía no tiene reseñas.</p>'}</div>`;
  activarMapas(app);
}

function formularioResena(usuarioId) {
  let valor = 5;
  const m = modal({
    titulo: '⭐ Calificar', ancho: 'sm:max-w-sm',
    html: `<form class="space-y-4 text-center">
      <p class="text-sm text-slate-600">¿Cómo fue tu experiencia?</p>
      <div class="flex justify-center gap-1 text-4xl" data-estrellas>${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-v="${i}" class="text-amber-400 hover:scale-110 transition">★</button>`).join('')}</div>
      <textarea name="comentario" rows="3" maxlength="600" class="campo resize-none text-left" placeholder="Cuéntale a otros cómo te fue (opcional)"></textarea>
      <button class="btn btn-primario w-full">Publicar calificación</button></form>`,
  });
  const pintar = () => $$('[data-v]', m.el).forEach((b) => b.classList.toggle('text-slate-200', +b.dataset.v > valor));
  $$('[data-v]', m.el).forEach((b) => (b.onclick = () => { valor = +b.dataset.v; pintar(); }));
  const f = m.el.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await db.from('resenas').upsert({ autor_id: S.user.id, usuario_id: usuarioId, estrellas: valor, comentario: f.comentario.value.trim() || null }, { onConflict: 'autor_id,usuario_id' });
    if (error) return toast(errorMsg(error), 'error');
    m.cerrar();
    S.perfiles.delete(usuarioId);
    toast('¡Gracias por tu calificación!', 'ok');
    if (S.vista === 'usuario') vistaUsuario(usuarioId);
  };
}

function formularioReporte(entidad, id) {
  if (!S.user) return abrirAuth('login');
  const motivos = ['Posible estafa o fraude', 'Producto o servicio prohibido', 'Información falsa o engañosa', 'Spam o publicación duplicada', 'Contenido ofensivo o acoso', 'Suplantación de identidad', 'Otro'];
  const m = modal({
    titulo: '⚑ Reportar', ancho: 'sm:max-w-md',
    html: `<form class="space-y-3">
      <p class="text-sm text-slate-600">Tu reporte es confidencial. El equipo de OFERTAL lo revisará.</p>
      <div class="space-y-1.5">${motivos.map((mo, i) => `<label class="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 cursor-pointer text-sm"><input type="radio" name="motivo" value="${esc(mo)}" ${i ? '' : 'checked'} class="accent-rose-600">${esc(mo)}</label>`).join('')}</div>
      <textarea name="detalle" rows="3" maxlength="1000" class="campo resize-none" placeholder="Cuéntanos qué pasó (opcional)"></textarea>
      <button class="btn bg-rose-600 hover:bg-rose-700 text-white w-full">Enviar reporte</button></form>`,
  });
  const f = m.el.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await db.from('reportes').insert({ entidad, entidad_id: id, motivo: f.querySelector('[name="motivo"]:checked').value, detalle: f.detalle.value.trim() || null });
    if (error) return toast(errorMsg(error), 'error');
    m.cerrar();
    toast('Reporte enviado. Gracias por ayudarnos a mantener OFERTAL seguro 🛡️', 'ok');
  };
}

// ======================================================================
// SOPORTE
// ======================================================================
const FAQ = [
  ['¿Cómo publico una oferta?', 'Toca «Publicar» → «Ofrecer un producto o servicio». Completa el título, la categoría, el precio, la descripción y hasta 3 fotos. Tu publicación pasa por una revisión rápida y te avisamos con una notificación cuando esté visible.'],
  ['¿Cómo pido un servicio?', 'Toca «Publicar» → «Necesito un servicio o producto». Los proveedores de esa categoría en tu zona reciben una notificación y te envían propuestas con precio. Las ves en «Mis solicitudes», donde puedes aceptarlas o chatear con cada uno.'],
  ['¿Por qué me piden la ubicación?', 'Para dar seguridad a todos: cada publicación registra desde dónde se hizo. Los demás usuarios solo ven un área aproximada de ~1 km y el centro de esa área no es tu posición real. La ubicación exacta solo la conoce el equipo de OFERTAL.'],
  ['Bloqueé la ubicación, ¿cómo la activo?', 'Toca el candado 🔒 junto a la dirección web → Permisos o Configuración del sitio → Ubicación → Permitir. Revisa también que el GPS del celular esté encendido y recarga la página.'],
  ['Olvidé mi PIN', 'Usa el formulario «¿Olvidaste tu PIN?» de esta página. Verificaremos que la cuenta sea tuya y te daremos un PIN nuevo. Si tienes sesión abierta, puedes cambiarlo en «Mi perfil».'],
  ['¿Cuánto tiempo tarda la revisión?', 'Normalmente unas pocas horas. Si fue rechazada verás el motivo en «Mis publicaciones»; corrígela y guárdala para que vuelva a revisión.'],
  ['¿Cómo evito estafas?', 'Nunca pagues anticipos a desconocidos, revisa las calificaciones y el sello ✔ de verificado, conversa por el chat de OFERTAL y reúnete en lugares públicos. Si algo te parece sospechoso, usa el botón ⚑ Reportar.'],
  ['¿Publicar tiene algún costo?', 'No. Publicar ofertas y solicitudes en OFERTAL es gratis.'],
];

async function vistaSoporte() {
  app.innerHTML = `
    <section class="mt-6 rounded-3xl bg-gradient-to-br from-slate-800 to-slate-900 text-white p-6 sm:p-8">
      <h1 class="text-2xl sm:text-3xl font-extrabold">🛟 Centro de ayuda</h1>
      <p class="text-slate-300 mt-1 text-sm">Resuelve tus dudas al instante o escríbele a nuestro equipo.</p>
      ${S.user ? `<form id="fAsistente" class="mt-5 flex gap-2">
          <input name="pregunta" maxlength="500" class="campo !bg-white/95" placeholder="Pregúntale al asistente, ej: ¿cómo acepto una propuesta?">
          <button class="btn bg-indigo-500 hover:bg-indigo-400 text-white shrink-0">✨ Preguntar</button></form>
        <div id="respAsistente" class="hidden mt-3 rounded-2xl bg-white/10 p-4 text-sm leading-relaxed whitespace-pre-wrap"></div>` : ''}
    </section>
    <div class="grid lg:grid-cols-[1fr_1fr] gap-6 mt-6">
      <section>
        <h2 class="text-lg font-extrabold mb-3">Preguntas frecuentes</h2>
        <div class="space-y-2">${FAQ.map(([p, r]) => `<details class="tarjeta px-4 py-3"><summary class="flex justify-between items-center gap-3 font-semibold text-sm">${esc(p)}<span class="rotar transition text-slate-400">⌄</span></summary><p class="text-sm text-slate-600 mt-2 leading-relaxed">${esc(r)}</p></details>`).join('')}</div>
        <a href="#como-funciona" class="inline-block mt-3 text-sm font-semibold text-indigo-600 hover:underline">📖 Ver cómo funciona OFERTAL ›</a>
      </section>
      <section>${S.user ? `
        <div class="flex items-center justify-between mb-3"><h2 class="text-lg font-extrabold">Mis tickets</h2><button data-accion="nuevo-ticket" class="btn btn-primario">＋ Nuevo ticket</button></div>
        <div id="misTickets" class="space-y-2"><div class="esqueleto h-16"></div></div>` : `
        <div class="tarjeta p-5">
          <h2 class="text-lg font-extrabold">🔑 ¿Olvidaste tu PIN?</h2>
          <p class="text-sm text-slate-500 mt-1 mb-4">Déjanos tus datos. Verificaremos que la cuenta es tuya y te ayudaremos a recuperarla.</p>
          <form id="fRecuperar" class="space-y-3">
            <div><label class="etiqueta">Tu nombre</label><input name="nombre" required maxlength="60" class="campo"></div>
            <div><label class="etiqueta">WhatsApp de tu cuenta</label><input name="tel" required inputmode="numeric" maxlength="10" class="campo" placeholder="3001234567"></div>
            <div><label class="etiqueta">Algo que nos ayude a verificarte</label><textarea name="detalle" rows="3" required maxlength="1000" class="campo resize-none" placeholder="Ej. qué publicaste, tu municipio, cuándo te registraste…"></textarea></div>
            <button class="btn btn-oscuro w-full">Enviar solicitud</button>
          </form>
        </div>
        <div class="tarjeta p-5 mt-4 text-center"><p class="text-sm text-slate-600">¿Tienes otra duda o problema?</p><button data-accion="login" class="btn btn-primario mt-3">Inicia sesión para crear un ticket</button></div>`}
      </section>
    </div>`;
  if (S.user) {
    const fa = $('#fAsistente');
    fa.onsubmit = async (e) => {
      e.preventDefault();
      const pregunta = fa.pregunta.value.trim();
      if (pregunta.length < 3) return;
      const box = $('#respAsistente');
      box.classList.remove('hidden');
      box.textContent = '⏳ Pensando…';
      try {
        const r = await llamarFuncion(db, 'ia', { accion: 'asistente_soporte', pregunta });
        box.innerHTML = `${esc(r.respuesta)}<div class="mt-3 pt-3 border-t border-white/10 text-xs text-slate-300">¿No resolvió tu duda? <button data-accion="nuevo-ticket" data-texto="${esc(pregunta)}" class="underline font-bold text-white">Crear un ticket</button></div>`;
      } catch (ex) { box.textContent = errorMsg(ex); }
    };
    cargarMisTickets();
  } else {
    const fr = $('#fRecuperar');
    fr.onsubmit = async (e) => {
      e.preventDefault();
      const tel = fr.tel.value.replace(/\D/g, '');
      if (!/^3\d{9}$/.test(tel)) return toast('Escribe un WhatsApp colombiano válido', 'aviso');
      const { error } = await db.from('tickets').insert({ asunto: 'Recuperar PIN', descripcion: fr.detalle.value.trim(), categoria: 'cuenta', contacto: tel, nombre_contacto: fr.nombre.value.trim() });
      if (error) return toast(errorMsg(error), 'error');
      fr.reset();
      modal({ ancho: 'sm:max-w-sm', html: '<div class="text-center space-y-3"><div class="text-5xl">📨</div><h3 class="font-bold text-lg">Solicitud recibida</h3><p class="text-sm text-slate-600">Nuestro equipo verificará tus datos y te contactará al número indicado con tu nuevo PIN.</p><button data-cerrar class="btn btn-oscuro w-full">Entendido</button></div>' });
    };
  }
}

async function cargarMisTickets() {
  const cont = $('#misTickets');
  if (!cont) return;
  const { data } = await db.from('tickets').select('*').eq('user_id', S.user.id).order('updated_at', { ascending: false });
  cont.innerHTML = (data || []).length ? data.map((t) => `
    <a href="#ticket=${t.id}" class="tarjeta p-4 flex items-center gap-3 hover:shadow-md transition">
      <div class="grow min-w-0">
        <div class="flex items-center gap-2">${badge(ESTADOS_TICKET[t.estado])}<span class="text-[11px] text-slate-400">#${t.numero} · ${tiempoRelativo(t.updated_at)}</span></div>
        <p class="font-semibold text-sm mt-1 truncate">${esc(t.asunto)}</p>
      </div>
      ${t.no_leido_usuario ? '<span class="text-[10px] font-bold bg-indigo-600 text-white rounded-full px-2 py-0.5 shrink-0">Nueva respuesta</span>' : ''}
      <span class="text-slate-300">›</span>
    </a>`).join('') : '<div class="tarjeta p-8 text-center text-sm text-slate-500">No tienes tickets. Si necesitas ayuda, crea uno y te responderemos aquí mismo.</div>';
}

function formularioTicket(textoInicial = '', referencia = '') {
  if (!S.user) return abrirAuth('login');
  const m = modal({
    titulo: '🛟 Nuevo ticket de soporte', ancho: 'sm:max-w-lg',
    html: `<form class="space-y-3">
      <div><label class="etiqueta">¿Sobre qué es?</label><select name="categoria" class="campo">${Object.entries(CATEGORIAS_TICKET).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div><label class="etiqueta">Asunto</label><input name="asunto" required maxlength="150" class="campo" placeholder="Resume tu caso en una frase" value="${esc(textoInicial.slice(0, 150))}"></div>
      <div><label class="etiqueta">Cuéntanos con detalle</label><textarea name="descripcion" rows="5" required maxlength="3000" class="campo resize-none" placeholder="Qué pasó, qué esperabas, en qué publicación…">${esc(textoInicial)}</textarea></div>
      <div><label class="etiqueta">Enlace o referencia <span class="font-normal text-slate-400">(opcional)</span></label><input name="referencia" maxlength="300" class="campo" value="${esc(referencia)}" placeholder="Pega el enlace de la publicación, si aplica"></div>
      <button class="btn btn-primario w-full py-3">Enviar ticket</button></form>`,
  });
  const f = m.el.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true;
    const { data, error } = await db.from('tickets').insert({ categoria: f.categoria.value, asunto: f.asunto.value.trim(), descripcion: f.descripcion.value.trim(), referencia: f.referencia.value.trim() || null }).select('id, numero').single();
    btn.disabled = false;
    if (error) return toast(errorMsg(error), 'error');
    m.cerrar();
    toast(`Ticket #${data.numero} creado. Te responderemos pronto.`, 'ok');
    location.hash = `#ticket=${data.id}`;
  };
}

async function vistaTicket(id) {
  const { data: t } = await db.from('tickets').select('*').eq('id', id).maybeSingle();
  if (!t) { app.innerHTML = '<p class="text-center py-20 text-slate-500">Ticket no encontrado. <a href="#soporte" class="text-indigo-600">Volver</a></p>'; return; }
  S.ticketAbierto = t.id;
  const { data: msjs } = await db.from('tickets_mensajes').select('*').eq('ticket_id', t.id).order('created_at');
  if (t.no_leido_usuario) db.from('tickets').update({ no_leido_usuario: false }).eq('id', t.id).then(() => {});
  db.from('notificaciones').update({ leida: true }).eq('user_id', S.user.id).eq('enlace', '#ticket=' + t.id).eq('leida', false).then(() => contarPendientes());
  const cerrado = ['cerrado'].includes(t.estado);
  app.innerHTML = `
    <div class="mt-6 max-w-3xl mx-auto">
      <a href="#soporte" class="text-sm text-slate-500 hover:text-slate-800">‹ Volver a soporte</a>
      <div class="tarjeta mt-3 overflow-hidden">
        <header class="p-5 border-b border-slate-100 flex flex-wrap justify-between gap-3">
          <div><p class="text-xs text-slate-400">Ticket #${t.numero} · ${CATEGORIAS_TICKET[t.categoria] || t.categoria} · ${fechaHora(t.created_at)}</p>
          <h1 class="text-lg font-extrabold mt-1">${esc(t.asunto)}</h1></div>
          <div class="flex items-center gap-2">${badge(ESTADOS_TICKET[t.estado])}
            ${!['resuelto', 'cerrado'].includes(t.estado) ? '<button data-accion="resolver-ticket" class="btn btn-suave !py-1.5 text-xs">✓ Marcar resuelto</button>' : ''}</div>
        </header>
        <div id="hiloTicket" class="p-5 space-y-3 bg-slate-50 max-h-[60vh] overflow-y-auto">
          ${burbujaTicket({ es_admin: false, texto: t.descripcion + (t.referencia ? `\n\n🔗 ${t.referencia}` : ''), created_at: t.created_at })}
          ${(msjs || []).map(burbujaTicket).join('')}
          ${!(msjs || []).some((m) => m.es_admin) ? '<p class="text-center text-xs text-slate-400 py-2">Nuestro equipo te responderá aquí. Te avisaremos con una notificación 🔔</p>' : ''}
        </div>
        <form id="fTicket" class="p-4 border-t border-slate-100 flex gap-2 items-end">
          <textarea name="texto" rows="2" maxlength="3000" class="campo resize-none" placeholder="${cerrado ? 'Escribe para reabrir el ticket…' : 'Escribe tu respuesta…'}"></textarea>
          <button class="btn btn-primario shrink-0">Enviar</button>
        </form>
      </div>
    </div>`;
  const hilo = $('#hiloTicket');
  hilo.scrollTop = hilo.scrollHeight;
  const f = $('#fTicket');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const texto = f.texto.value.trim();
    if (!texto) return;
    const { data, error } = await db.from('tickets_mensajes').insert({ ticket_id: t.id, texto }).select().single();
    if (error) return toast(errorMsg(error), 'error');
    f.reset();
    agregarMensajeTicket(data);
  };
}

function burbujaTicket(m) {
  return `<div class="flex ${m.es_admin ? 'justify-start' : 'justify-end'}" ${m.id ? `data-tmsj="${m.id}"` : ''}>
    <div class="max-w-[85%]">
      <p class="text-[10px] font-bold mb-1 ${m.es_admin ? 'text-indigo-600' : 'text-slate-400 text-right'}">${m.es_admin ? '🛟 Equipo OFERTAL' : 'Tú'} · ${tiempoRelativo(m.created_at)}</p>
      <div class="px-4 py-2.5 text-sm shadow-sm whitespace-pre-wrap break-words ${m.es_admin ? 'burbuja-otro' : 'burbuja-yo'}">${esc(m.texto)}</div>
    </div></div>`;
}

function agregarMensajeTicket(m) {
  const hilo = $('#hiloTicket');
  if (!hilo || $(`[data-tmsj="${m.id}"]`, hilo)) return;
  hilo.insertAdjacentHTML('beforeend', burbujaTicket(m));
  hilo.scrollTop = hilo.scrollHeight;
  if (m.es_admin) db.from('tickets').update({ no_leido_usuario: false }).eq('id', m.ticket_id).then(() => {});
}

// ======================================================================
// CÓMO FUNCIONA
// ======================================================================
function vistaComoFunciona() {
  const paso = (n, t, d) => `<div class="flex gap-4"><span class="w-9 h-9 shrink-0 rounded-full bg-indigo-600 text-white font-bold grid place-items-center">${n}</span><div><p class="font-bold">${t}</p><p class="text-sm text-slate-600 mt-0.5">${d}</p></div></div>`;
  app.innerHTML = `
    ${tituloSeccion('📖 Cómo funciona OFERTAL', 'Sencillo para quien ofrece y para quien busca')}
    <div class="grid md:grid-cols-2 gap-5">
      <section class="tarjeta p-6 space-y-5"><h2 class="text-lg font-extrabold text-indigo-700">🛍️ Si ofreces productos o servicios</h2>
        ${paso(1, 'Crea tu cuenta', 'Con tu WhatsApp y un PIN de 4 dígitos. Activa tu ubicación.')}
        ${paso(2, 'Publica gratis', 'Título, precio, fotos y descripción. La IA te ayuda a redactarla ✨.')}
        ${paso(3, 'Recibe solicitudes', 'Cuando alguien cerca necesita lo que haces, te llega una notificación. Envía tu propuesta con precio.')}
        ${paso(4, 'Cierra el trato', 'Conversa por el chat, acuerda los detalles y pide que te califiquen ⭐.')}
      </section>
      <section class="tarjeta p-6 space-y-5"><h2 class="text-lg font-extrabold text-emerald-700">🙋 Si buscas algo</h2>
        ${paso(1, 'Explora las ofertas', 'Filtra por categoría, departamento o cercanía.')}
        ${paso(2, 'O publica tu solicitud', 'Describe lo que necesitas y tu presupuesto. Avisamos a los proveedores de tu zona.')}
        ${paso(3, 'Compara propuestas', 'Revisa precios, calificaciones y el sello ✔ de verificado. Acepta la que más te convenga.')}
        ${paso(4, 'Contrata con confianza', 'Cada proveedor publica con ubicación registrada por OFERTAL. Si algo sale mal, repórtalo.')}
      </section>
    </div>
    <section class="tarjeta p-6 mt-5"><h2 class="text-lg font-extrabold">🔒 Tu privacidad y tu ubicación</h2>
      <div class="grid sm:grid-cols-3 gap-4 mt-4 text-sm text-slate-600">
        <div><p class="text-2xl mb-1">🗺️</p><b class="text-slate-800">Área aproximada</b><p>Los demás ven un círculo de ~1 km, no un punto.</p></div>
        <div><p class="text-2xl mb-1">🎯</p><b class="text-slate-800">Centro desplazado</b><p>El centro del círculo nunca es tu posición real: estás en algún lugar dentro.</p></div>
        <div><p class="text-2xl mb-1">🛡️</p><b class="text-slate-800">Solo el equipo la ve</b><p>La ubicación exacta queda guardada de forma privada para seguridad y respaldo.</p></div>
      </div></section>
    <div class="text-center mt-8"><button data-accion="publicar" class="btn btn-primario px-8 py-3">Empezar ahora</button></div>`;
}

// ======================================================================
// ACCIONES (delegación de eventos)
// ======================================================================
const ACCIONES = {
  login: () => abrirAuth('login'),
  registro: () => abrirAuth('registro'),
  logout: () => cerrarSesion(),
  'menu-usuario': () => $('#menuUsuario')?.classList.toggle('hidden'),
  publicar: () => elegirPublicacion(),
  'nueva-oferta': () => formularioOferta(),
  'nueva-solicitud': () => formularioSolicitud(),
  'editar-oferta': (d) => formularioOferta(d.id),
  'editar-solicitud': (d) => formularioSolicitud(d.id),
  'estado-oferta': (d) => cambiarEstadoOferta(d.id, d.estado),
  'eliminar-oferta': (d) => eliminarOferta(d.id),
  'estado-solicitud': (d) => cambiarEstadoSolicitud(d.id, d.estado),
  'eliminar-solicitud': (d) => eliminarSolicitud(d.id),
  'ver-anuncio': (d) => { location.hash = `#anuncio=${d.id}`; },
  'ver-solicitud': (d) => { location.hash = `#solicitud=${d.id}`; },
  'mas-anuncios': () => { S.pagina++; cargarAnuncios(false); },
  favorito: (d) => alternarFavorito(d.id),
  compartir: (d) => compartir(d.url, d.titulo),
  chatear: (d) => iniciarChat(d.usuario, d.anuncio || null, d.solicitud || null),
  proponer: (d) => formularioPropuesta(d.id),
  'responder-propuesta': (d) => responderPropuesta(d.id, d.aceptar === '1'),
  reportar: (d) => formularioReporte(d.entidad, d.id),
  resenar: (d) => formularioResena(d.usuario),
  notificaciones: () => panelNotificaciones(),
  'leer-todas': () => marcarTodasLeidas(),
  'abrir-notif': (d, el) => {
    db.from('notificaciones').update({ leida: true }).eq('id', d.id).then(() => contarPendientes());
    cerrarTodosLosModales();
    const destino = el.getAttribute('href');
    if (destino === location.hash) router(); else location.hash = destino;
  },
  'permiso-notif': async () => {
    const r = await Notification.requestPermission();
    toast(r === 'granted' ? 'Notificaciones activadas en este dispositivo' : 'No se activaron las notificaciones', r === 'granted' ? 'ok' : 'aviso');
    if (S.vista === 'notificaciones') vistaNotificaciones();
  },
  'activar-ubicacion': () => (S.permisoUbic === 'denied' ? ayudaUbicacion(true) : asegurarUbicacion('manual').then((ok) => ok && toast('Ubicación activada 📍', 'ok'))),
  'actualizar-ubicacion': async () => { if (await asegurarUbicacion('manual')) { toast('Ubicación actualizada', 'ok'); vistaPerfil(); } },
  'nuevo-ticket': (d) => formularioTicket(d.texto || ''),
  'resolver-ticket': async () => {
    await db.from('tickets').update({ estado: 'resuelto' }).eq('id', S.ticketAbierto);
    toast('¡Nos alegra haberte ayudado! 🙌', 'ok');
    vistaTicket(S.ticketAbierto);
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el) return;
  const fn = ACCIONES[el.dataset.accion];
  if (!fn) return;
  e.preventDefault();
  e.stopPropagation();
  fn(el.dataset, el, e);
});

init();
