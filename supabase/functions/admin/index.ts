// OFERTAL · Edge Function "admin"
// Acciones que requieren la llave de servicio (nunca expuesta en el navegador).
// Solo usuarios con rol "admin" pueden invocarla.
//   reset_pin         → asigna un PIN nuevo de 4 dígitos a un usuario
//   eliminar_usuario  → borra la cuenta y todo su contenido
//   cambiar_password  → cambia la contraseña del administrador que llama
//   importar          → crea (o reutiliza) la cuenta de un número de WhatsApp y le publica un anuncio
//   regenerar_activacion → nuevo enlace de activación para una cuenta importada
//   editar_usuario    → corrige nombre, edad, municipio o número (los usuarios no pueden cambiarlos)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PIN_SALT = "9876"; // Debe coincidir con el frontend (contraseña = PIN + sal)

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function adminDesde(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sesión no válida");
  const { data: p } = await db.from("perfiles").select("rol, estado").eq("id", data.user.id).single();
  if (p?.rol !== "admin" || p?.estado !== "activo") throw new HttpError(403, "Solo administradores");
  return data.user;
}

async function log(adminId: string, accion: string, entidadId: string, detalle: Record<string, unknown> = {}, entidad = "usuario") {
  await db.from("admin_log").insert({ admin_id: adminId, accion, entidad, entidad_id: entidadId, detalle });
}

const tokenAleatorio = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const passwordAleatoria = () => tokenAleatorio() + "#Aa1";
const recortar = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

async function asegurarActivacion(userId: string, adminId: string, forzarNuevo = false) {
  const { data: act } = await db.from("activaciones").select("*").eq("user_id", userId).maybeSingle();
  if (act && !forzarNuevo && !act.usado_at && new Date(act.expira_at) > new Date()) return act.token as string;
  const token = tokenAleatorio();
  const expira = new Date(Date.now() + 90 * 864e5).toISOString();
  await db.from("activaciones").upsert({ user_id: userId, token, creado_por: adminId, created_at: new Date().toISOString(), expira_at: expira, usado_at: null, copias: 0 });
  return token;
}

async function publicacionesImportadas(userId: string) {
  const { data } = await db.from("anuncios").select("id, titulo").eq("user_id", userId).eq("fuente", "whatsapp")
    .in("estado", ["aprobado", "pendiente"]).order("created_at", { ascending: false }).limit(10);
  return data ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
    const admin = await adminDesde(req);
    const body = await req.json().catch(() => ({}));

    if (body.accion === "reset_pin") {
      const pin = String(body.pin ?? "");
      if (!/^\d{4}$/.test(pin)) throw new HttpError(400, "El PIN debe tener 4 dígitos");
      const { data: u, error } = await db.auth.admin.getUserById(body.user_id);
      if (error || !u.user) throw new HttpError(404, "Usuario no encontrado");
      if (!/^3\d{9}@ofertal\.com$/.test(u.user.email ?? "")) {
        throw new HttpError(400, "Esta cuenta no usa PIN (es una cuenta de correo)");
      }
      const { error: e2 } = await db.auth.admin.updateUserById(body.user_id, { password: pin + PIN_SALT });
      if (e2) throw new HttpError(400, e2.message);
      await log(admin.id, "reset_pin", body.user_id);
      await db.from("notificaciones").insert({
        user_id: body.user_id, tipo: "aviso", titulo: "Tu PIN fue restablecido por soporte",
        cuerpo: "Si no lo solicitaste, escríbenos desde Soporte.", enlace: "#perfil",
      });
      return json({ ok: true });
    }

    if (body.accion === "eliminar_usuario") {
      if (body.user_id === admin.id) throw new HttpError(400, "No puedes eliminar tu propia cuenta");
      const { data: p } = await db.from("perfiles").select("nombre, whatsapp").eq("id", body.user_id).single();
      await db.from("anuncios").delete().eq("user_id", body.user_id);
      await db.from("solicitudes").delete().eq("user_id", body.user_id);
      const { data: archivos } = await db.storage.from("imagenes").list(body.user_id, { limit: 1000 });
      if (archivos?.length) {
        await db.storage.from("imagenes").remove(archivos.map((f) => `${body.user_id}/${f.name}`));
      }
      const { error } = await db.auth.admin.deleteUser(body.user_id);
      if (error) throw new HttpError(400, error.message);
      await log(admin.id, "eliminar_usuario", body.user_id, { nombre: p?.nombre, whatsapp: p?.whatsapp });
      return json({ ok: true });
    }

    if (body.accion === "cambiar_password") {
      const pass = String(body.password ?? "");
      if (pass.length < 10) throw new HttpError(400, "La contraseña debe tener al menos 10 caracteres");
      const { error } = await db.auth.admin.updateUserById(admin.id, { password: pass });
      if (error) throw new HttpError(400, error.message);
      await log(admin.id, "cambiar_password", admin.id);
      return json({ ok: true });
    }

    if (body.accion === "importar") {
      const tel = String(body.telefono ?? "").replace(/\D/g, "").replace(/^57(?=3\d{9}$)/, "");
      if (!/^3\d{9}$/.test(tel)) throw new HttpError(400, "Número de WhatsApp colombiano no válido");
      const a = body.anuncio ?? {};
      const tipo = ["producto", "servicio", "inmueble"].includes(a.tipo) ? a.tipo : "producto";
      const titulo = recortar(a.titulo, 100);
      const descripcion = recortar(a.descripcion, 2000);
      if (titulo.length < 3) throw new HttpError(400, "El título es muy corto");
      if (descripcion.length < 3) throw new HttpError(400, "La descripción es muy corta");

      // 1) Cuenta: se reutiliza si el número ya existe
      let { data: perfil } = await db.from("perfiles").select("*").eq("whatsapp", tel).maybeSingle();
      let nuevo = false;
      if (!perfil) {
        const { data: creado, error } = await db.auth.admin.createUser({
          email: `${tel}@ofertal.com`, password: passwordAleatoria(), email_confirm: true,
          user_metadata: { whatsapp: tel, origen: "whatsapp", departamento: a.departamento ?? null, municipio: a.municipio ?? null },
        });
        if (error || !creado.user) throw new HttpError(400, "No se pudo crear la cuenta: " + (error?.message ?? ""));
        await db.from("perfiles").update({ origen: "whatsapp", registro_completo: false, departamento: a.departamento || null, municipio: a.municipio || null })
          .eq("id", creado.user.id);
        ({ data: perfil } = await db.from("perfiles").select("*").eq("id", creado.user.id).single());
        nuevo = true;
      }
      if (perfil.estado !== "activo") throw new HttpError(400, "La cuenta de este número está suspendida");

      // 2) Anuncio publicado (lo revisó el administrador)
      const precio = Math.max(0, Math.round(Number(a.precio) || 0));
      const imagenes = Array.isArray(a.imagen_urls) ? a.imagen_urls.filter((u: unknown) => typeof u === "string").slice(0, 8) : [];
      const zona = body.zona && Number.isFinite(body.zona.lat) && Number.isFinite(body.zona.lng) ? body.zona : null;
      const { data: anuncio, error: e2 } = await db.from("anuncios").insert({
        user_id: perfil.id, titulo, descripcion, tipo,
        operacion: tipo === "inmueble" ? (a.operacion === "arriendo" ? "arriendo" : "venta") : null,
        categoria: a.categoria || null, precio, precio_negociable: !!a.precio_negociable,
        detalles: a.detalles && typeof a.detalles === "object" ? a.detalles : {},
        departamento: a.departamento || perfil.departamento, municipio: a.municipio || perfil.municipio,
        imagen_urls: imagenes, contacto: tel, estado: "aprobado", fuente: "whatsapp",
        ...(zona && perfil.zona_lat == null ? { zona_lat: zona.lat, zona_lng: zona.lng, zona_radio: Math.round(zona.radio || 3000), zona_fuente: "municipio" } : {}),
      }).select("id").single();
      if (e2) throw new HttpError(400, "No se pudo publicar: " + e2.message);

      // 3) Enlace de activación para que la persona cree su propio PIN
      const token = perfil.registro_completo ? null : await asegurarActivacion(perfil.id, admin.id);
      await log(admin.id, "importar_whatsapp", anuncio.id, { telefono: tel, titulo, nuevo_usuario: nuevo }, "anuncio");
      return json({
        ok: true, anuncio_id: anuncio.id, user_id: perfil.id, nuevo_usuario: nuevo,
        registro_completo: perfil.registro_completo, nombre: perfil.nombre, telefono: tel, token,
        publicaciones: await publicacionesImportadas(perfil.id),
      });
    }

    if (body.accion === "regenerar_activacion") {
      const { data: p } = await db.from("perfiles").select("id, registro_completo").eq("id", body.user_id).single();
      if (!p) throw new HttpError(404, "Usuario no encontrado");
      if (p.registro_completo) throw new HttpError(400, "Esta cuenta ya está activada");
      const token = await asegurarActivacion(p.id, admin.id, true);
      await log(admin.id, "regenerar_activacion", p.id);
      return json({ ok: true, token, publicaciones: await publicacionesImportadas(p.id) });
    }

    if (body.accion === "editar_usuario") {
      const { data: p } = await db.from("perfiles").select("*").eq("id", body.user_id).single();
      if (!p) throw new HttpError(404, "Usuario no encontrado");
      const cambios: Record<string, unknown> = {};
      if (body.nombre !== undefined) cambios.nombre = recortar(body.nombre, 40) || null;
      if (body.edad !== undefined) cambios.edad = body.edad ? Math.min(110, Math.max(14, parseInt(body.edad, 10))) : null;
      if (body.departamento !== undefined) cambios.departamento = body.departamento || null;
      if (body.municipio !== undefined) cambios.municipio = body.municipio || null;
      const nuevoTel = body.whatsapp ? String(body.whatsapp).replace(/\D/g, "") : null;
      if (nuevoTel && nuevoTel !== p.whatsapp) {
        if (!/^3\d{9}$/.test(nuevoTel)) throw new HttpError(400, "Número no válido");
        const { data: otro } = await db.from("perfiles").select("id").eq("whatsapp", nuevoTel).maybeSingle();
        if (otro) throw new HttpError(400, "Ese número ya pertenece a otra cuenta");
        const { data: u } = await db.auth.admin.getUserById(p.id);
        if (/^3\d{9}@ofertal\.com$/.test(u.user?.email ?? "")) {
          const { error } = await db.auth.admin.updateUserById(p.id, { email: `${nuevoTel}@ofertal.com`, email_confirm: true });
          if (error) throw new HttpError(400, error.message);
        }
        cambios.whatsapp = nuevoTel;
        await db.from("anuncios").update({ contacto: nuevoTel }).eq("user_id", p.id);
      }
      const { error } = await db.from("perfiles").update(cambios).eq("id", p.id);
      if (error) throw new HttpError(400, error.message);
      await log(admin.id, "editar_usuario", p.id, cambios);
      return json({ ok: true });
    }

    throw new HttpError(400, "Acción no válida");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(e);
    return json({ error: status === 500 ? "Error interno" : (e as Error).message }, status);
  }
});
