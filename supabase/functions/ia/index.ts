// OFERTAL · Edge Function "ia"
// Usa Vertex AI (Gemini) con una cuenta de servicio guardada como secreto (GCP_SA_JSON).
// Acciones:
//   mejorar_texto      → mejora título/descripción y sugiere categoría (usuarios)
//   moderar            → analiza una oferta/solicitud y guarda el riesgo (dueño o admin)
//   asistente_soporte  → responde dudas frecuentes antes de abrir un ticket (usuarios)
//   sugerir_respuesta  → redacta una respuesta para un ticket de soporte (admin)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = Deno.env.get("VERTEX_MODEL") ?? "gemini-2.5-flash";
const LOCATION = Deno.env.get("VERTEX_LOCATION") ?? "global";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------------------------------------------------------------- Google auth
type ServiceAccount = { client_email: string; private_key: string; project_id: string; token_uri: string };
let sa: ServiceAccount | null = null;
let tokenCache: { token: string; exp: number } | null = null;

function cuentaServicio(): ServiceAccount {
  if (!sa) sa = JSON.parse(Deno.env.get("GCP_SA_JSON") ?? "{}");
  if (!sa?.private_key) throw new HttpError(500, "IA no configurada");
  return sa!;
}

const b64url = (bytes: Uint8Array) => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemADer(pem: string): ArrayBuffer {
  const bin = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function googleToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const cred = cuentaServicio();
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(enc.encode(JSON.stringify({
    iss: cred.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: cred.token_uri,
    iat: now,
    exp: now + 3600,
  })));
  const key = await crypto.subtle.importKey("pkcs8", pemADer(cred.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claim}`)));
  const r = await fetch(cred.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${b64url(firma)}`,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("Google auth: " + JSON.stringify(d));
  tokenCache = { token: d.access_token, exp: now + (d.expires_in ?? 3600) };
  return d.access_token;
}

// ---------------------------------------------------------------- Gemini
type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

async function gemini(parts: Part[], schema?: Record<string, unknown>, temperature = 0.3): Promise<any> {
  const cred = cuentaServicio();
  const host = LOCATION === "global" ? "aiplatform.googleapis.com" : `${LOCATION}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${cred.project_id}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
  const generationConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens: 2048,
    thinkingConfig: { thinkingBudget: 0 },
  };
  if (schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = schema;
  }
  let r: Response | null = null;
  let d: any = null;
  // Reintentos con espera exponencial ante límites de cuota (429) o errores temporales (5xx)
  for (let intento = 0; intento < 4; intento++) {
    r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await googleToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    });
    d = await r.json().catch(() => ({}));
    if (r.ok || (r.status !== 429 && r.status < 500)) break;
    await new Promise((res) => setTimeout(res, 800 * 2 ** intento));
  }
  if (!r!.ok) throw new Error(`Vertex AI ${r!.status}: ${d?.error?.message ?? ""}`);
  const texto = (d.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
  if (!texto) return null; // bloqueado por filtros de seguridad
  return schema ? JSON.parse(texto) : texto;
}

// ---------------------------------------------------------------- Helpers
async function usuarioDesde(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Inicia sesión para usar esta función");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sesión no válida");
  const { data: perfil } = await db.from("perfiles").select("id, rol, estado, nombre").eq("id", data.user.id).single();
  if (!perfil || perfil.estado !== "activo") throw new HttpError(403, "Tu cuenta no está activa");
  return { id: data.user.id, esAdmin: perfil.rol === "admin", perfil };
}

async function limitarUso(userId: string, accion: string, max: number) {
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from("ia_uso").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("accion", accion).gte("created_at", desde);
  if ((count ?? 0) >= max) throw new HttpError(429, "Alcanzaste el límite diario de uso de la IA. Intenta mañana.");
  await db.from("ia_uso").insert({ user_id: userId, accion });
}

async function categorias(): Promise<string[]> {
  const { data } = await db.from("categorias").select("nombre").eq("activa", true).order("orden");
  return (data ?? []).map((c: { nombre: string }) => c.nombre);
}

async function config(clave: string) {
  const { data } = await db.from("config").select("valor").eq("clave", clave).single();
  return data?.valor;
}

async function imagenInline(url: string): Promise<Part | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const tipo = r.headers.get("content-type") ?? "image/jpeg";
    if (!tipo.startsWith("image/")) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) return null;
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { inlineData: { mimeType: tipo.split(";")[0], data: btoa(s) } };
  } catch {
    return null;
  }
}

const recortar = (s: unknown, n: number) => String(s ?? "").slice(0, n);

// ---------------------------------------------------------------- Acciones
async function mejorarTexto(userId: string, body: any) {
  await limitarUso(userId, "mejorar_texto", 40);
  const cats = await categorias();
  const clase = body.clase === "solicitud" ? "solicitud (una persona pide un servicio o producto)" : "oferta (alguien ofrece un producto o servicio)";
  const prompt = `Eres el asistente de OFERTAL, un marketplace colombiano de productos y servicios.
Mejora la siguiente ${clase} para que sea clara, honesta, atractiva y fácil de entender.
Reglas:
- Español de Colombia, tono cercano y profesional. Sin emojis excesivos (máximo 2).
- NO inventes datos (precios, marcas, garantías, experiencia) que no estén en el texto original.
- NO incluyas teléfonos, correos, enlaces ni direcciones exactas.
- Título: máximo 70 caracteres, concreto.
- Descripción: 2 a 6 frases cortas o viñetas con "•", máximo 700 caracteres. Si faltan datos importantes, sugiere entre corchetes qué agregar, p. ej. [agrega el estado del producto].
- Categoría: elige exactamente una de esta lista: ${cats.join(" | ")}.

Tipo: ${recortar(body.tipo, 20)}
Título original: ${recortar(body.titulo, 200)}
Descripción original: ${recortar(body.descripcion, 2000)}
Categoría actual: ${recortar(body.categoria, 60) || "(ninguna)"}`;
  const out = await gemini([{ text: prompt }], {
    type: "OBJECT",
    properties: {
      titulo: { type: "STRING" },
      descripcion: { type: "STRING" },
      categoria: { type: "STRING", enum: cats },
    },
    required: ["titulo", "descripcion", "categoria"],
  }, 0.5);
  if (!out) throw new HttpError(422, "No pudimos procesar este texto. Revísalo e intenta de nuevo.");
  return { titulo: recortar(out.titulo, 120), descripcion: recortar(out.descripcion, 1500), categoria: out.categoria };
}

async function moderar(usuario: { id: string; esAdmin: boolean }, body: any) {
  const entidad = body.entidad === "solicitud" ? "solicitud" : "anuncio";
  const tabla = entidad === "solicitud" ? "solicitudes" : "anuncios";
  const { data: item } = await db.from(tabla).select("*").eq("id", body.id).single();
  if (!item) throw new HttpError(404, "Publicación no encontrada");
  if (item.user_id !== usuario.id && !usuario.esAdmin) throw new HttpError(403, "No autorizado");
  if (!usuario.esAdmin) await limitarUso(usuario.id, "moderar", 60);

  const cats = await categorias();
  const imgs: string[] = Array.isArray(item.imagen_urls) ? item.imagen_urls : [];
  const precio = entidad === "anuncio" ? item.precio : item.presupuesto;
  const prompt = `Eres moderador de OFERTAL, marketplace colombiano de productos y servicios entre personas.
Evalúa esta ${entidad === "anuncio" ? "OFERTA" : "SOLICITUD"} y determina el riesgo de publicarla.

Riesgo ALTO (no publicar): armas, drogas, medicamentos de control, alcohol adulterado, animales silvestres,
contenido sexual o servicios sexuales, documentos falsos, productos robados o de contrabando evidente,
estafas típicas (pedir anticipos o "pagos de registro", préstamos gota a gota, pirámides, "trabajo desde casa"
con inversión, precios absurdamente bajos para artículos caros), discriminación, violencia, datos personales de terceros.
Riesgo MEDIO (revisar a mano): información confusa o incompleta, precio sospechoso, posible duplicado o spam,
imagen que no coincide con el texto, lenguaje ofensivo leve, servicios que requieren licencia (salud, electricidad de alto riesgo).
Riesgo BAJO: publicación normal y legítima.

Además sugiere la categoría correcta de esta lista: ${cats.join(" | ")}.

Datos:
- Tipo: ${item.tipo}
- Título: ${recortar(item.titulo, 200)}
- Descripción: ${recortar(item.descripcion, 2000)}
- ${entidad === "anuncio" ? "Precio" : "Presupuesto"} (COP): ${precio ?? "no indicado"}
- Ubicación declarada: ${item.municipio ?? "?"}, ${item.departamento ?? "?"}
- Imágenes adjuntas: ${imgs.length}${imgs.length ? " (se incluye la primera)" : ""}`;

  const parts: Part[] = [{ text: prompt }];
  if (imgs[0]) {
    const img = await imagenInline(imgs[0]);
    if (img) parts.push(img);
  }

  let out = await gemini(parts, {
    type: "OBJECT",
    properties: {
      riesgo: { type: "STRING", enum: ["bajo", "medio", "alto"] },
      aprobar: { type: "BOOLEAN" },
      motivos: { type: "ARRAY", items: { type: "STRING" } },
      categoria_sugerida: { type: "STRING", enum: cats },
      resumen: { type: "STRING" },
    },
    required: ["riesgo", "aprobar", "motivos", "categoria_sugerida", "resumen"],
  }, 0.1);
  if (!out) {
    out = { riesgo: "alto", aprobar: false, motivos: ["El contenido fue bloqueado por los filtros de seguridad de la IA"],
            categoria_sugerida: "Otros", resumen: "Requiere revisión manual" };
  }

  const analisis = {
    riesgo: out.riesgo,
    aprobar: !!out.aprobar,
    motivos: (out.motivos ?? []).slice(0, 6).map((m: string) => recortar(m, 200)),
    categoria_sugerida: out.categoria_sugerida,
    resumen: recortar(out.resumen, 400),
    modelo: MODEL,
    fecha: new Date().toISOString(),
  };

  const cambios: Record<string, unknown> = { ia_analisis: analisis };
  if (!item.categoria && cats.includes(analisis.categoria_sugerida)) cambios.categoria = analisis.categoria_sugerida;

  const autoIA = (await config("ia_auto_aprobar")) === true;
  let autoAprobado = false;
  if (autoIA && analisis.riesgo === "bajo" && analisis.aprobar && item.estado === "pendiente") {
    cambios.estado = entidad === "anuncio" ? "aprobado" : "abierta";
    autoAprobado = true;
  }
  await db.from(tabla).update(cambios).eq("id", item.id);
  if (autoAprobado) {
    await db.from("admin_log").insert({
      admin_id: null, accion: "ia_auto_aprobar", entidad, entidad_id: item.id,
      detalle: { titulo: item.titulo, riesgo: analisis.riesgo },
    });
  }
  return { analisis, auto_aprobado: autoAprobado };
}

const GUIA_OFERTAL = `OFERTAL es un marketplace colombiano para ofrecer y buscar productos y servicios.
- Cuenta: se ingresa con número de WhatsApp colombiano (10 dígitos, empieza por 3) y un PIN de 4 dígitos.
  El PIN se puede cambiar en "Mi perfil". Si se olvida, en Soporte hay un formulario "¿Olvidaste tu PIN?" y el equipo lo restablece.
- Ofrecer: botón "Publicar" → "Ofrecer producto o servicio". Máximo 3 fotos. Las ofertas pasan por revisión antes de ser visibles.
  Se pueden editar, pausar, marcar como vendidas o eliminar desde "Mis publicaciones". Al editar vuelven a revisión.
- Solicitar: botón "Publicar" → "Necesito un servicio". Los proveedores de esa categoría y zona reciben una notificación
  y pueden enviar propuestas con precio. En "Mis solicitudes" se aceptan o rechazan propuestas.
- Ubicación: para publicar se requiere activar la ubicación del navegador. Los demás usuarios SOLO ven un área aproximada
  de ~1 km cuyo centro NO es la posición real. La ubicación exacta solo la conoce el equipo de OFERTAL por seguridad.
  Si el navegador la bloqueó: tocar el candado junto a la dirección web → Permisos → Ubicación → Permitir, y recargar.
- Chat: el botón "Chatear" abre un chat interno. También se puede escribir por WhatsApp al vendedor si hay sesión iniciada.
- Seguridad: nunca pagar anticipos a desconocidos, verse en lugares públicos, revisar calificaciones. Se puede reportar
  una publicación o usuario con el botón "Reportar".
- Calificaciones: después de conversar con alguien se le puede calificar de 1 a 5 estrellas en su perfil.
- Soporte: se crean tickets en la sección Soporte y el equipo responde ahí mismo; llegan notificaciones con la respuesta.`;

async function asistenteSoporte(userId: string, body: any) {
  await limitarUso(userId, "asistente_soporte", 25);
  const pregunta = recortar(body.pregunta, 800);
  if (pregunta.trim().length < 3) throw new HttpError(400, "Escribe tu pregunta");
  const texto = await gemini([{ text: `Eres el asistente de soporte de OFERTAL. Responde en español de Colombia, amable y breve
(máximo 6 frases o viñetas). Usa SOLO esta información; si no sabes la respuesta o el caso requiere que una persona
revise la cuenta (pagos, suspensiones, fraudes, errores técnicos), di que cree un ticket de soporte.

${GUIA_OFERTAL}

Pregunta del usuario: ${pregunta}` }], undefined, 0.3);
  return { respuesta: texto ?? "No pude responder esa pregunta. Crea un ticket y el equipo te ayudará." };
}

async function sugerirRespuesta(usuario: { esAdmin: boolean }, body: any) {
  if (!usuario.esAdmin) throw new HttpError(403, "Solo administradores");
  const { data: t } = await db.from("tickets").select("*").eq("id", body.ticket_id).single();
  if (!t) throw new HttpError(404, "Ticket no encontrado");
  const { data: msgs } = await db.from("tickets_mensajes").select("es_admin, texto, created_at")
    .eq("ticket_id", t.id).order("created_at");
  let nombre = t.nombre_contacto ?? "usuario";
  if (t.user_id) {
    const { data: p } = await db.from("perfiles").select("nombre").eq("id", t.user_id).single();
    nombre = p?.nombre ?? nombre;
  }
  const hilo = [`USUARIO: ${t.descripcion}`, ...(msgs ?? []).map((m: any) => `${m.es_admin ? "SOPORTE" : "USUARIO"}: ${m.texto}`)]
    .join("\n").slice(-6000);
  const texto = await gemini([{ text: `Redacta la siguiente respuesta del equipo de soporte de OFERTAL para este ticket.
Español de Colombia, cálido, claro y concreto (máximo 120 palabras). Dirígete a ${nombre} por su nombre.
No prometas cosas que no puedas cumplir. Si falta información, pídela. Firma como "Equipo OFERTAL".

Información de la plataforma:
${GUIA_OFERTAL}

Ticket #${t.numero} · Categoría: ${t.categoria} · Asunto: ${t.asunto}
Conversación:
${hilo}` }], undefined, 0.4);
  return { texto: texto ?? "" };
}

// ---------------------------------------------------------------- Servidor
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
    const body = await req.json().catch(() => ({}));
    const usuario = await usuarioDesde(req);
    switch (body.accion) {
      case "mejorar_texto": return json(await mejorarTexto(usuario.id, body));
      case "moderar": return json(await moderar(usuario, body));
      case "asistente_soporte": return json(await asistenteSoporte(usuario.id, body));
      case "sugerir_respuesta": return json(await sugerirRespuesta(usuario, body));
      default: throw new HttpError(400, "Acción no válida");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(e);
    return json({ error: status === 500 ? "Error del asistente de IA. Intenta más tarde." : (e as Error).message }, status);
  }
});
