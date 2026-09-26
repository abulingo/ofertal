# OFERTAL · Marketplace de productos y servicios

Sitio: https://abulingo.github.io/ofertal/ · Panel: https://abulingo.github.io/ofertal/admin.html

Marketplace colombiano donde las personas **ofrecen** productos y servicios y también **solicitan** lo que necesitan
para recibir propuestas de proveedores cercanos. Sitio estático (GitHub Pages) + Supabase (base de datos, autenticación,
almacenamiento, tiempo real y Edge Functions) + Vertex AI (Gemini).

## Funciones

**Usuarios** (`index.html`)
- Registro e ingreso con WhatsApp colombiano + PIN de 4 dígitos (compatible con las cuentas existentes).
- Ofertas con hasta 3 fotos (comprimidas en el navegador), categorías, precio negociable o a convenir, edición, pausa, vendido.
- **Solicitudes**: alguien pide un servicio/producto → los proveedores de esa categoría y zona reciben una notificación →
  envían **propuestas** con precio → el solicitante acepta o rechaza.
- **Chat interno** en tiempo real, con confirmación de lectura, además del botón de WhatsApp al vendedor.
- Notificaciones en tiempo real (campana + notificaciones del navegador).
- Favoritos, perfil público con reseñas (1–5 ⭐), verificación de identidad, reportes de publicaciones/usuarios.
- Filtros por categoría, tipo, departamento, cercanía y precio; búsqueda; enlaces para compartir.
- **Soporte interno** (reemplaza el WhatsApp): preguntas frecuentes, asistente con IA, tickets con conversación y
  formulario "¿Olvidaste tu PIN?" para personas sin sesión.
- ✨ "Mejorar con IA" redacta títulos y descripciones.

**Administración** (`admin.html`)
- Resumen con indicadores, gráfico de actividad de 30 días y pendientes.
- Moderación de ofertas y solicitudes (aprobar / rechazar con motivo / pausar / destacar / eliminar, acciones masivas),
  con **análisis de riesgo por IA**.
- Usuarios: ficha completa, **ubicación exacta e historial de recorrido**, verificar, suspender, restablecer PIN,
  otorgar rol de administrador, eliminar cuenta.
- Mapa de ubicaciones de todos los usuarios y puntos de publicación.
- Bandeja de soporte en tiempo real con plantillas y respuestas sugeridas por IA.
- Reportes, conversaciones (para casos de seguridad), avisos y notificaciones masivas, categorías, configuración y
  registro de actividad.

## Privacidad de la ubicación

1. El navegador envía la posición exacta a la función privada `actualizar_ubicacion` (al ingresar, al publicar y
   periódicamente mientras la app está abierta).
2. La posición exacta queda en tablas que **solo el dueño y los administradores** pueden leer
   (`ubicaciones`, `ubicaciones_historial`, `ubicaciones_publicacion`).
3. Los demás usuarios ven solo un **círculo de ~1 km** (configurable) cuyo centro está desplazado al azar entre el
   30 % y el 80 % del radio respecto del punto real: la persona está dentro del círculo, pero **no en el centro**.
4. El círculo solo se regenera cuando la persona sale de él; así, repetir la misma posición no permite "promediar"
   varios círculos para descubrir el punto real.
5. Cada oferta y solicitud guarda el punto exacto desde donde se publicó (visible solo en el panel de administración).

## Estructura

```
index.html                 Sitio público
admin.html                 Panel de administración
assets/js/common.js        Utilidades compartidas (Supabase, modales, mapas, formato)
assets/js/app.js           Lógica del sitio
assets/js/admin.js         Lógica del panel
assets/css/app.css         Estilos complementarios a Tailwind
assets/data/colombia.json  Departamentos y municipios
supabase/migrations/       Esquema SQL completo (tablas, RLS, triggers, funciones)
supabase/functions/ia      Edge Function con Vertex AI (Gemini)
supabase/functions/admin   Edge Function para acciones con llave de servicio
```

## Configuración de Supabase

- Ejecutar `supabase/migrations/20260926000000_ofertal_v2.sql` en el editor SQL (es idempotente).
- Desplegar las funciones `ia` y `admin` (con `verify_jwt = false`: validan el token internamente).
- Secretos de las funciones: `GCP_SA_JSON` (JSON de la cuenta de servicio de Google Cloud con acceso a Vertex AI) y,
  opcionalmente, `VERTEX_MODEL` (por defecto `gemini-2.5-flash-lite`, el más económico).
- Para dar rol de administrador a una cuenta: `update perfiles set rol = 'admin' where whatsapp = '3XXXXXXXXX';`
  o desde el panel (Usuarios → Hacer administrador).

> ⚠️ Nunca subas credenciales (llave de servicio, contraseña de la base de datos, tokens, JSON de Google) al repositorio.
> La única llave presente en el código es la pública `anon`, protegida por las políticas RLS.
