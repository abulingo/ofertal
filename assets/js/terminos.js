// OFERTAL · Términos y condiciones y política de tratamiento de datos
// Si cambias el contenido de forma importante, sube la VERSIÓN: los usuarios deberán aceptarla de nuevo.
export const TERMINOS_VERSION = '1.1';
export const TERMINOS_FECHA = '27 de septiembre de 2026';
export const RESPONSABLE = 'Cesar Santana';

const seccion = (n, titulo, cuerpo) => `
  <section class="space-y-2">
    <h3 class="font-bold text-slate-900">${n}. ${titulo}</h3>
    ${cuerpo}
  </section>`;

const lista = (items) => `<ul class="list-disc ml-5 space-y-1">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

export function resumenTerminosHtml() {
  return `
    <ul class="space-y-2 text-sm text-slate-600">
      <li>🤝 <b>OFERTAL conecta personas</b> de la región: no vende, no compra, no arrienda ni presta los servicios publicados, y no participa en los pagos.</li>
      <li>⚠️ <b>Ni OFERTAL ni ${RESPONSABLE} se hacen responsables</b> por robos, estafas, fraudes, daños, accidentes, incumplimientos ni por la calidad de los productos, inmuebles o <b>servicios prestados</b>. Cada usuario responde por sus acuerdos.</li>
      <li>⏳ Las publicaciones se muestran <b>14 días</b> y se renuevan con un clic. Máximo 10 publicaciones y 10 consultas de IA por día.</li>
      <li>🔒 Tu <b>nombre, edad y número</b> no se pueden cambiar desde tu cuenta; para corregirlos escríbenos a Soporte.</li>
      <li>🛡️ <b>Sí revisamos las publicaciones</b> antes de mostrarlas y podemos rechazar, retirar contenido o suspender cuentas para evitar publicaciones indebidas.</li>
      <li>📍 <b>Registramos tu ubicación</b> por seguridad. Los demás solo ven un área aproximada; la ubicación exacta solo la conoce el equipo de OFERTAL.</li>
    </ul>`;
}

export function terminosHtml() {
  return `
  <article class="space-y-6 text-sm text-slate-700 leading-relaxed">
    <header class="space-y-1">
      <p class="text-xs text-slate-500">Versión ${TERMINOS_VERSION} · Vigente desde el ${TERMINOS_FECHA}</p>
      <p>Estos términos regulan el uso de <b>OFERTAL</b> (el sitio web y sus servicios). Al crear una cuenta o usar la plataforma
      declaras que los leíste, los entendiste y los aceptas. Si no estás de acuerdo, no uses OFERTAL.</p>
      <p><b>Responsable de la plataforma y del tratamiento de datos:</b> ${RESPONSABLE}. Contacto: sección <a href="#soporte" data-cerrar class="text-indigo-600 underline">Ayuda y soporte</a> del sitio.</p>
    </header>

    ${seccion(1, 'Qué es OFERTAL', `
      <p>OFERTAL es una plataforma regional de clasificados que permite a las personas publicar lo que venden (productos,
      vehículos, casas, apartamentos, habitaciones en arriendo, locales, lotes y más), ofrecer servicios, publicar solicitudes
      de lo que necesitan, encontrar lo que hay cerca de su ubicación, comunicarse entre sí y calificarse. <b>OFERTAL actúa
      únicamente como intermediario tecnológico</b>: no es vendedor, comprador, arrendador, inmobiliaria, empleador,
      contratista ni prestador de los servicios publicados, y no recibe, custodia ni procesa pagos entre usuarios.</p>`)}

    ${seccion(2, 'Cuenta de usuario', lista([
      'Te registras con un número de WhatsApp colombiano y un PIN de 4 dígitos. Debes dar información verdadera y mantenerla actualizada.',
      'Debes ser mayor de edad o contar con la autorización de tu representante legal.',
      'Eres responsable de guardar tu PIN y de toda la actividad que ocurra con tu cuenta. Si sospechas un uso indebido, avísanos por Soporte.',
      'Solo puedes tener una cuenta personal. No está permitido suplantar a otra persona o empresa.',
      'Tu <b>nombre, edad y número de WhatsApp no se pueden modificar</b> desde la cuenta una vez creada. Si necesitas corregirlos, solicítalo por Soporte; podremos pedirte una verificación.',
    ]))}

    ${seccion('2A', 'Publicaciones tomadas de grupos de WhatsApp', `
      <p>Para ayudar a los vendedores de la región, el equipo de OFERTAL puede publicar en la plataforma anuncios que su autor
      compartió en grupos de WhatsApp de compra y venta, usando el texto, las fotos y el número que el autor publicó. En ese caso
      se crea una <b>cuenta pendiente de activación</b> asociada a ese número y se le envía al autor un enlace personal para que
      termine su registro y cree su propio PIN.</p>
      ${lista([
        'La información se publica tal como la compartió su autor, quien sigue siendo el único responsable de su contenido.',
        'El autor puede activar su cuenta, editar o eliminar sus publicaciones, o pedir que las retiremos respondiendo el mensaje que le enviamos o escribiendo a Soporte, y lo haremos a la mayor brevedad.',
        'Mientras la cuenta no se active, no registramos la ubicación del autor: la publicación muestra solo el área aproximada del municipio.',
      ])}`)}

    ${seccion(3, 'Control de publicaciones', `
      <p>Para mantener una comunidad segura, <b>OFERTAL revisa y controla las publicaciones</b> que se suben:</p>
      ${lista([
        'Las ofertas y solicitudes pueden pasar por una revisión previa (manual y/o con ayuda de inteligencia artificial) antes de ser visibles.',
        'Podemos aprobar, rechazar, pausar, editar su categoría o eliminar cualquier publicación que incumpla estos términos o la ley, sin previo aviso.',
        'Podemos suspender o eliminar cuentas que publiquen contenido indebido, reciban reportes fundados o pongan en riesgo a otros usuarios.',
        'Cualquier usuario puede reportar publicaciones, conversaciones o usuarios con el botón «Reportar».',
      ])}
      <p>Esta revisión <b>reduce riesgos, pero no garantiza</b> la veracidad de las publicaciones ni la conducta de los usuarios.</p>`)}

    ${seccion('3A', 'Vigencia y límites', lista([
      'Cada publicación se muestra durante <b>14 días</b>. Un día antes te avisamos y, al vencer, deja de mostrarse.',
      'Puedes <b>renovarla con un clic</b> si no la modificaste. Si la editas, vuelve a revisión del equipo antes de mostrarse.',
      'Puedes hacer hasta <b>10 publicaciones por día</b> y hasta <b>10 consultas diarias</b> a las funciones de inteligencia artificial.',
      'Las publicaciones pueden no tener fotos o tener hasta 8; las fotos se comprimen automáticamente para que carguen rápido.',
    ]))}

    ${seccion(4, 'Publicaciones prohibidas', `
      <p>No está permitido publicar ni ofrecer:</p>
      ${lista([
        'Armas, municiones, explosivos, drogas, sustancias o medicamentos controlados.',
        'Productos robados, de contrabando, falsificados o sin la documentación legal exigida.',
        'Animales silvestres o especies protegidas.',
        'Contenido sexual, servicios sexuales o contenido que involucre a menores de edad.',
        'Esquemas piramidales, préstamos «gota a gota», cobros anticipados sospechosos u ofertas engañosas.',
        'Documentos falsos, datos personales de terceros o contenido discriminatorio, violento u ofensivo.',
        'Publicaciones duplicadas, spam o con información falsa.',
      ])}`)}

    ${seccion(5, 'Limitación de responsabilidad', `
      <div class="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-2 text-amber-950">
        <p><b>Ni OFERTAL ni ${RESPONSABLE}, como responsable de la plataforma, se hacen responsables</b>, en la máxima medida permitida por la ley, por:</p>
        ${lista([
          '<b>Robos, hurtos, estafas, fraudes</b> o cualquier delito cometido por usuarios o terceros, dentro o fuera de la plataforma.',
          'Pagos, anticipos, transferencias o dinero entregado entre usuarios.',
          'La calidad, legalidad, seguridad, estado o existencia de los productos y servicios publicados.',
          'Incumplimientos, retrasos, daños, lesiones o perjuicios derivados de los acuerdos entre usuarios.',
          'Lo que ocurra en encuentros presenciales, visitas a inmuebles o visitas a domicilio acordados entre usuarios.',
          'La información publicada por los usuarios ni las opiniones de las reseñas.',
          'Interrupciones, errores técnicos o pérdida de información ajenos a nuestro control.',
        ])}
        <p>Cada usuario es el único responsable de verificar a la otra parte y de las decisiones que toma. Ante un delito,
        denúncialo a las autoridades competentes; OFERTAL colaborará con ellas conforme a la ley.</p>
      </div>`)}

    ${seccion('5A', 'Prestación de servicios', `
      <div class="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-2 text-amber-950">
        <p>Los servicios que se ofrecen en OFERTAL (reparaciones, construcción, electricidad, plomería, transporte, clases,
        cuidado de personas, belleza, eventos, domicilios y cualquier otro) <b>los presta directamente cada usuario, por su cuenta
        y bajo su exclusiva responsabilidad</b>. Por eso:</p>
        ${lista([
          '<b>Ni OFERTAL ni ' + RESPONSABLE + ' son empleadores, contratantes, contratistas, intermediarios laborales ni garantes</b> de quienes prestan o contratan servicios. No existe relación laboral ni de subordinación con la plataforma.',
          'No respondemos por la calidad, el resultado, los materiales, los precios, los plazos ni las garantías de los servicios.',
          'No respondemos por daños a bienes, accidentes, lesiones, pérdidas, hurtos ni perjuicios ocurridos durante o con ocasión de un servicio.',
          'Cada prestador es responsable de contar con la experiencia, los permisos, licencias, certificaciones, afiliaciones a seguridad social y pólizas que exija la ley para su oficio.',
          'Te recomendamos acordar por escrito el alcance, el precio y la forma de pago, y pagar contra avance o entrega del trabajo.',
        ])}
      </div>`)}

    ${seccion('5B', 'Inmuebles y arriendos', lista([
      'OFERTAL no es una inmobiliaria: no verifica la propiedad, el estado, los documentos ni la disponibilidad de los inmuebles publicados.',
      'Antes de pagar depósitos, arriendos o separaciones, visita el inmueble y verifica la identidad y la titularidad de quien lo ofrece.',
      'Los contratos de venta o arrendamiento son un acuerdo exclusivo entre las partes.',
    ]))}

    ${seccion(6, 'Recomendaciones de seguridad', lista([
      'No pagues anticipos a desconocidos ni compartas códigos, claves o datos bancarios.',
      'Revisa el producto o el trabajo antes de pagar. Prefiere lugares públicos y concurridos para los encuentros.',
      'Revisa las calificaciones y el sello ✔ de verificado. Conversa por el chat de OFERTAL.',
      'Desconfía de precios demasiado bajos o de quien te presione para decidir rápido.',
    ]))}

    ${seccion(7, 'Ubicación y tratamiento de datos personales', `
      <p>En cumplimiento de la Ley 1581 de 2012 y sus decretos reglamentarios, al aceptar estos términos autorizas a
      <b>${RESPONSABLE}</b>, como responsable, a tratar tus datos personales así:</p>
      ${lista([
        '<b>Datos que recolectamos:</b> nombre, número de WhatsApp, edad, departamento y municipio, foto de perfil (opcional), publicaciones, mensajes, reseñas y tu <b>ubicación geográfica</b>. En publicaciones tomadas de grupos de WhatsApp, también el texto, las fotos y el número que compartiste en el grupo.',
        '<b>Ubicación:</b> se registra al ingresar, al publicar y periódicamente mientras usas la plataforma. Es obligatoria para publicar y sirve para mostrarte lo que se ofrece cerca de ti en la región.',
        '<b>Lo que ven los demás:</b> solo un área aproximada (un círculo de alrededor de 1 km) cuyo centro <b>no</b> coincide con tu posición real. Tu teléfono solo lo ven usuarios con sesión iniciada en tus publicaciones.',
        '<b>Ubicación exacta:</b> la conoce únicamente el equipo de OFERTAL y se usa para prevenir fraudes, respaldar a quienes contratan servicios, atender reportes y colaborar con las autoridades cuando la ley lo exija.',
        '<b>Finalidades:</b> operar la plataforma, conectar usuarios, moderar contenido, enviarte notificaciones, dar soporte y mejorar el servicio.',
        '<b>Tus derechos:</b> conocer, actualizar, rectificar y solicitar la eliminación de tus datos, y revocar esta autorización, escribiéndonos por Soporte. Puedes desactivar la ubicación en tu navegador, pero no podrás publicar.',
        'No vendemos tus datos personales a terceros.',
      ])}`)}

    ${seccion(8, 'Contenido e inteligencia artificial', lista([
      'Eres el responsable del contenido que publicas y garantizas que tienes derecho a usar las fotos y textos.',
      'Nos autorizas a mostrar tu contenido dentro de OFERTAL para operar el servicio.',
      'Las funciones de IA (mejorar textos, asistente de soporte, análisis de publicaciones) son de apoyo y pueden cometer errores: revisa siempre el resultado.',
    ]))}

    ${seccion(9, 'Cambios y vigencia', `
      <p>Podemos modificar estos términos. Cuando el cambio sea importante te pediremos aceptarlos de nuevo al ingresar.
      El uso de OFERTAL se rige por las leyes de la República de Colombia.</p>`)}
  </article>`;
}
