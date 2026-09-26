// OFERTAL · Edge Function "activar" (pública)
// Permite que una persona cuyo anuncio fue publicado desde un grupo de WhatsApp
// reclame su cuenta con el enlace que le enviaron: crea su propio PIN, completa sus
// datos y acepta los términos. El token del enlace es aleatorio (192 bits) y de un solo uso.
//   info       → datos para mostrar la página de activación
//   completar  → activa la cuenta
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PIN_SALT = "9876";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

class HttpError extends Error {
  constructor(public status: number, message: string, public codigo = "") { super(message); }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function buscarActivacion(token: unknown) {
  const t = String(token ?? "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) throw new HttpError(400, "Enlace no válido", "INVALIDO");
  const { data: act } = await db.from("activaciones").select("*").eq("token", t).maybeSingle();
  if (!act) throw new HttpError(404, "Este enlace no existe o fue reemplazado por uno nuevo.", "INVALIDO");
  if (act.usado_at) throw new HttpError(410, "Esta cuenta ya fue activada. Ingresa con tu número y tu PIN.", "USADO");
  if (new Date(act.expira_at) < new Date()) throw new HttpError(410, "El enlace venció. Escríbenos por Soporte para recibir uno nuevo.", "VENCIDO");
  const { data: perfil } = await db.from("perfiles").select("*").eq("id", act.user_id).single();
  if (!perfil) throw new HttpError(404, "La cuenta ya no existe", "INVALIDO");
  if (perfil.registro_completo) throw new HttpError(410, "Esta cuenta ya fue activada. Ingresa con tu número y tu PIN.", "USADO");
  return { act, perfil };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
    const body = await req.json().catch(() => ({}));

    if (body.accion === "info") {
      const { perfil } = await buscarActivacion(body.token);
      const { data: anuncios } = await db.from("anuncios").select("id, titulo, imagen_urls, precio, estado")
        .eq("user_id", perfil.id).in("estado", ["aprobado", "pendiente", "vencido"]).order("created_at", { ascending: false }).limit(10);
      const tel = String(perfil.whatsapp ?? "");
      return json({
        telefono: tel.replace(/^(\d{3})\d{4}(\d{3})$/, "$1 **** $2"),
        departamento: perfil.departamento, municipio: perfil.municipio,
        publicaciones: (anuncios ?? []).map((a) => ({ id: a.id, titulo: a.titulo, precio: a.precio, estado: a.estado, imagen: Array.isArray(a.imagen_urls) ? a.imagen_urls[0] ?? null : null })),
      });
    }

    if (body.accion === "completar") {
      const { act, perfil } = await buscarActivacion(body.token);
      const pin = String(body.pin ?? "");
      const nombre = String(body.nombre ?? "").trim().slice(0, 40);
      const edad = parseInt(body.edad, 10);
      if (!/^\d{4}$/.test(pin)) throw new HttpError(400, "El PIN debe tener 4 números");
      if (/^(\d)\1{3}$/.test(pin) || ["1234", "4321", "0000"].includes(pin)) throw new HttpError(400, "Elige un PIN menos obvio");
      if (nombre.length < 2) throw new HttpError(400, "Escribe tu nombre");
      if (!body.departamento || !body.municipio) throw new HttpError(400, "Selecciona tu departamento y municipio");
      if (!body.terminos_version) throw new HttpError(400, "Debes aceptar los términos y condiciones");

      const { error } = await db.auth.admin.updateUserById(perfil.id, {
        password: pin + PIN_SALT,
        user_metadata: { whatsapp: perfil.whatsapp, primer_nombre: nombre, edad: Number.isFinite(edad) ? edad : null, departamento: body.departamento, municipio: body.municipio, origen: "whatsapp" },
      });
      if (error) throw new HttpError(400, error.message);
      await db.from("perfiles").update({
        nombre,
        edad: Number.isFinite(edad) ? Math.min(110, Math.max(14, edad)) : null,
        departamento: body.departamento,
        municipio: body.municipio,
        registro_completo: true,
        terminos_version: String(body.terminos_version).slice(0, 20),
        terminos_aceptados_at: new Date().toISOString(),
      }).eq("id", perfil.id);
      await db.from("activaciones").update({ usado_at: new Date().toISOString() }).eq("user_id", act.user_id);
      const admins = (await db.from("perfiles").select("id").eq("rol", "admin").eq("estado", "activo")).data ?? [];
      if (admins.length) {
        await db.from("notificaciones").insert(admins.map((a) => ({
          user_id: a.id, tipo: "admin_activacion", titulo: `🎉 ${nombre} activó su cuenta`,
          cuerpo: `Número ${perfil.whatsapp} (importado de WhatsApp)`, enlace: "whatsapp",
        })));
      }
      return json({ ok: true, email: `${perfil.whatsapp}@ofertal.com` });
    }

    throw new HttpError(400, "Acción no válida");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(e);
    return json({ error: status === 500 ? "Error interno" : (e as Error).message, codigo: e instanceof HttpError ? e.codigo : "" }, status);
  }
});
