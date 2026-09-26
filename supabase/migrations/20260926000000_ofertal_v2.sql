-- =====================================================================
-- OFERTAL v2 · Esquema completo
-- Perfiles, ubicación privada + zona pública aproximada, solicitudes,
-- propuestas, chat interno, notificaciones, soporte, reportes, reseñas,
-- favoritos, categorías, configuración y funciones de administración.
-- Idempotente: se puede ejecutar varias veces.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- UTILIDADES
-- ---------------------------------------------------------------------
create or replace function public.distancia_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- ---------------------------------------------------------------------
-- CONFIGURACIÓN GLOBAL
-- ---------------------------------------------------------------------
create table if not exists public.config (
  clave text primary key,
  valor jsonb not null,
  descripcion text,
  updated_at timestamptz not null default now()
);

insert into public.config (clave, valor, descripcion) values
  ('auto_aprobar_anuncios',    'false', 'Publicar ofertas sin revisión previa del administrador'),
  ('auto_aprobar_solicitudes', 'true',  'Publicar solicitudes sin revisión previa del administrador'),
  ('ia_auto_aprobar',          'false', 'Aprobar automáticamente las publicaciones que la IA califique como riesgo bajo'),
  ('radio_zona_m',             '1000',  'Radio en metros del área aproximada que ven los demás usuarios'),
  ('requerir_ubicacion',       'true',  'Exigir ubicación activa para publicar ofertas y solicitudes'),
  ('max_publicaciones_dia',    '15',    'Máximo de publicaciones (ofertas + solicitudes) por usuario cada 24 h'),
  ('aviso_global',             '""',    'Aviso visible en la parte superior del sitio (vacío = ninguno)')
on conflict (clave) do nothing;

create or replace function public.cfg(p_clave text)
returns jsonb language sql stable security definer set search_path = public as $$
  select valor from public.config where clave = p_clave
$$;

-- ---------------------------------------------------------------------
-- PERFILES
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  whatsapp text,
  edad int,
  departamento text,
  municipio text,
  bio text check (bio is null or char_length(bio) <= 400),
  avatar_url text,
  rol text not null default 'usuario' check (rol in ('usuario', 'admin')),
  estado text not null default 'activo' check (estado in ('activo', 'suspendido')),
  motivo_suspension text,
  verificado boolean not null default false,
  -- Zona pública aproximada (el punto real NUNCA es el centro)
  zona_lat float8,
  zona_lng float8,
  zona_radio int,
  zona_actualizada timestamptz,
  ubicacion_permitida boolean not null default false,
  ultima_conexion timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin' and estado = 'activo')
$$;

-- Privilegiado = administrador, service role / SQL directo, o una función interna del sistema.
create or replace function public.es_privilegiado()
returns boolean language sql stable security definer set search_path = public as $$
  -- service_role o SQL directo (sin JWT de usuario) -> privilegiado; anon/authenticated -> no
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'postgres')
           not in ('anon', 'authenticated')
      or coalesce(current_setting('ofertal.sistema', true), '') = '1'
      or public.es_admin()
$$;

create or replace function public.usuario_activo(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = p_uid and estado = 'activo')
$$;

create or replace function public.usuario_suspendido(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = p_uid and estado = 'suspendido')
$$;

-- Crear perfil automáticamente al registrarse
create or replace function public.tg_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, whatsapp, edad, departamento, municipio)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data->>'primer_nombre'), ''),
    coalesce(nullif(new.raw_user_meta_data->>'whatsapp', ''), split_part(new.email, '@', 1)),
    case when (new.raw_user_meta_data->>'edad') ~ '^\d{1,3}$' then (new.raw_user_meta_data->>'edad')::int end,
    nullif(new.raw_user_meta_data->>'departamento', ''),
    nullif(new.raw_user_meta_data->>'municipio', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_nuevo_usuario();

-- Perfiles para usuarios existentes
insert into public.perfiles (id, nombre, whatsapp, edad, departamento, municipio, created_at)
select u.id,
       nullif(trim(u.raw_user_meta_data->>'primer_nombre'), ''),
       coalesce(nullif(u.raw_user_meta_data->>'whatsapp', ''), split_part(u.email, '@', 1)),
       case when (u.raw_user_meta_data->>'edad') ~ '^\d{1,3}$' then (u.raw_user_meta_data->>'edad')::int end,
       nullif(u.raw_user_meta_data->>'departamento', ''),
       nullif(u.raw_user_meta_data->>'municipio', ''),
       u.created_at
from auth.users u
on conflict (id) do nothing;

-- Los usuarios solo pueden editar sus datos básicos
create or replace function public.tg_perfil_proteger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.es_privilegiado() then
    return new;
  end if;
  new.id := old.id;
  new.whatsapp := old.whatsapp;
  new.rol := old.rol;
  new.estado := old.estado;
  new.motivo_suspension := old.motivo_suspension;
  new.verificado := old.verificado;
  new.zona_lat := old.zona_lat;
  new.zona_lng := old.zona_lng;
  new.zona_radio := old.zona_radio;
  new.zona_actualizada := old.zona_actualizada;
  new.ubicacion_permitida := old.ubicacion_permitida;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists perfil_proteger on public.perfiles;
create trigger perfil_proteger before update on public.perfiles
  for each row execute function public.tg_perfil_proteger();

-- ---------------------------------------------------------------------
-- UBICACIÓN PRIVADA (solo el dueño y el administrador)
-- ---------------------------------------------------------------------
create table if not exists public.ubicaciones (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat float8 not null,
  lng float8 not null,
  precision_m float8,
  updated_at timestamptz not null default now()
);

create table if not exists public.ubicaciones_historial (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lat float8 not null,
  lng float8 not null,
  precision_m float8,
  evento text not null default 'seguimiento',
  created_at timestamptz not null default now()
);
create index if not exists ubicaciones_historial_user_idx on public.ubicaciones_historial (user_id, created_at desc);

create table if not exists public.ubicaciones_publicacion (
  id bigint generated always as identity primary key,
  entidad text not null check (entidad in ('anuncio', 'solicitud')),
  entidad_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  lat float8 not null,
  lng float8 not null,
  precision_m float8,
  created_at timestamptz not null default now(),
  unique (entidad, entidad_id)
);

-- Centro desplazado aleatoriamente: el punto real queda DENTRO del círculo,
-- a entre 30 % y 80 % del radio del centro, en una dirección aleatoria.
create or replace function public._zona_aleatoria(p_lat float8, p_lng float8, p_radio int,
  out zlat float8, out zlng float8)
language plpgsql volatile as $$
declare
  d float8 := p_radio * (0.3 + random() * 0.5);
  t float8 := random() * 2 * pi();
begin
  zlat := round((p_lat + (d * cos(t)) / 111320.0)::numeric, 5);
  zlng := round((p_lng + (d * sin(t)) / (111320.0 * cos(radians(p_lat))))::numeric, 5);
end $$;

-- RPC: el navegador envía la ubicación exacta; se guarda en privado y se
-- actualiza la zona pública solo cuando el usuario sale de su zona actual
-- (así, repetir la misma posición no permite "promediar" y hallar el punto real).
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
  if p_evento not in ('seguimiento', 'registro', 'ingreso', 'publicacion', 'solicitud', 'manual') then
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

  select * into v_ult from public.ubicaciones_historial
   where user_id = v_uid order by created_at desc limit 1;
  if p_evento <> 'seguimiento' or v_ult.id is null
     or v_ult.created_at < now() - interval '15 minutes'
     or public.distancia_m(v_ult.lat, v_ult.lng, p_lat, p_lng) > 150 then
    insert into public.ubicaciones_historial (user_id, lat, lng, precision_m, evento)
    values (v_uid, p_lat, p_lng, p_precision, p_evento);
  end if;

  select * into v_p from public.perfiles where id = v_uid;
  return jsonb_build_object('zona_lat', v_p.zona_lat, 'zona_lng', v_p.zona_lng, 'zona_radio', v_p.zona_radio);
end $$;

create or replace function public.registrar_conexion()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform set_config('ofertal.sistema', '1', true);
  update public.perfiles set ultima_conexion = now() where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- CATEGORÍAS
-- ---------------------------------------------------------------------
create table if not exists public.categorias (
  id serial primary key,
  nombre text not null unique,
  icono text not null default '📦',
  tipo text not null default 'ambos' check (tipo in ('producto', 'servicio', 'ambos')),
  orden int not null default 100,
  activa boolean not null default true
);

insert into public.categorias (nombre, icono, tipo, orden) values
  ('Tecnología', '💻', 'producto', 10),
  ('Celulares', '📱', 'producto', 11),
  ('Hogar y muebles', '🛋️', 'producto', 12),
  ('Electrodomésticos', '🔌', 'producto', 13),
  ('Ropa y calzado', '👟', 'producto', 14),
  ('Vehículos y repuestos', '🚗', 'producto', 15),
  ('Deportes', '⚽', 'producto', 16),
  ('Herramientas', '🧰', 'producto', 17),
  ('Mascotas', '🐾', 'ambos', 18),
  ('Alimentos', '🍲', 'ambos', 19),
  ('Agro y campo', '🌾', 'ambos', 20),
  ('Plomería', '🚰', 'servicio', 30),
  ('Electricidad', '⚡', 'servicio', 31),
  ('Construcción y remodelación', '🏗️', 'servicio', 32),
  ('Carpintería', '🪚', 'servicio', 33),
  ('Pintura', '🎨', 'servicio', 34),
  ('Mecánica', '🔧', 'servicio', 35),
  ('Limpieza y aseo', '🧹', 'servicio', 36),
  ('Clases y tutorías', '📚', 'servicio', 37),
  ('Reparación de equipos', '🛠️', 'servicio', 38),
  ('Belleza y cuidado personal', '💇', 'servicio', 39),
  ('Salud y bienestar', '🩺', 'servicio', 40),
  ('Transporte y mudanzas', '🚚', 'servicio', 41),
  ('Eventos', '🎉', 'servicio', 42),
  ('Cuidado de personas', '🤝', 'servicio', 43),
  ('Jardinería', '🌿', 'servicio', 44),
  ('Diseño y marketing', '✏️', 'servicio', 45),
  ('Otros', '📦', 'ambos', 99)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------
-- ANUNCIOS (OFERTAS) — se amplía la tabla existente
-- ---------------------------------------------------------------------
alter table public.anuncios
  add column if not exists categoria text,
  add column if not exists precio_negociable boolean not null default false,
  add column if not exists zona_lat float8,
  add column if not exists zona_lng float8,
  add column if not exists zona_radio int,
  add column if not exists vistas int not null default 0,
  add column if not exists destacado boolean not null default false,
  add column if not exists motivo_rechazo text,
  add column if not exists ia_analisis jsonb,
  add column if not exists aprobado_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.anuncios set aprobado_at = created_at where estado = 'aprobado' and aprobado_at is null;
update public.anuncios set estado = 'pendiente' where estado is null;

alter table public.anuncios alter column estado set default 'pendiente';
alter table public.anuncios alter column estado set not null;
alter table public.anuncios drop constraint if exists anuncios_estado_check;
alter table public.anuncios add constraint anuncios_estado_check
  check (estado in ('pendiente', 'aprobado', 'rechazado', 'pausado', 'vendido'));
alter table public.anuncios drop constraint if exists anuncios_tipo_check;
alter table public.anuncios add constraint anuncios_tipo_check check (tipo in ('producto', 'servicio'));
alter table public.anuncios drop constraint if exists anuncios_precio_check;
alter table public.anuncios add constraint anuncios_precio_check check (precio >= 0);

create index if not exists anuncios_estado_idx on public.anuncios (estado, created_at desc);
create index if not exists anuncios_user_idx on public.anuncios (user_id);
create index if not exists anuncios_categoria_idx on public.anuncios (categoria);

-- ---------------------------------------------------------------------
-- SOLICITUDES (personas que piden un servicio o producto)
-- ---------------------------------------------------------------------
create table if not exists public.solicitudes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 4 and 120),
  descripcion text not null check (char_length(descripcion) between 5 and 2000),
  tipo text not null default 'servicio' check (tipo in ('servicio', 'producto')),
  categoria text,
  presupuesto numeric check (presupuesto is null or presupuesto >= 0),
  urgencia text not null default 'normal' check (urgencia in ('normal', 'pronto', 'urgente')),
  departamento text,
  municipio text,
  zona_lat float8,
  zona_lng float8,
  zona_radio int,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'abierta', 'asignada', 'cerrada', 'rechazada')),
  propuesta_aceptada uuid,
  motivo_rechazo text,
  ia_analisis jsonb,
  vistas int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists solicitudes_estado_idx on public.solicitudes (estado, created_at desc);
create index if not exists solicitudes_user_idx on public.solicitudes (user_id);

-- ---------------------------------------------------------------------
-- NOTIFICACIONES
-- ---------------------------------------------------------------------
create table if not exists public.notificaciones (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  cuerpo text,
  enlace text,
  leida boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notificaciones_user_idx on public.notificaciones (user_id, created_at desc);

create or replace function public.notificar(p_user uuid, p_tipo text, p_titulo text,
  p_cuerpo text default null, p_enlace text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notificaciones (user_id, tipo, titulo, cuerpo, enlace)
  values (p_user, p_tipo, p_titulo, p_cuerpo, p_enlace);
$$;

create or replace function public.notificar_admins(p_tipo text, p_titulo text,
  p_cuerpo text default null, p_enlace text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notificaciones (user_id, tipo, titulo, cuerpo, enlace)
  select id, p_tipo, p_titulo, p_cuerpo, p_enlace from public.perfiles where rol = 'admin' and estado = 'activo';
$$;

create or replace function public.formato_cop(p numeric)
returns text language sql immutable as $$
  select '$' || replace(to_char(p, 'FM999,999,999,990'), ',', '.')
$$;

-- ---------------------------------------------------------------------
-- TRIGGERS DE ANUNCIOS
-- ---------------------------------------------------------------------
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
  select (select count(*) from public.anuncios where user_id = p_uid and created_at > now() - interval '24 hours')
       + (select count(*) from public.solicitudes where user_id = p_uid and created_at > now() - interval '24 hours')
    into v_n;
  if v_n >= coalesce((public.cfg('max_publicaciones_dia') #>> '{}')::int, 15) then
    raise exception 'LIMITE_DIARIO: Alcanzaste el límite de publicaciones por hoy. Intenta mañana.';
  end if;
  if coalesce((public.cfg('requerir_ubicacion') #>> '{}')::boolean, true) then
    select * into v_u from public.ubicaciones where user_id = p_uid;
    if v_u.user_id is null or v_u.updated_at < now() - interval '30 minutes' then
      raise exception 'UBICACION_REQUERIDA: Activa tu ubicación para publicar.';
    end if;
  end if;
  return v_p;
end $$;

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
  new.zona_lat := coalesce(new.zona_lat, v_p.zona_lat);
  new.zona_lng := coalesce(new.zona_lng, v_p.zona_lng);
  new.zona_radio := coalesce(new.zona_radio, v_p.zona_radio);
  new.aprobado_at := case when new.estado = 'aprobado' then now() end;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

create or replace function public.tg_anuncio_despues_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ubicaciones_publicacion (entidad, entidad_id, user_id, lat, lng, precision_m)
  select 'anuncio', new.id, new.user_id, u.lat, u.lng, u.precision_m
    from public.ubicaciones u where u.user_id = new.user_id
  on conflict (entidad, entidad_id) do nothing;
  if new.estado = 'pendiente' then
    perform public.notificar_admins('admin_anuncio', 'Nueva oferta por revisar', new.titulo, 'anuncios');
  end if;
  return new;
end $$;

create or replace function public.tg_anuncio_antes_actualizar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cambio boolean;
begin
  new.updated_at := now();
  if public.es_privilegiado() then
    if new.estado = 'aprobado' and old.estado is distinct from 'aprobado' then
      new.aprobado_at := now();
      new.motivo_rechazo := null;
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
  new.motivo_rechazo := old.motivo_rechazo;
  new.ia_analisis := old.ia_analisis;

  v_cambio := (new.titulo, new.descripcion, new.precio, new.tipo, new.categoria, new.imagen_urls,
               new.departamento, new.municipio, new.precio_negociable)
    is distinct from (old.titulo, old.descripcion, old.precio, old.tipo, old.categoria, old.imagen_urls,
               old.departamento, old.municipio, old.precio_negociable);

  if v_cambio then
    if not public.usuario_activo() then
      raise exception 'CUENTA_SUSPENDIDA: Tu cuenta no está activa.';
    end if;
    if coalesce((public.cfg('auto_aprobar_anuncios') #>> '{}')::boolean, false) and old.estado <> 'rechazado' then
      new.estado := 'aprobado';
      new.aprobado_at := coalesce(old.aprobado_at, now());
    else
      new.estado := 'pendiente';
      new.ia_analisis := null;
    end if;
  elsif new.estado is distinct from old.estado then
    if new.estado in ('pausado', 'vendido') and old.estado in ('aprobado', 'pausado', 'vendido') then
      null;
    elsif new.estado = 'aprobado' and old.estado in ('pausado', 'vendido') and old.aprobado_at is not null then
      null;
    else
      new.estado := old.estado;
    end if;
  end if;
  return new;
end $$;

create or replace function public.tg_anuncio_despues_actualizar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado is distinct from old.estado then
    if public.es_privilegiado() and coalesce(current_setting('ofertal.sistema', true), '') <> '1' then
      if new.estado = 'aprobado' then
        perform public.notificar(new.user_id, 'anuncio_aprobado', '¡Tu publicación fue aprobada! 🎉',
          new.titulo || ' ya es visible para todos.', '#anuncio=' || new.id);
      elsif new.estado = 'rechazado' then
        perform public.notificar(new.user_id, 'anuncio_rechazado', 'Tu publicación no fue aprobada',
          new.titulo || coalesce(' · Motivo: ' || new.motivo_rechazo, ''), '#mis-publicaciones');
      elsif new.estado = 'pausado' then
        perform public.notificar(new.user_id, 'anuncio_pausado', 'Tu publicación fue pausada por el equipo',
          new.titulo, '#mis-publicaciones');
      end if;
    elsif new.estado = 'pendiente' and old.estado <> 'pendiente' then
      perform public.notificar_admins('admin_anuncio', 'Oferta editada por revisar', new.titulo, 'anuncios');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists anuncio_antes_insertar on public.anuncios;
create trigger anuncio_antes_insertar before insert on public.anuncios
  for each row execute function public.tg_anuncio_antes_insertar();
drop trigger if exists anuncio_despues_insertar on public.anuncios;
create trigger anuncio_despues_insertar after insert on public.anuncios
  for each row execute function public.tg_anuncio_despues_insertar();
drop trigger if exists anuncio_antes_actualizar on public.anuncios;
create trigger anuncio_antes_actualizar before update on public.anuncios
  for each row execute function public.tg_anuncio_antes_actualizar();
drop trigger if exists anuncio_despues_actualizar on public.anuncios;
create trigger anuncio_despues_actualizar after update on public.anuncios
  for each row execute function public.tg_anuncio_despues_actualizar();

-- ---------------------------------------------------------------------
-- TRIGGERS DE SOLICITUDES
-- ---------------------------------------------------------------------
create or replace function public._notificar_proveedores(p_solicitud uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  s public.solicitudes;
  n int;
begin
  select * into s from public.solicitudes where id = p_solicitud;
  if s.id is null then return 0; end if;
  insert into public.notificaciones (user_id, tipo, titulo, cuerpo, enlace)
  select x.user_id, 'solicitud_nueva', 'Nueva solicitud: ' || s.titulo,
         coalesce(s.municipio || ', ' || s.departamento, 'Cerca de ti')
           || coalesce(' · Presupuesto ' || public.formato_cop(s.presupuesto), '')
           || case s.urgencia when 'urgente' then ' · ⚡ Urgente' else '' end,
         '#solicitud=' || s.id
  from (
    select distinct a.user_id
    from public.anuncios a
    join public.perfiles p on p.id = a.user_id and p.estado = 'activo'
    where a.estado = 'aprobado'
      and a.user_id <> s.user_id
      and (
        (s.categoria is not null and a.categoria = s.categoria)
        or (s.categoria is null and a.tipo = s.tipo and a.municipio = s.municipio)
      )
      and (
        a.departamento = s.departamento
        or (a.zona_lat is not null and s.zona_lat is not null
            and public.distancia_m(a.zona_lat, a.zona_lng, s.zona_lat, s.zona_lng) <= 50000)
      )
    limit 300
  ) x;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.tg_solicitud_antes_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_p public.perfiles;
begin
  if not public.es_privilegiado() then
    new.user_id := auth.uid();
    v_p := public._validar_publicacion(new.user_id);
    new.zona_lat := null; new.zona_lng := null; new.zona_radio := null;
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
  new.zona_lat := coalesce(new.zona_lat, v_p.zona_lat);
  new.zona_lng := coalesce(new.zona_lng, v_p.zona_lng);
  new.zona_radio := coalesce(new.zona_radio, v_p.zona_radio);
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

create or replace function public.tg_solicitud_despues_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ubicaciones_publicacion (entidad, entidad_id, user_id, lat, lng, precision_m)
  select 'solicitud', new.id, new.user_id, u.lat, u.lng, u.precision_m
    from public.ubicaciones u where u.user_id = new.user_id
  on conflict (entidad, entidad_id) do nothing;
  if new.estado = 'abierta' then
    perform public._notificar_proveedores(new.id);
  else
    perform public.notificar_admins('admin_solicitud', 'Nueva solicitud por revisar', new.titulo, 'solicitudes');
  end if;
  return new;
end $$;

create or replace function public.tg_solicitud_antes_actualizar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cambio boolean;
begin
  new.updated_at := now();
  if public.es_privilegiado() then
    return new;
  end if;
  new.user_id := old.user_id;
  new.zona_lat := old.zona_lat;
  new.zona_lng := old.zona_lng;
  new.zona_radio := old.zona_radio;
  new.ia_analisis := old.ia_analisis;
  new.motivo_rechazo := old.motivo_rechazo;
  new.propuesta_aceptada := old.propuesta_aceptada;
  new.vistas := old.vistas;
  new.created_at := old.created_at;

  v_cambio := (new.titulo, new.descripcion, new.tipo, new.categoria, new.presupuesto, new.urgencia,
               new.departamento, new.municipio)
    is distinct from (old.titulo, old.descripcion, old.tipo, old.categoria, old.presupuesto, old.urgencia,
               old.departamento, old.municipio);

  if new.estado is distinct from old.estado then
    -- El dueño puede cerrar su solicitud o reabrirla (pasa por revisión si la moderación está activa)
    if new.estado = 'cerrada' and old.estado in ('pendiente', 'abierta', 'asignada') then
      null;
    elsif new.estado = 'abierta' and old.estado in ('cerrada', 'asignada') then
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
    if new.estado in ('abierta', 'rechazada')
       and (old.estado in ('rechazada', 'pendiente')
            or not coalesce((public.cfg('auto_aprobar_solicitudes') #>> '{}')::boolean, true)) then
      new.estado := 'pendiente';
    end if;
  end if;
  return new;
end $$;

create or replace function public.tg_solicitud_despues_actualizar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado is distinct from old.estado then
    if new.estado = 'abierta' and old.estado = 'pendiente' then
      if public.es_privilegiado() and coalesce(current_setting('ofertal.sistema', true), '') <> '1' then
        perform public.notificar(new.user_id, 'solicitud_aprobada', 'Tu solicitud ya está publicada ✅',
          new.titulo || ' · Los proveedores cercanos ya pueden verla.', '#solicitud=' || new.id);
      end if;
      perform public._notificar_proveedores(new.id);
    elsif new.estado = 'rechazada' then
      perform public.notificar(new.user_id, 'solicitud_rechazada', 'Tu solicitud no fue aprobada',
        new.titulo || coalesce(' · Motivo: ' || new.motivo_rechazo, ''), '#mis-solicitudes');
    elsif new.estado = 'pendiente' and old.estado <> 'pendiente' then
      perform public.notificar_admins('admin_solicitud', 'Solicitud editada por revisar', new.titulo, 'solicitudes');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists solicitud_antes_insertar on public.solicitudes;
create trigger solicitud_antes_insertar before insert on public.solicitudes
  for each row execute function public.tg_solicitud_antes_insertar();
drop trigger if exists solicitud_despues_insertar on public.solicitudes;
create trigger solicitud_despues_insertar after insert on public.solicitudes
  for each row execute function public.tg_solicitud_despues_insertar();
drop trigger if exists solicitud_antes_actualizar on public.solicitudes;
create trigger solicitud_antes_actualizar before update on public.solicitudes
  for each row execute function public.tg_solicitud_antes_actualizar();
drop trigger if exists solicitud_despues_actualizar on public.solicitudes;
create trigger solicitud_despues_actualizar after update on public.solicitudes
  for each row execute function public.tg_solicitud_despues_actualizar();

-- ---------------------------------------------------------------------
-- CHAT INTERNO
-- ---------------------------------------------------------------------
create table if not exists public.conversaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_a uuid not null references auth.users(id) on delete cascade,
  usuario_b uuid not null references auth.users(id) on delete cascade,
  anuncio_id uuid references public.anuncios(id) on delete set null,
  solicitud_id uuid references public.solicitudes(id) on delete set null,
  ultimo_mensaje text,
  ultimo_emisor uuid,
  ultimo_mensaje_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (usuario_a <> usuario_b)
);
create unique index if not exists conversaciones_par_idx
  on public.conversaciones (least(usuario_a, usuario_b), greatest(usuario_a, usuario_b));

create table if not exists public.mensajes (
  id bigint generated always as identity primary key,
  conversacion_id uuid not null references public.conversaciones(id) on delete cascade,
  emisor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null default 'texto' check (tipo in ('texto', 'contexto', 'propuesta', 'sistema')),
  texto text not null check (char_length(texto) between 1 and 2000),
  anuncio_id uuid,
  solicitud_id uuid,
  leido_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mensajes_conv_idx on public.mensajes (conversacion_id, created_at);

create or replace function public.es_participante(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversaciones
                 where id = p_conv and auth.uid() in (usuario_a, usuario_b))
$$;

create or replace function public.iniciar_conversacion(p_otro uuid, p_anuncio uuid default null,
  p_solicitud uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_conv public.conversaciones;
  v_titulo text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_otro is null or p_otro = v_uid then raise exception 'Conversación inválida'; end if;
  if not public.usuario_activo(v_uid) then
    raise exception 'CUENTA_SUSPENDIDA: Tu cuenta no está activa.';
  end if;
  if not exists (select 1 from public.perfiles where id = p_otro) then
    raise exception 'El usuario no existe';
  end if;

  select * into v_conv from public.conversaciones
   where least(usuario_a, usuario_b) = least(v_uid, p_otro)
     and greatest(usuario_a, usuario_b) = greatest(v_uid, p_otro);

  if v_conv.id is null then
    insert into public.conversaciones (usuario_a, usuario_b, anuncio_id, solicitud_id)
    values (v_uid, p_otro, p_anuncio, p_solicitud)
    returning * into v_conv;
  end if;

  if p_anuncio is not null and (v_conv.anuncio_id is distinct from p_anuncio
     or not exists (select 1 from public.mensajes where conversacion_id = v_conv.id and anuncio_id = p_anuncio)) then
    select titulo into v_titulo from public.anuncios where id = p_anuncio;
    if v_titulo is not null then
      insert into public.mensajes (conversacion_id, emisor_id, tipo, texto, anuncio_id)
      values (v_conv.id, v_uid, 'contexto', 'Consulta sobre: ' || v_titulo, p_anuncio);
      update public.conversaciones set anuncio_id = p_anuncio, solicitud_id = null where id = v_conv.id;
    end if;
  elsif p_solicitud is not null and (v_conv.solicitud_id is distinct from p_solicitud
     or not exists (select 1 from public.mensajes where conversacion_id = v_conv.id and solicitud_id = p_solicitud)) then
    select titulo into v_titulo from public.solicitudes where id = p_solicitud;
    if v_titulo is not null then
      insert into public.mensajes (conversacion_id, emisor_id, tipo, texto, solicitud_id)
      values (v_conv.id, v_uid, 'contexto', 'Sobre la solicitud: ' || v_titulo, p_solicitud);
      update public.conversaciones set solicitud_id = p_solicitud, anuncio_id = null where id = v_conv.id;
    end if;
  end if;
  return v_conv.id;
end $$;

create or replace function public.tg_mensaje_antes_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.leido_at := null;
  if not public.es_privilegiado() and new.tipo = 'texto' then
    new.emisor_id := auth.uid();
    if not public.usuario_activo() then
      raise exception 'CUENTA_SUSPENDIDA: Tu cuenta no está activa.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.tg_mensaje_despues_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conv public.conversaciones;
  v_dest uuid;
  v_nombre text;
begin
  update public.conversaciones
     set ultimo_mensaje = left(new.texto, 140), ultimo_emisor = new.emisor_id, ultimo_mensaje_at = new.created_at
   where id = new.conversacion_id
   returning * into v_conv;
  v_dest := case when v_conv.usuario_a = new.emisor_id then v_conv.usuario_b else v_conv.usuario_a end;
  if not exists (select 1 from public.notificaciones
                  where user_id = v_dest and tipo = 'mensaje' and not leida
                    and enlace = '#chat=' || new.conversacion_id) then
    select coalesce(nombre, 'Un usuario') into v_nombre from public.perfiles where id = new.emisor_id;
    perform public.notificar(v_dest, 'mensaje', 'Nuevo mensaje de ' || v_nombre, left(new.texto, 120),
      '#chat=' || new.conversacion_id);
  end if;
  return new;
end $$;

drop trigger if exists mensaje_antes_insertar on public.mensajes;
create trigger mensaje_antes_insertar before insert on public.mensajes
  for each row execute function public.tg_mensaje_antes_insertar();
drop trigger if exists mensaje_despues_insertar on public.mensajes;
create trigger mensaje_despues_insertar after insert on public.mensajes
  for each row execute function public.tg_mensaje_despues_insertar();

create or replace function public.marcar_leidos(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_participante(p_conv) then return; end if;
  update public.mensajes set leido_at = now()
   where conversacion_id = p_conv and emisor_id <> auth.uid() and leido_at is null;
  update public.notificaciones set leida = true
   where user_id = auth.uid() and tipo = 'mensaje' and enlace = '#chat=' || p_conv and not leida;
end $$;

create or replace function public.mis_no_leidos()
returns table (conversacion_id uuid, total int) language sql stable security definer set search_path = public as $$
  select m.conversacion_id, count(*)::int
    from public.mensajes m
    join public.conversaciones c on c.id = m.conversacion_id
   where auth.uid() in (c.usuario_a, c.usuario_b)
     and m.emisor_id <> auth.uid()
     and m.leido_at is null
   group by m.conversacion_id
$$;

-- ---------------------------------------------------------------------
-- PROPUESTAS A SOLICITUDES
-- ---------------------------------------------------------------------
create table if not exists public.propuestas (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes(id) on delete cascade,
  proveedor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mensaje text not null check (char_length(mensaje) between 1 and 1500),
  precio numeric check (precio is null or precio >= 0),
  estado text not null default 'enviada' check (estado in ('enviada', 'aceptada', 'rechazada', 'retirada')),
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (solicitud_id, proveedor_id)
);

create or replace function public.enviar_propuesta(p_solicitud uuid, p_mensaje text, p_precio numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s public.solicitudes;
  v_conv uuid;
  v_prop uuid;
  v_nombre text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not public.usuario_activo(v_uid) then raise exception 'CUENTA_SUSPENDIDA: Tu cuenta no está activa.'; end if;
  select * into s from public.solicitudes where id = p_solicitud;
  if s.id is null then raise exception 'La solicitud no existe'; end if;
  if s.user_id = v_uid then raise exception 'No puedes enviar propuestas a tu propia solicitud'; end if;
  if s.estado <> 'abierta' then raise exception 'Esta solicitud ya no recibe propuestas'; end if;
  if coalesce(trim(p_mensaje), '') = '' then raise exception 'Escribe un mensaje para tu propuesta'; end if;

  v_conv := public.iniciar_conversacion(s.user_id, null, s.id);

  insert into public.propuestas (solicitud_id, proveedor_id, mensaje, precio, conversacion_id)
  values (s.id, v_uid, trim(p_mensaje), p_precio, v_conv)
  on conflict (solicitud_id, proveedor_id) do update
    set mensaje = excluded.mensaje, precio = excluded.precio, estado = 'enviada',
        conversacion_id = excluded.conversacion_id, created_at = now()
  returning id into v_prop;

  insert into public.mensajes (conversacion_id, emisor_id, tipo, texto, solicitud_id)
  values (v_conv, v_uid, 'propuesta',
          '💼 Propuesta' || coalesce(' por ' || public.formato_cop(p_precio), '') || ': ' || trim(p_mensaje),
          s.id);

  select coalesce(nombre, 'Un proveedor') into v_nombre from public.perfiles where id = v_uid;
  perform public.notificar(s.user_id, 'propuesta', 'Nueva propuesta de ' || v_nombre,
    s.titulo || coalesce(' · ' || public.formato_cop(p_precio), ''), '#solicitud=' || s.id);
  return v_conv;
end $$;

create or replace function public.responder_propuesta(p_propuesta uuid, p_aceptar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.propuestas;
  s public.solicitudes;
begin
  select * into p from public.propuestas where id = p_propuesta;
  if p.id is null then raise exception 'La propuesta no existe'; end if;
  select * into s from public.solicitudes where id = p.solicitud_id;
  if s.user_id is distinct from v_uid and not public.es_admin() then raise exception 'No autorizado'; end if;
  if p.estado <> 'enviada' then raise exception 'Esta propuesta ya fue respondida'; end if;

  perform set_config('ofertal.sistema', '1', true);
  if p_aceptar then
    update public.propuestas set estado = 'aceptada' where id = p.id;
    update public.solicitudes set estado = 'asignada', propuesta_aceptada = p.id where id = s.id;
    perform public.notificar(p.proveedor_id, 'propuesta_aceptada', '¡Aceptaron tu propuesta! 🤝',
      s.titulo || ' · Coordina los detalles por el chat.', coalesce('#chat=' || p.conversacion_id, '#solicitud=' || s.id));
    if p.conversacion_id is not null then
      insert into public.mensajes (conversacion_id, emisor_id, tipo, texto, solicitud_id)
      values (p.conversacion_id, v_uid, 'sistema', '✅ Propuesta aceptada. ¡Coordinen los detalles!', s.id);
    end if;
  else
    update public.propuestas set estado = 'rechazada' where id = p.id;
    perform public.notificar(p.proveedor_id, 'propuesta_rechazada', 'Tu propuesta no fue seleccionada',
      s.titulo, '#solicitud=' || s.id);
  end if;
end $$;

create or replace function public.retirar_propuesta(p_propuesta uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.propuestas set estado = 'retirada'
   where id = p_propuesta and proveedor_id = auth.uid() and estado = 'enviada';
end $$;

-- ---------------------------------------------------------------------
-- FAVORITOS, RESEÑAS, REPORTES
-- ---------------------------------------------------------------------
create table if not exists public.favoritos (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  anuncio_id uuid not null references public.anuncios(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, anuncio_id)
);

create table if not exists public.resenas (
  id uuid primary key default gen_random_uuid(),
  autor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  estrellas int not null check (estrellas between 1 and 5),
  comentario text check (comentario is null or char_length(comentario) <= 600),
  created_at timestamptz not null default now(),
  unique (autor_id, usuario_id),
  check (autor_id <> usuario_id)
);

create or replace function public.puede_resenar(p_usuario uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and auth.uid() <> p_usuario and exists (
    select 1 from public.conversaciones c
     where least(c.usuario_a, c.usuario_b) = least(auth.uid(), p_usuario)
       and greatest(c.usuario_a, c.usuario_b) = greatest(auth.uid(), p_usuario)
       and exists (select 1 from public.mensajes m where m.conversacion_id = c.id and m.emisor_id = p_usuario))
$$;

create or replace function public.tg_resena_notificar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notificar(new.usuario_id, 'resena', 'Recibiste una calificación de ' || new.estrellas || ' ⭐',
    left(coalesce(new.comentario, ''), 120), '#usuario=' || new.usuario_id);
  return new;
end $$;
drop trigger if exists resena_notificar on public.resenas;
create trigger resena_notificar after insert on public.resenas
  for each row execute function public.tg_resena_notificar();

create table if not exists public.reportes (
  id uuid primary key default gen_random_uuid(),
  reportante_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entidad text not null check (entidad in ('anuncio', 'solicitud', 'usuario', 'conversacion')),
  entidad_id text not null,
  motivo text not null,
  detalle text check (detalle is null or char_length(detalle) <= 1000),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'revisado', 'descartado')),
  nota_admin text,
  resuelto_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.tg_reporte_notificar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notificar_admins('admin_reporte', 'Nuevo reporte: ' || new.motivo,
    new.entidad || ' · ' || left(coalesce(new.detalle, ''), 100), 'reportes');
  return new;
end $$;
drop trigger if exists reporte_notificar on public.reportes;
create trigger reporte_notificar after insert on public.reportes
  for each row execute function public.tg_reporte_notificar();

-- ---------------------------------------------------------------------
-- SOPORTE
-- ---------------------------------------------------------------------
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  asunto text not null check (char_length(asunto) between 3 and 150),
  descripcion text not null check (char_length(descripcion) between 3 and 3000),
  categoria text not null default 'otro'
    check (categoria in ('cuenta', 'publicacion', 'solicitud', 'seguridad', 'reporte', 'sugerencia', 'otro')),
  estado text not null default 'abierto'
    check (estado in ('abierto', 'en_proceso', 'esperando_usuario', 'resuelto', 'cerrado')),
  prioridad text not null default 'normal' check (prioridad in ('baja', 'normal', 'alta', 'urgente')),
  referencia text,
  contacto text,
  nombre_contacto text,
  no_leido_admin boolean not null default true,
  no_leido_usuario boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tickets_estado_idx on public.tickets (estado, updated_at desc);

create table if not exists public.tickets_mensajes (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  autor_id uuid default auth.uid() references auth.users(id) on delete set null,
  es_admin boolean not null default false,
  texto text not null check (char_length(texto) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index if not exists tickets_mensajes_idx on public.tickets_mensajes (ticket_id, created_at);

create or replace function public.tg_ticket_antes_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  new.created_at := now();
  new.updated_at := now();
  new.no_leido_admin := true;
  new.no_leido_usuario := false;
  if not public.es_privilegiado() then
    new.user_id := auth.uid();
    new.estado := 'abierto';
    if new.categoria = 'seguridad' then new.prioridad := 'alta'; else new.prioridad := 'normal'; end if;
    if new.user_id is null then
      -- Solicitud anónima (p. ej. recuperar PIN): exige contacto y limita el abuso
      if coalesce(trim(new.contacto), '') !~ '^3[0-9]{9}$' then
        raise exception 'Indica un número de WhatsApp colombiano válido';
      end if;
      select count(*) into v_n from public.tickets
       where user_id is null and contacto = new.contacto and created_at > now() - interval '24 hours';
      if v_n >= 3 then raise exception 'Ya recibimos tus solicitudes. Te contactaremos pronto.'; end if;
      new.categoria := 'cuenta';
    else
      select count(*) into v_n from public.tickets
       where user_id = new.user_id and created_at > now() - interval '24 hours';
      if v_n >= 10 then raise exception 'Has creado demasiados tickets hoy. Responde en uno existente.'; end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.tg_ticket_despues_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notificar_admins('admin_ticket', 'Nuevo ticket #' || new.numero || ': ' || new.asunto,
    left(new.descripcion, 120), 'soporte');
  return new;
end $$;

create or replace function public.tg_ticket_antes_actualizar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.es_privilegiado() then
    new.updated_at := now();
    return new;
  end if;
  -- El usuario solo puede cerrar su ticket o marcarlo como leído
  if new.estado is distinct from old.estado and new.estado not in ('cerrado', 'resuelto') then
    new.estado := old.estado;
  end if;
  new.user_id := old.user_id;
  new.asunto := old.asunto;
  new.descripcion := old.descripcion;
  new.categoria := old.categoria;
  new.prioridad := old.prioridad;
  new.contacto := old.contacto;
  new.no_leido_admin := old.no_leido_admin;
  new.created_at := old.created_at;
  return new;
end $$;

create or replace function public.tg_ticket_mensaje_antes_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  if auth.uid() is not null then
    new.autor_id := auth.uid();
    new.es_admin := public.es_admin();
  end if;
  return new;
end $$;

create or replace function public.tg_ticket_mensaje_despues_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.tickets;
begin
  perform set_config('ofertal.sistema', '1', true);
  if new.es_admin then
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

drop trigger if exists ticket_antes_insertar on public.tickets;
create trigger ticket_antes_insertar before insert on public.tickets
  for each row execute function public.tg_ticket_antes_insertar();
drop trigger if exists ticket_despues_insertar on public.tickets;
create trigger ticket_despues_insertar after insert on public.tickets
  for each row execute function public.tg_ticket_despues_insertar();
drop trigger if exists ticket_antes_actualizar on public.tickets;
create trigger ticket_antes_actualizar before update on public.tickets
  for each row execute function public.tg_ticket_antes_actualizar();
drop trigger if exists ticket_mensaje_antes_insertar on public.tickets_mensajes;
create trigger ticket_mensaje_antes_insertar before insert on public.tickets_mensajes
  for each row execute function public.tg_ticket_mensaje_antes_insertar();
drop trigger if exists ticket_mensaje_despues_insertar on public.tickets_mensajes;
create trigger ticket_mensaje_despues_insertar after insert on public.tickets_mensajes
  for each row execute function public.tg_ticket_mensaje_despues_insertar();

-- ---------------------------------------------------------------------
-- USO DE IA Y REGISTRO DE ADMINISTRACIÓN
-- ---------------------------------------------------------------------
create table if not exists public.ia_uso (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  accion text not null,
  created_at timestamptz not null default now()
);
create index if not exists ia_uso_user_idx on public.ia_uso (user_id, created_at desc);

create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  admin_id uuid default auth.uid() references auth.users(id) on delete set null,
  accion text not null,
  entidad text,
  entidad_id text,
  detalle jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_log_idx on public.admin_log (created_at desc);

-- ---------------------------------------------------------------------
-- VISTA PÚBLICA DE PERFILES (sin teléfono, edad ni ubicación exacta)
-- ---------------------------------------------------------------------
create or replace view public.perfiles_publicos as
select p.id, p.nombre, p.departamento, p.municipio, p.bio, p.avatar_url, p.verificado,
       p.zona_lat, p.zona_lng, p.zona_radio, p.zona_actualizada, p.ultima_conexion, p.created_at,
       coalesce(r.promedio, 0)::numeric as calificacion,
       coalesce(r.total, 0)::int as num_resenas
from public.perfiles p
left join (
  select usuario_id, round(avg(estrellas)::numeric, 1) as promedio, count(*) as total
  from public.resenas group by usuario_id
) r on r.usuario_id = p.id
where p.estado = 'activo';

-- ---------------------------------------------------------------------
-- VISTAS / CONTADORES
-- ---------------------------------------------------------------------
create or replace function public.sumar_vista(p_entidad text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('ofertal.sistema', '1', true);
  if p_entidad = 'anuncio' then
    update public.anuncios set vistas = vistas + 1 where id = p_id and estado = 'aprobado'
      and user_id is distinct from auth.uid();
  elsif p_entidad = 'solicitud' then
    update public.solicitudes set vistas = vistas + 1 where id = p_id and estado in ('abierta', 'asignada')
      and user_id is distinct from auth.uid();
  end if;
end $$;

create or replace function public.contar_propuestas(p_solicitudes uuid[])
returns table (solicitud_id uuid, total int) language sql stable security definer set search_path = public as $$
  select solicitud_id, count(*)::int from public.propuestas
   where solicitud_id = any(p_solicitudes) and estado <> 'retirada'
   group by solicitud_id
$$;

-- ---------------------------------------------------------------------
-- FUNCIONES DE ADMINISTRACIÓN
-- ---------------------------------------------------------------------
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
    'con_ubicacion', (select count(*) from public.ubicaciones),
    'ubicacion_reciente', (select count(*) from public.ubicaciones where updated_at > now() - interval '24 hours'),
    'anuncios_total', (select count(*) from public.anuncios),
    'anuncios_aprobados', (select count(*) from public.anuncios where estado = 'aprobado'),
    'anuncios_pendientes', (select count(*) from public.anuncios where estado = 'pendiente'),
    'anuncios_rechazados', (select count(*) from public.anuncios where estado = 'rechazado'),
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

create or replace function public.admin_usuarios()
returns table (
  id uuid, nombre text, whatsapp text, edad int, departamento text, municipio text, bio text,
  avatar_url text, rol text, estado text, motivo_suspension text, verificado boolean,
  zona_lat float8, zona_lng float8, zona_radio int, ultima_conexion timestamptz, created_at timestamptz,
  ultimo_ingreso timestamptz, lat float8, lng float8, precision_m float8, ubicacion_at timestamptz,
  num_anuncios int, num_solicitudes int, calificacion numeric, num_resenas int
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
         (select count(*)::int from public.resenas r where r.usuario_id = p.id)
  from public.perfiles p
  left join auth.users u on u.id = p.id
  left join public.ubicaciones ub on ub.user_id = p.id
  order by p.created_at desc;
end $$;

create or replace function public.admin_notificar_todos(p_titulo text, p_cuerpo text default null,
  p_enlace text default null, p_departamento text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  insert into public.notificaciones (user_id, tipo, titulo, cuerpo, enlace)
  select id, 'aviso', p_titulo, p_cuerpo, p_enlace from public.perfiles
   where estado = 'activo' and (p_departamento is null or departamento = p_departamento);
  get diagnostics n = row_count;
  insert into public.admin_log (accion, entidad, detalle)
  values ('notificacion_masiva', 'usuarios', jsonb_build_object('titulo', p_titulo, 'destinatarios', n, 'departamento', p_departamento));
  return n;
end $$;

create or replace function public.admin_notificar(p_user uuid, p_titulo text, p_cuerpo text default null,
  p_enlace text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  perform public.notificar(p_user, 'aviso', p_titulo, p_cuerpo, p_enlace);
  insert into public.admin_log (accion, entidad, entidad_id, detalle)
  values ('notificar_usuario', 'usuario', p_user::text, jsonb_build_object('titulo', p_titulo));
end $$;

-- ---------------------------------------------------------------------
-- SEGURIDAD: RLS Y PERMISOS
-- ---------------------------------------------------------------------
alter table public.config enable row level security;
alter table public.perfiles enable row level security;
alter table public.ubicaciones enable row level security;
alter table public.ubicaciones_historial enable row level security;
alter table public.ubicaciones_publicacion enable row level security;
alter table public.categorias enable row level security;
alter table public.anuncios enable row level security;
alter table public.solicitudes enable row level security;
alter table public.notificaciones enable row level security;
alter table public.conversaciones enable row level security;
alter table public.mensajes enable row level security;
alter table public.propuestas enable row level security;
alter table public.favoritos enable row level security;
alter table public.resenas enable row level security;
alter table public.reportes enable row level security;
alter table public.tickets enable row level security;
alter table public.tickets_mensajes enable row level security;
alter table public.ia_uso enable row level security;
alter table public.admin_log enable row level security;

-- Limpia políticas anteriores de anuncios
drop policy if exists "Permitir inserción autenticada" on public.anuncios;
drop policy if exists "Lectura de aprobados o propias" on public.anuncios;
drop policy if exists "Permitir actualizaciones propias" on public.anuncios;
drop policy if exists "Permitir eliminaciones propias" on public.anuncios;

do $$
declare
  t text;
  pol record;
begin
  -- Elimina políticas "ofertal_*" previas para recrearlas limpias
  for pol in select schemaname, tablename, policyname from pg_policies
             where policyname like 'ofertal_%' and schemaname in ('public', 'storage') loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- config
create policy ofertal_config_leer on public.config for select using (true);
create policy ofertal_config_admin on public.config for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- perfiles
create policy ofertal_perfiles_leer on public.perfiles for select to authenticated
  using (id = auth.uid() or public.es_admin());
create policy ofertal_perfiles_editar on public.perfiles for update to authenticated
  using (id = auth.uid() or public.es_admin()) with check (id = auth.uid() or public.es_admin());
create policy ofertal_perfiles_borrar on public.perfiles for delete to authenticated using (public.es_admin());

-- ubicaciones (privadas)
create policy ofertal_ubicaciones_leer on public.ubicaciones for select to authenticated
  using (user_id = auth.uid() or public.es_admin());
create policy ofertal_ubic_hist_leer on public.ubicaciones_historial for select to authenticated
  using (user_id = auth.uid() or public.es_admin());
create policy ofertal_ubic_pub_leer on public.ubicaciones_publicacion for select to authenticated
  using (user_id = auth.uid() or public.es_admin());

-- categorías
create policy ofertal_categorias_leer on public.categorias for select using (true);
create policy ofertal_categorias_admin on public.categorias for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- anuncios
create policy ofertal_anuncios_leer on public.anuncios for select
  using ((estado = 'aprobado' and not public.usuario_suspendido(user_id))
         or user_id = auth.uid() or public.es_admin());
create policy ofertal_anuncios_crear on public.anuncios for insert to authenticated
  with check (user_id = auth.uid() or public.es_admin());
create policy ofertal_anuncios_editar on public.anuncios for update to authenticated
  using (user_id = auth.uid() or public.es_admin()) with check (user_id = auth.uid() or public.es_admin());
create policy ofertal_anuncios_borrar on public.anuncios for delete to authenticated
  using (user_id = auth.uid() or public.es_admin());

-- solicitudes
create policy ofertal_solicitudes_leer on public.solicitudes for select
  using ((estado in ('abierta', 'asignada') and not public.usuario_suspendido(user_id))
         or user_id = auth.uid() or public.es_admin());
create policy ofertal_solicitudes_crear on public.solicitudes for insert to authenticated
  with check (user_id = auth.uid() or public.es_admin());
create policy ofertal_solicitudes_editar on public.solicitudes for update to authenticated
  using (user_id = auth.uid() or public.es_admin()) with check (user_id = auth.uid() or public.es_admin());
create policy ofertal_solicitudes_borrar on public.solicitudes for delete to authenticated
  using (user_id = auth.uid() or public.es_admin());

-- notificaciones
create policy ofertal_notif_leer on public.notificaciones for select to authenticated
  using (user_id = auth.uid());
create policy ofertal_notif_editar on public.notificaciones for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ofertal_notif_borrar on public.notificaciones for delete to authenticated
  using (user_id = auth.uid());

-- conversaciones / mensajes
create policy ofertal_conv_leer on public.conversaciones for select to authenticated
  using (auth.uid() in (usuario_a, usuario_b) or public.es_admin());
create policy ofertal_msj_leer on public.mensajes for select to authenticated
  using (public.es_participante(conversacion_id) or public.es_admin());
create policy ofertal_msj_crear on public.mensajes for insert to authenticated
  with check (emisor_id = auth.uid() and tipo = 'texto' and public.es_participante(conversacion_id));

-- propuestas
create policy ofertal_prop_leer on public.propuestas for select to authenticated
  using (proveedor_id = auth.uid() or public.es_admin()
         or exists (select 1 from public.solicitudes s where s.id = solicitud_id and s.user_id = auth.uid()));

-- favoritos
create policy ofertal_fav_leer on public.favoritos for select to authenticated using (user_id = auth.uid());
create policy ofertal_fav_crear on public.favoritos for insert to authenticated with check (user_id = auth.uid());
create policy ofertal_fav_borrar on public.favoritos for delete to authenticated using (user_id = auth.uid());

-- reseñas
create policy ofertal_resenas_leer on public.resenas for select using (true);
create policy ofertal_resenas_crear on public.resenas for insert to authenticated
  with check (autor_id = auth.uid() and public.puede_resenar(usuario_id) and public.usuario_activo());
create policy ofertal_resenas_editar on public.resenas for update to authenticated
  using (autor_id = auth.uid()) with check (autor_id = auth.uid());
create policy ofertal_resenas_borrar on public.resenas for delete to authenticated
  using (autor_id = auth.uid() or public.es_admin());

-- reportes
create policy ofertal_reportes_crear on public.reportes for insert to authenticated
  with check (reportante_id = auth.uid());
create policy ofertal_reportes_leer on public.reportes for select to authenticated
  using (reportante_id = auth.uid() or public.es_admin());
create policy ofertal_reportes_admin on public.reportes for update to authenticated
  using (public.es_admin()) with check (public.es_admin());
create policy ofertal_reportes_borrar on public.reportes for delete to authenticated using (public.es_admin());

-- tickets
create policy ofertal_tickets_leer on public.tickets for select to authenticated
  using (user_id = auth.uid() or public.es_admin());
create policy ofertal_tickets_crear on public.tickets for insert to authenticated
  with check (user_id = auth.uid());
create policy ofertal_tickets_crear_anon on public.tickets for insert to anon
  with check (user_id is null);
create policy ofertal_tickets_editar on public.tickets for update to authenticated
  using (user_id = auth.uid() or public.es_admin()) with check (user_id = auth.uid() or public.es_admin());
create policy ofertal_tickets_borrar on public.tickets for delete to authenticated using (public.es_admin());
create policy ofertal_tmsj_leer on public.tickets_mensajes for select to authenticated
  using (public.es_admin() or exists (select 1 from public.tickets t where t.id = ticket_id and t.user_id = auth.uid()));
create policy ofertal_tmsj_crear on public.tickets_mensajes for insert to authenticated
  with check (public.es_admin() or exists (select 1 from public.tickets t where t.id = ticket_id and t.user_id = auth.uid()));

-- ia_uso / admin_log
create policy ofertal_ia_uso_admin on public.ia_uso for select to authenticated using (public.es_admin());
create policy ofertal_log_leer on public.admin_log for select to authenticated using (public.es_admin());
create policy ofertal_log_crear on public.admin_log for insert to authenticated with check (public.es_admin());

-- El teléfono (contacto) de los anuncios no es visible para visitantes sin cuenta
revoke select on public.anuncios from anon;
grant select (id, created_at, titulo, tipo, descripcion, precio, imagen_url, estado, user_id, departamento,
              municipio, imagen_urls, categoria, precio_negociable, zona_lat, zona_lng, zona_radio, vistas,
              destacado, aprobado_at, updated_at)
  on public.anuncios to anon;

grant select on public.perfiles_publicos to anon, authenticated;

-- Funciones internas: no invocables desde la API
revoke execute on function public.notificar(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.notificar_admins(text, text, text, text) from public, anon, authenticated;
revoke execute on function public._notificar_proveedores(uuid) from public, anon, authenticated;
revoke execute on function public._zona_aleatoria(float8, float8, int) from public, anon, authenticated;
revoke execute on function public._validar_publicacion(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- STORAGE: cada usuario sube a su propia carpeta
-- ---------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'imagenes';

drop policy if exists "Subida autenticada" on storage.objects;
create policy ofertal_img_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'imagenes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy ofertal_img_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'imagenes' and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin()));

-- ---------------------------------------------------------------------
-- REALTIME
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['mensajes', 'notificaciones', 'conversaciones', 'tickets', 'tickets_mensajes',
                           'anuncios', 'solicitudes', 'reportes'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
