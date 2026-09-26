-- =====================================================================
-- OFERTAL v3 · Marketplace regional de todo
-- Inmuebles (venta/arriendo), vigencia de 14 días con renovación,
-- importación desde grupos de WhatsApp con activación de cuenta,
-- datos personales bloqueados, límites diarios, zonas por municipio,
-- respuestas automáticas del asistente de soporte.
-- Ejecutar DESPUÉS de 20260926000000_ofertal_v2.sql. Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CONFIGURACIÓN
-- ---------------------------------------------------------------------
insert into public.config (clave, valor, descripcion) values
  ('dias_vigencia', '14', 'Días que una publicación permanece visible antes de vencer'),
  ('max_ia_dia', '10', 'Usos de inteligencia artificial por usuario cada 24 h'),
  ('terminos_version', '"1.1"', 'Versión vigente de los términos y condiciones'),
  ('radio_zona_municipio_m', '3000', 'Radio (m) de la zona aproximada cuando solo se conoce el municipio'),
  ('mensaje_whatsapp', to_jsonb('Hola 👋 Te saludamos de *OFERTAL*, el marketplace de nuestra región.

Vimos tu publicación en el grupo de WhatsApp y la publicamos *GRATIS* en OFERTAL para que más personas cerca de ti la vean:
{publicaciones}

Para administrarla, responder a los interesados y publicar más cosas, termina tu registro aquí (1 minuto, tú mismo creas tu PIN):
🔐 {enlace_activacion}

Si prefieres que la retiremos, respóndenos este mensaje y la quitamos. ¡Gracias!'::text), 'Mensaje para personas importadas de WhatsApp que aún no activan su cuenta'),
  ('mensaje_whatsapp_registrado', to_jsonb('Hola {nombre} 👋 Te saludamos de *OFERTAL*.

Publicamos en tu cuenta de OFERTAL lo que compartiste en el grupo de WhatsApp:
{publicaciones}

Ingresa con tu número y tu PIN para administrarla: {enlace_sitio}

Si prefieres que la retiremos, respóndenos este mensaje. ¡Gracias!'::text), 'Mensaje para personas importadas de WhatsApp que ya tienen cuenta activa')
on conflict (clave) do nothing;

update public.config set valor = '10' where clave = 'max_publicaciones_dia' and valor = '15';
update public.config set valor = '"1.1"' where clave = 'terminos_version';

-- ---------------------------------------------------------------------
-- PERFILES: origen y activación
-- ---------------------------------------------------------------------
alter table public.perfiles
  add column if not exists origen text not null default 'web',
  add column if not exists registro_completo boolean not null default true;
alter table public.perfiles drop constraint if exists perfiles_origen_check;
alter table public.perfiles add constraint perfiles_origen_check check (origen in ('web', 'whatsapp', 'admin'));

create table if not exists public.activaciones (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique,
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expira_at timestamptz not null default now() + interval '90 days',
  usado_at timestamptz,
  copias int not null default 0
);
alter table public.activaciones enable row level security;
drop policy if exists ofertal_activaciones_admin on public.activaciones;
create policy ofertal_activaciones_admin on public.activaciones for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Nombre, edad y número: el usuario no puede cambiarlos una vez creados
create or replace function public.tg_perfil_proteger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.es_privilegiado() then
    return new;
  end if;
  new.id := old.id;
  new.whatsapp := old.whatsapp;
  if old.nombre is not null then new.nombre := old.nombre; end if;
  if old.edad is not null then new.edad := old.edad; end if;
  new.rol := old.rol;
  new.estado := old.estado;
  new.motivo_suspension := old.motivo_suspension;
  new.verificado := old.verificado;
  new.zona_lat := old.zona_lat;
  new.zona_lng := old.zona_lng;
  new.zona_radio := old.zona_radio;
  new.zona_actualizada := old.zona_actualizada;
  new.ubicacion_permitida := old.ubicacion_permitida;
  new.terminos_version := old.terminos_version;
  new.terminos_aceptados_at := old.terminos_aceptados_at;
  new.origen := old.origen;
  new.registro_completo := old.registro_completo;
  new.created_at := old.created_at;
  return new;
end $$;

create or replace function public.estado_numero(p_tel text)
returns text language sql stable security definer set search_path = public as $$
  select case when p.id is null then 'libre' when p.registro_completo then 'registrado' else 'pendiente' end
  from (select 1) x left join public.perfiles p on p.whatsapp = p_tel
  limit 1
$$;

-- ---------------------------------------------------------------------
-- CATEGORÍAS: marketplace de todo, incluidos inmuebles
-- ---------------------------------------------------------------------
alter table public.categorias drop constraint if exists categorias_tipo_check;
alter table public.categorias add constraint categorias_tipo_check
  check (tipo in ('producto', 'servicio', 'inmueble', 'ambos'));

insert into public.categorias (nombre, icono, tipo, orden) values
  ('Casas y apartamentos en venta', '🏠', 'inmueble', 1),
  ('Arriendo de casas y apartamentos', '🏘️', 'inmueble', 2),
  ('Habitaciones en arriendo', '🛏️', 'inmueble', 3),
  ('Locales, oficinas y bodegas', '🏬', 'inmueble', 4),
  ('Lotes y fincas', '🌳', 'inmueble', 5),
  ('Motos', '🏍️', 'producto', 15),
  ('Bebés y niños', '🧸', 'producto', 21),
  ('Libros y papelería', '📖', 'producto', 22),
  ('Música e instrumentos', '🎸', 'producto', 23),
  ('Videojuegos y consolas', '🎮', 'producto', 24),
  ('Salud y belleza', '💄', 'producto', 25),
  ('Materiales de construcción', '🧱', 'producto', 26),
  ('Empleos', '💼', 'servicio', 46),
  ('Comida y domicilios', '🍔', 'servicio', 47)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------
-- ANUNCIOS: inmuebles, vigencia y procedencia
-- ---------------------------------------------------------------------
alter table public.anuncios
  add column if not exists operacion text,
  add column if not exists detalles jsonb not null default '{}'::jsonb,
  add column if not exists zona_fuente text not null default 'usuario',
  add column if not exists fuente text not null default 'web',
  add column if not exists vence_at timestamptz,
  add column if not exists aviso_vencimiento_at timestamptz;

alter table public.anuncios drop constraint if exists anuncios_tipo_check;
alter table public.anuncios add constraint anuncios_tipo_check check (tipo in ('producto', 'servicio', 'inmueble'));
alter table public.anuncios drop constraint if exists anuncios_estado_check;
alter table public.anuncios add constraint anuncios_estado_check
  check (estado in ('pendiente', 'aprobado', 'rechazado', 'pausado', 'vendido', 'vencido'));
alter table public.anuncios drop constraint if exists anuncios_operacion_check;
alter table public.anuncios add constraint anuncios_operacion_check check (operacion is null or operacion in ('venta', 'arriendo'));
alter table public.anuncios drop constraint if exists anuncios_zona_fuente_check;
alter table public.anuncios add constraint anuncios_zona_fuente_check check (zona_fuente in ('usuario', 'municipio'));
alter table public.anuncios drop constraint if exists anuncios_fuente_check;
alter table public.anuncios add constraint anuncios_fuente_check check (fuente in ('web', 'whatsapp'));
create index if not exists anuncios_vence_idx on public.anuncios (estado, vence_at);

-- Las publicaciones aprobadas existentes arrancan con 14 días de vigencia
update public.anuncios set vence_at = now() + interval '14 days' where estado = 'aprobado' and vence_at is null;

-- Publicaciones antiguas sin zona: zona aproximada del municipio (casco urbano) hasta que el autor comparta su ubicación
update public.anuncios set zona_lat = 7.12746, zona_lng = -73.11913, zona_radio = 3000, zona_fuente = 'municipio'
 where zona_lat is null and municipio = 'Bucaramanga' and departamento = 'Santander';
update public.anuncios set zona_lat = 7.26463, zona_lng = -73.15028, zona_radio = 3000, zona_fuente = 'municipio'
 where zona_lat is null and municipio = 'Rionegro' and departamento = 'Santander';

-- ---------------------------------------------------------------------
-- SOLICITUDES: inmuebles y vigencia
-- ---------------------------------------------------------------------
alter table public.solicitudes
  add column if not exists operacion text,
  add column if not exists zona_fuente text not null default 'usuario',
  add column if not exists vence_at timestamptz,
  add column if not exists aviso_vencimiento_at timestamptz;
alter table public.solicitudes drop constraint if exists solicitudes_tipo_check;
alter table public.solicitudes add constraint solicitudes_tipo_check check (tipo in ('servicio', 'producto', 'inmueble'));
alter table public.solicitudes drop constraint if exists solicitudes_estado_check;
alter table public.solicitudes add constraint solicitudes_estado_check
  check (estado in ('pendiente', 'abierta', 'asignada', 'cerrada', 'rechazada', 'vencida'));
alter table public.solicitudes drop constraint if exists solicitudes_operacion_check;
alter table public.solicitudes add constraint solicitudes_operacion_check check (operacion is null or operacion in ('venta', 'arriendo'));
update public.solicitudes set vence_at = now() + interval '14 days' where estado = 'abierta' and vence_at is null;

-- ---------------------------------------------------------------------
-- TÉRMINOS Y LÍMITES
-- ---------------------------------------------------------------------
create or replace function public._exigir_terminos(p_uid uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_version text := coalesce(public.cfg('terminos_version') #>> '{}', '1.0');
begin
  if not exists (select 1 from public.perfiles
                  where id = p_uid and terminos_aceptados_at is not null
                    and (terminos_version = v_version or rol = 'admin')) then
    raise exception 'TERMINOS_REQUERIDOS: Debes aceptar los términos y condiciones vigentes para continuar.';
  end if;
end $$;
revoke execute on function public._exigir_terminos(uuid) from public, anon, authenticated;

create or replace function public._validar_publicacion(p_uid uuid)
returns public.perfiles language plpgsql security definer set search_path = public as $$
declare
  v_p public.perfiles;
  v_u public.ubicaciones;
  v_n int;
begin
  select * into v_p from public.perfiles where id = p_uid;
  if v_p.id is null or v_p.estado <> 'activo' then
    raise exception 'CUENTA_SUSPENDIDA: Tu cuenta no está activa. Escríbenos desde Soporte.';
  end if;
  perform public._exigir_terminos(p_uid);
  select (select count(*) from public.anuncios where user_id = p_uid and created_at > now() - interval '24 hours')
       + (select count(*) from public.solicitudes where user_id = p_uid and created_at > now() - interval '24 hours')
    into v_n;
  if v_n >= coalesce((public.cfg('max_publicaciones_dia') #>> '{}')::int, 10) then
    raise exception 'LIMITE_DIARIO: Llegaste al máximo de % publicaciones por día. Podrás publicar de nuevo mañana.',
      coalesce((public.cfg('max_publicaciones_dia') #>> '{}')::int, 10);
  end if;
  if coalesce((public.cfg('requerir_ubicacion') #>> '{}')::boolean, true) then
    select * into v_u from public.ubicaciones where user_id = p_uid;
    if v_u.user_id is null or v_u.updated_at < now() - interval '30 minutes' then
      raise exception 'UBICACION_REQUERIDA: Activa tu ubicación para publicar.';
    end if;
  end if;
  return v_p;
end $$;
revoke execute on function public._validar_publicacion(uuid) from public, anon, authenticated;

create or replace function public._dias_vigencia()
returns interval language sql stable security definer set search_path = public as $$
  select make_interval(days => coalesce((public.cfg('dias_vigencia') #>> '{}')::int, 14))
$$;

-- ---------------------------------------------------------------------
-- TRIGGERS DE ANUNCIOS (versión 3)
-- ---------------------------------------------------------------------
create or replace function public.tg_anuncio_antes_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_p public.perfiles;
begin
  if not public.es_privilegiado() then
    new.user_id := auth.uid();
    v_p := public._validar_publicacion(new.user_id);
    new.contacto := coalesce(v_p.whatsapp, new.contacto);
    new.zona_lat := null; new.zona_lng := null; new.zona_radio := null;
    new.zona_fuente := 'usuario';
    new.fuente := 'web';
    new.destacado := false;
    new.vistas := 0;
    new.ia_analisis := null;
    new.motivo_rechazo := null;
    if coalesce((public.cfg('auto_aprobar_anuncios') #>> '{}')::boolean, false) then
      new.estado := 'aprobado';
    else
      new.estado := 'pendiente';
    end if;
  else
    select * into v_p from public.perfiles where id = new.user_id;
    new.contacto := coalesce(new.contacto, v_p.whatsapp, '');
  end if;
  if new.tipo <> 'inmueble' then new.operacion := null; end if;
  if new.tipo = 'inmueble' and new.operacion is null then new.operacion := 'venta'; end if;
  if new.zona_lat is null and v_p.zona_lat is not null then
    new.zona_lat := v_p.zona_lat; new.zona_lng := v_p.zona_lng; new.zona_radio := v_p.zona_radio;
    new.zona_fuente := 'usuario';
  end if;
  new.aprobado_at := case when new.estado = 'aprobado' then now() end;
  new.vence_at := case when new.estado = 'aprobado' then now() + public._dias_vigencia() end;
  new.aviso_vencimiento_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

create or replace function public.tg_anuncio_antes_actualizar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cambio boolean;
begin
  new.updated_at := now();
  if new.tipo <> 'inmueble' then new.operacion := null; end if;
  if public.es_privilegiado() then
    if new.estado = 'aprobado' and old.estado is distinct from 'aprobado' then
      new.aprobado_at := now();
      new.motivo_rechazo := null;
      if coalesce(current_setting('ofertal.renovar', true), '') <> '0' then
        new.vence_at := now() + public._dias_vigencia();
        new.aviso_vencimiento_at := null;
      end if;
    end if;
    return new;
  end if;

  new.user_id := old.user_id;
  new.contacto := old.contacto;
  new.destacado := old.destacado;
  new.vistas := old.vistas;
  new.aprobado_at := old.aprobado_at;
  new.created_at := old.created_at;
  new.zona_lat := old.zona_lat;
  new.zona_lng := old.zona_lng;
  new.zona_radio := old.zona_radio;
  new.zona_fuente := old.zona_fuente;
  new.fuente := old.fuente;
  new.vence_at := old.vence_at;
  new.aviso_vencimiento_at := old.aviso_vencimiento_at;
  new.motivo_rechazo := old.motivo_rechazo;
  new.ia_analisis := old.ia_analisis;

  v_cambio := (new.titulo, new.descripcion, new.precio, new.tipo, new.categoria, new.imagen_urls,
               new.departamento, new.municipio, new.precio_negociable, new.operacion, new.detalles)
    is distinct from (old.titulo, old.descripcion, old.precio, old.tipo, old.categoria, old.imagen_urls,
               old.departamento, old.municipio, old.precio_negociable, old.operacion, old.detalles);

  if v_cambio then
    if not public.usuario_activo() then
      raise exception 'CUENTA_SUSPENDIDA: Tu cuenta no está activa.';
    end if;
    -- Una publicación editada siempre vuelve a revisión (salvo aprobación automática)
    if coalesce((public.cfg('auto_aprobar_anuncios') #>> '{}')::boolean, false) and old.estado not in ('rechazado') then
      new.estado := 'aprobado';
      new.vence_at := now() + public._dias_vigencia();
      new.aviso_vencimiento_at := null;
    else
      new.estado := 'pendiente';
      new.ia_analisis := null;
    end if;
  elsif new.estado is distinct from old.estado then
    if new.estado = 'vendido' and old.estado in ('aprobado', 'pausado', 'vencido') then
      null;
    elsif new.estado = 'pausado' and old.estado = 'aprobado' then
      null;
    elsif new.estado = 'aprobado' and old.estado = 'pausado' and old.vence_at > now() then
      null;
    elsif new.estado = 'aprobado' and old.estado = 'pausado' then
      new.estado := 'vencido';
    else
      new.estado := old.estado;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- TRIGGERS DE SOLICITUDES (vigencia)
-- ---------------------------------------------------------------------
create or replace function public.tg_solicitud_antes_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_p public.perfiles;
begin
  if not public.es_privilegiado() then
    new.user_id := auth.uid();
    v_p := public._validar_publicacion(new.user_id);
    new.zona_lat := null; new.zona_lng := null; new.zona_radio := null;
    new.zona_fuente := 'usuario';
    new.ia_analisis := null;
    new.motivo_rechazo := null;
    new.propuesta_aceptada := null;
    new.vistas := 0;
    if coalesce((public.cfg('auto_aprobar_solicitudes') #>> '{}')::boolean, true) then
      new.estado := 'abierta';
    else
      new.estado := 'pendiente';
    end if;
  else
    select * into v_p from public.perfiles where id = new.user_id;
  end if;
  if new.tipo <> 'inmueble' then new.operacion := null; end if;
  new.zona_lat := coalesce(new.zona_lat, v_p.zona_lat);
  new.zona_lng := coalesce(new.zona_lng, v_p.zona_lng);
  new.zona_radio := coalesce(new.zona_radio, v_p.zona_radio);
  new.vence_at := case when new.estado = 'abierta' then now() + public._dias_vigencia() end;
  new.aviso_vencimiento_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

create or replace function public.tg_solicitud_antes_actualizar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cambio boolean;
begin
  new.updated_at := now();
  if new.tipo <> 'inmueble' then new.operacion := null; end if;
  if public.es_privilegiado() then
    if new.estado = 'abierta' and old.estado is distinct from 'abierta' then
      new.vence_at := now() + public._dias_vigencia();
      new.aviso_vencimiento_at := null;
    end if;
    return new;
  end if;
  new.user_id := old.user_id;
  new.zona_lat := old.zona_lat;
  new.zona_lng := old.zona_lng;
  new.zona_radio := old.zona_radio;
  new.zona_fuente := old.zona_fuente;
  new.ia_analisis := old.ia_analisis;
  new.motivo_rechazo := old.motivo_rechazo;
  new.propuesta_aceptada := old.propuesta_aceptada;
  new.vistas := old.vistas;
  new.vence_at := old.vence_at;
  new.aviso_vencimiento_at := old.aviso_vencimiento_at;
  new.created_at := old.created_at;

  v_cambio := (new.titulo, new.descripcion, new.tipo, new.categoria, new.presupuesto, new.urgencia,
               new.departamento, new.municipio, new.operacion)
    is distinct from (old.titulo, old.descripcion, old.tipo, old.categoria, old.presupuesto, old.urgencia,
               old.departamento, old.municipio, old.operacion);

  if new.estado is distinct from old.estado then
    if new.estado = 'cerrada' and old.estado in ('pendiente', 'abierta', 'asignada', 'vencida') then
      null;
    elsif new.estado = 'abierta' and old.estado in ('cerrada', 'asignada') and old.vence_at > now() then
      if not coalesce((public.cfg('auto_aprobar_solicitudes') #>> '{}')::boolean, true) then
        new.estado := 'pendiente';
      end if;
    else
      new.estado := old.estado;
    end if;
  end if;

  if v_cambio then
    if not public.usuario_activo() then
      raise exception 'CUENTA_SUSPENDIDA: Tu cuenta no está activa.';
    end if;
    if coalesce((public.cfg('auto_aprobar_solicitudes') #>> '{}')::boolean, true) and old.estado not in ('rechazada', 'pendiente') then
      if new.estado in ('abierta', 'vencida') then
        new.estado := 'abierta';
        new.vence_at := now() + public._dias_vigencia();
        new.aviso_vencimiento_at := null;
      end if;
    elsif new.estado in ('abierta', 'rechazada', 'vencida', 'pendiente') then
      new.estado := 'pendiente';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- RENOVACIÓN Y VENCIMIENTO
-- ---------------------------------------------------------------------
-- Renovar con un clic: solo si la publicación no fue editada (si se edita, pasa a revisión del admin)
create or replace function public.renovar_publicacion(p_entidad text, p_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_vence timestamptz := now() + public._dias_vigencia();
  v_estado text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not public.usuario_activo() then raise exception 'CUENTA_SUSPENDIDA: Tu cuenta no está activa.'; end if;
  perform set_config('ofertal.sistema', '1', true);
  perform set_config('ofertal.renovar', '0', true);
  if p_entidad = 'anuncio' then
    select estado into v_estado from public.anuncios where id = p_id and user_id = auth.uid();
    if v_estado is null then raise exception 'Publicación no encontrada'; end if;
    if v_estado not in ('vencido', 'aprobado') then
      raise exception 'Solo puedes renovar publicaciones activas o vencidas.';
    end if;
    update public.anuncios set estado = 'aprobado', vence_at = v_vence, aviso_vencimiento_at = null where id = p_id;
  elsif p_entidad = 'solicitud' then
    select estado into v_estado from public.solicitudes where id = p_id and user_id = auth.uid();
    if v_estado is null then raise exception 'Solicitud no encontrada'; end if;
    if v_estado not in ('vencida', 'abierta') then
      raise exception 'Solo puedes renovar solicitudes abiertas o vencidas.';
    end if;
    update public.solicitudes set estado = 'abierta', vence_at = v_vence, aviso_vencimiento_at = null where id = p_id;
  else
    raise exception 'Tipo no válido';
  end if;
  return v_vence;
end $$;

create or replace function public.procesar_vencimientos()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_aviso int := 0;
  n_venc int := 0;
begin
  perform set_config('ofertal.sistema', '1', true);

  -- Recordatorio 24 h antes
  with r as (
    update public.anuncios set aviso_vencimiento_at = now()
     where estado = 'aprobado' and aviso_vencimiento_at is null and vence_at < now() + interval '1 day' and vence_at > now()
     returning user_id, titulo
  )
  insert into public.notificaciones (user_id, tipo, titulo, cuerpo, enlace)
  select user_id, 'vencimiento', 'Tu publicación vence mañana ⏰', titulo || ' · Renuévala con un clic para seguir visible.', '#mis-publicaciones' from r;
  get diagnostics n_aviso = row_count;

  with r as (
    update public.solicitudes set aviso_vencimiento_at = now()
     where estado = 'abierta' and aviso_vencimiento_at is null and vence_at < now() + interval '1 day' and vence_at > now()
     returning user_id, titulo
  )
  insert into public.notificaciones (user_id, tipo, titulo, cuerpo, enlace)
  select user_id, 'vencimiento', 'Tu solicitud vence mañana ⏰', titulo || ' · Renuévala si aún la necesitas.', '#mis-solicitudes' from r;

  -- Vencer
  with v as (
    update public.anuncios set estado = 'vencido'
     where estado = 'aprobado' and vence_at <= now()
     returning user_id, titulo
  )
  insert into public.notificaciones (user_id, tipo, titulo, cuerpo, enlace)
  select user_id, 'vencido', 'Tu publicación dejó de mostrarse', titulo || ' · Pasaron 2 semanas. Renuévala con un clic en «Mis publicaciones».', '#mis-publicaciones' from v;
  get diagnostics n_venc = row_count;

  with v as (
    update public.solicitudes set estado = 'vencida'
     where estado = 'abierta' and vence_at <= now()
     returning user_id, titulo
  )
  insert into public.notificaciones (user_id, tipo, titulo, cuerpo, enlace)
  select user_id, 'vencido', 'Tu solicitud venció', titulo || ' · Renuévala si aún la necesitas.', '#mis-solicitudes' from v;

  return jsonb_build_object('recordatorios', n_aviso, 'vencidos', n_venc);
end $$;
revoke execute on function public.procesar_vencimientos() from public, anon;
grant execute on function public.procesar_vencimientos() to authenticated;

-- Tarea programada cada 30 minutos
create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ofertal-vencimientos') then
    perform cron.unschedule('ofertal-vencimientos');
  end if;
  perform cron.schedule('ofertal-vencimientos', '*/30 * * * *', 'select public.procesar_vencimientos()');
end $$;

-- ---------------------------------------------------------------------
-- UBICACIÓN: las zonas por municipio se reemplazan por la zona real del autor
-- ---------------------------------------------------------------------
create or replace function public.actualizar_ubicacion(p_lat float8, p_lng float8,
  p_precision float8 default null, p_evento text default 'seguimiento')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_radio int := coalesce((public.cfg('radio_zona_m') #>> '{}')::int, 1000);
  v_p public.perfiles;
  v_z record;
  v_ult record;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Coordenadas inválidas';
  end if;
  if p_evento not in ('seguimiento', 'registro', 'ingreso', 'publicacion', 'solicitud', 'manual', 'activacion') then
    p_evento := 'seguimiento';
  end if;

  perform set_config('ofertal.sistema', '1', true);

  insert into public.ubicaciones (user_id, lat, lng, precision_m, updated_at)
  values (v_uid, p_lat, p_lng, p_precision, now())
  on conflict (user_id) do update
    set lat = excluded.lat, lng = excluded.lng, precision_m = excluded.precision_m, updated_at = now();

  select * into v_p from public.perfiles where id = v_uid;
  if v_p.id is null then
    insert into public.perfiles (id) values (v_uid) returning * into v_p;
  end if;

  if v_p.zona_lat is null
     or v_p.zona_radio is distinct from v_radio
     or public.distancia_m(v_p.zona_lat, v_p.zona_lng, p_lat, p_lng) > v_radio * 0.85 then
    select * into v_z from public._zona_aleatoria(p_lat, p_lng, v_radio);
    update public.perfiles
       set zona_lat = v_z.zlat, zona_lng = v_z.zlng, zona_radio = v_radio, zona_actualizada = now()
     where id = v_uid;
  end if;

  update public.perfiles set ultima_conexion = now(), ubicacion_permitida = true where id = v_uid;

  -- Publicaciones sin zona o con zona aproximada del municipio: toman la zona real (aproximada) del autor
  select * into v_p from public.perfiles where id = v_uid;
  update public.anuncios set zona_lat = v_p.zona_lat, zona_lng = v_p.zona_lng, zona_radio = v_p.zona_radio, zona_fuente = 'usuario'
   where user_id = v_uid and (zona_lat is null or zona_fuente = 'municipio');
  update public.solicitudes set zona_lat = v_p.zona_lat, zona_lng = v_p.zona_lng, zona_radio = v_p.zona_radio, zona_fuente = 'usuario'
   where user_id = v_uid and (zona_lat is null or zona_fuente = 'municipio');

  select * into v_ult from public.ubicaciones_historial
   where user_id = v_uid order by created_at desc limit 1;
  if p_evento <> 'seguimiento' or v_ult.id is null
     or v_ult.created_at < now() - interval '15 minutes'
     or public.distancia_m(v_ult.lat, v_ult.lng, p_lat, p_lng) > 150 then
    insert into public.ubicaciones_historial (user_id, lat, lng, precision_m, evento)
    values (v_uid, p_lat, p_lng, p_precision, p_evento);
  end if;

  return jsonb_build_object('zona_lat', v_p.zona_lat, 'zona_lng', v_p.zona_lng, 'zona_radio', v_p.zona_radio);
end $$;

-- ---------------------------------------------------------------------
-- SOPORTE: respuestas del asistente de IA
-- ---------------------------------------------------------------------
alter table public.tickets_mensajes add column if not exists es_ia boolean not null default false;

create or replace function public.tg_ticket_mensaje_antes_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  if auth.uid() is not null then
    new.autor_id := auth.uid();
    new.es_admin := public.es_admin();
    new.es_ia := false;
  end if;
  return new;
end $$;

create or replace function public.tg_ticket_mensaje_despues_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.tickets;
begin
  perform set_config('ofertal.sistema', '1', true);
  if new.es_ia then
    -- El asistente respondió: el usuario lo ve, y el equipo sigue viendo el ticket como pendiente
    update public.tickets set no_leido_usuario = true, updated_at = now() where id = new.ticket_id;
  elsif new.es_admin then
    update public.tickets
       set no_leido_usuario = true, no_leido_admin = false, updated_at = now(),
           estado = case when estado in ('abierto', 'en_proceso') then 'esperando_usuario' else estado end
     where id = new.ticket_id returning * into t;
    if t.user_id is not null then
      perform public.notificar(t.user_id, 'soporte', 'Soporte respondió tu ticket #' || t.numero,
        left(new.texto, 120), '#ticket=' || t.id);
    end if;
  else
    update public.tickets
       set no_leido_admin = true, updated_at = now(),
           estado = case when estado in ('esperando_usuario', 'resuelto', 'cerrado') then 'abierto' else estado end
     where id = new.ticket_id returning * into t;
    perform public.notificar_admins('admin_ticket', 'Respuesta en ticket #' || t.numero, left(new.texto, 120), 'soporte');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- VISTA PÚBLICA DE PERFILES (se agrega registro_completo al final)
-- ---------------------------------------------------------------------
create or replace view public.perfiles_publicos as
select p.id, p.nombre, p.departamento, p.municipio, p.bio, p.avatar_url, p.verificado,
       p.zona_lat, p.zona_lng, p.zona_radio, p.zona_actualizada, p.ultima_conexion, p.created_at,
       coalesce(r.promedio, 0)::numeric as calificacion,
       coalesce(r.total, 0)::int as num_resenas,
       p.registro_completo
from public.perfiles p
left join (
  select usuario_id, round(avg(estrellas)::numeric, 1) as promedio, count(*) as total
  from public.resenas group by usuario_id
) r on r.usuario_id = p.id
where p.estado = 'activo';
grant select on public.perfiles_publicos to anon, authenticated;

-- ---------------------------------------------------------------------
-- ADMINISTRACIÓN
-- ---------------------------------------------------------------------
drop function if exists public.admin_usuarios();
create or replace function public.admin_usuarios()
returns table (
  id uuid, nombre text, whatsapp text, edad int, departamento text, municipio text, bio text,
  avatar_url text, rol text, estado text, motivo_suspension text, verificado boolean,
  zona_lat float8, zona_lng float8, zona_radio int, ultima_conexion timestamptz, created_at timestamptz,
  ultimo_ingreso timestamptz, lat float8, lng float8, precision_m float8, ubicacion_at timestamptz,
  num_anuncios int, num_solicitudes int, calificacion numeric, num_resenas int,
  terminos_version text, terminos_aceptados_at timestamptz, origen text, registro_completo boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  return query
  select p.id, p.nombre, p.whatsapp, p.edad, p.departamento, p.municipio, p.bio, p.avatar_url, p.rol, p.estado,
         p.motivo_suspension, p.verificado, p.zona_lat, p.zona_lng, p.zona_radio, p.ultima_conexion, p.created_at,
         u.last_sign_in_at, ub.lat, ub.lng, ub.precision_m, ub.updated_at,
         (select count(*)::int from public.anuncios a where a.user_id = p.id),
         (select count(*)::int from public.solicitudes s where s.user_id = p.id),
         (select round(avg(r.estrellas)::numeric, 1) from public.resenas r where r.usuario_id = p.id),
         (select count(*)::int from public.resenas r where r.usuario_id = p.id),
         p.terminos_version, p.terminos_aceptados_at, p.origen, p.registro_completo
  from public.perfiles p
  left join auth.users u on u.id = p.id
  left join public.ubicaciones ub on ub.user_id = p.id
  order by p.created_at desc;
end $$;

create or replace function public.admin_importados()
returns table (
  user_id uuid, whatsapp text, nombre text, registro_completo boolean, created_at timestamptz,
  token text, expira_at timestamptz, usado_at timestamptz, copias int,
  num_anuncios int, titulos text[], ids uuid[]
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  return query
  select p.id, p.whatsapp, p.nombre, p.registro_completo, p.created_at, a.token, a.expira_at, a.usado_at, coalesce(a.copias, 0),
         (select count(*)::int from public.anuncios x where x.user_id = p.id),
         (select array_agg(x.titulo order by x.created_at desc) from public.anuncios x where x.user_id = p.id and x.fuente = 'whatsapp'),
         (select array_agg(x.id order by x.created_at desc) from public.anuncios x where x.user_id = p.id and x.fuente = 'whatsapp')
  from public.perfiles p
  left join public.activaciones a on a.user_id = p.id
  where p.origen = 'whatsapp' or exists (select 1 from public.anuncios x where x.user_id = p.id and x.fuente = 'whatsapp')
  order by p.created_at desc;
end $$;

create or replace function public.admin_estadisticas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select jsonb_build_object(
    'usuarios', (select count(*) from public.perfiles),
    'usuarios_nuevos_7d', (select count(*) from public.perfiles where created_at > now() - interval '7 days'),
    'usuarios_activos_24h', (select count(*) from public.perfiles where ultima_conexion > now() - interval '24 hours'),
    'usuarios_suspendidos', (select count(*) from public.perfiles where estado = 'suspendido'),
    'importados_pendientes', (select count(*) from public.perfiles where origen = 'whatsapp' and not registro_completo),
    'importados_activados', (select count(*) from public.perfiles where origen = 'whatsapp' and registro_completo),
    'con_ubicacion', (select count(*) from public.ubicaciones),
    'ubicacion_reciente', (select count(*) from public.ubicaciones where updated_at > now() - interval '24 hours'),
    'anuncios_total', (select count(*) from public.anuncios),
    'anuncios_aprobados', (select count(*) from public.anuncios where estado = 'aprobado'),
    'anuncios_pendientes', (select count(*) from public.anuncios where estado = 'pendiente'),
    'anuncios_rechazados', (select count(*) from public.anuncios where estado = 'rechazado'),
    'anuncios_vencidos', (select count(*) from public.anuncios where estado = 'vencido'),
    'anuncios_whatsapp', (select count(*) from public.anuncios where fuente = 'whatsapp'),
    'solicitudes_total', (select count(*) from public.solicitudes),
    'solicitudes_abiertas', (select count(*) from public.solicitudes where estado = 'abierta'),
    'solicitudes_pendientes', (select count(*) from public.solicitudes where estado = 'pendiente'),
    'solicitudes_asignadas', (select count(*) from public.solicitudes where estado = 'asignada'),
    'propuestas_total', (select count(*) from public.propuestas),
    'conversaciones', (select count(*) from public.conversaciones),
    'mensajes_24h', (select count(*) from public.mensajes where created_at > now() - interval '24 hours'),
    'tickets_abiertos', (select count(*) from public.tickets where estado not in ('resuelto', 'cerrado')),
    'tickets_sin_leer', (select count(*) from public.tickets where no_leido_admin and estado <> 'cerrado'),
    'reportes_pendientes', (select count(*) from public.reportes where estado = 'pendiente'),
    'ia_usos_24h', (select count(*) from public.ia_uso where created_at > now() - interval '24 hours'),
    'serie', (
      select jsonb_agg(jsonb_build_object(
        'dia', d::date,
        'usuarios', (select count(*) from public.perfiles where created_at::date = d::date),
        'anuncios', (select count(*) from public.anuncios where created_at::date = d::date),
        'solicitudes', (select count(*) from public.solicitudes where created_at::date = d::date)
      ) order by d)
      from generate_series(current_date - 29, current_date, interval '1 day') d
    ),
    'por_departamento', (
      select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
        select coalesce(departamento, 'Sin dato') as departamento, count(*) as total
        from public.anuncios where estado = 'aprobado' group by 1 order by 2 desc limit 8
      ) x
    )
  ) into r;
  return r;
end $$;

-- Anon: nuevas columnas públicas de anuncios (sin teléfono)
grant select (operacion, detalles, zona_fuente, fuente, vence_at) on public.anuncios to anon;
