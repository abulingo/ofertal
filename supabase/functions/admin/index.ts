// OFERTAL · Edge Function "admin"
// Acciones que requieren la llave de servicio (nunca expuesta en el navegador).
// Solo usuarios con rol "admin" pueden invocarla.
//   reset_pin         → asigna un PIN nuevo de 4 dígitos a un usuario
//   eliminar_usuario  → borra la cuenta y todo su contenido
//   cambiar_password  → cambia la contraseña del administrador que llama
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

async function log(adminId: string, accion: string, entidadId: string, detalle: Record<string, unknown> = {}) {
  await db.from("admin_log").insert({ admin_id: adminId, accion, entidad: "usuario", entidad_id: entidadId, detalle });
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

    throw new HttpError(400, "Acción no válida");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(e);
    return json({ error: status === 500 ? "Error interno" : (e as Error).message }, status);
  }
});
