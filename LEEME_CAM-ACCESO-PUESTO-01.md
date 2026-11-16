# TECCHNEX · CAM-ACCESO-PUESTO-01 (laboratorio: backend + pantalla de ingreso)

**Estado:** CANDIDATO DE LABORATORIO. Sin SQL, sin tablas nuevas, sin secretos.
**No modifica:** CAM-RONDAS, CAM-SST, el Bridge ni ninguna función existente. Son copias aisladas.

## Qué resuelve
Ingreso de CAM-ACCESO por **puesto de servicio + cliente** (ej. `porteria-casa-linda`) con su contraseña,
usando la tabla existente `tecchnex_product_posts` atada al contrato (cliente + producto).

## Contenido
- `cam-acceso-post-authorize`: valida puesto + clave (bcrypt), estado del puesto, contrato/cliente/producto vigentes
  (fechas de Colombia), límite de intentos y emite sesión firmada de 15 min.
- `cam-acceso-session-validate`: revalida la sesión contra el contrato (una suspensión surte efecto aquí).
- `cam-acceso-post-admin`: listar, crear, rotar clave y cambiar estado de puestos. Exige JWT, MFA AAL2 y perfil `admin_tecchnex`.
  Verifica que el código sea único en todo el producto CAM-ACCESO (el ingreso rechaza si hay dos coincidencias).
- `_shared`: copias sin cambios de `commercial-policy.ts` y `upstash-login-rate-limiter.ts`.
- `CAM-ACCESO/`: copia de laboratorio de la app con la **nueva pantalla de ingreso** (`index.html` + `cam-acceso-config.js`).
  Se eliminaron las cuentas demo y la clave de laboratorio. El original queda intacto en tu zip.
- `CRM/`: copia del CRM del Admin Maestro con un **segundo panel para crear y administrar puestos de CAM-ACCESO**
  (el panel de CAM-RONDAS se conserva sin cambios; cada panel usa su propia función y solo ve contratos de su producto).
- `tests`: pruebas locales del backend, de la pantalla y del CRM.

## Cómo ingresar al gestor (paso a paso)
1. En el Admin Maestro debe existir el producto `CAM-ACCESO` y el cliente (ej. Casa Linda) con un contrato de ese producto **activo y vigente**.
2. Abre el CRM (`CRM/…_CAM_ACCESO.html`), inicia sesión con MFA, entra al cliente → *Usuarios y accesos* → panel **CAM-ACCESO**.
3. Elige el contrato, escribe el código `porteria-casa-linda`, un nombre visible, el rol (Vigilante) y una clave de 12 o más caracteres. Crear.
4. Abre CAM-ACCESO, escribe **portería casa linda** y la clave. Debe abrir el gestor.
(Puestos de otro servicio del mismo cliente: `ronda-casa-linda` en un contrato CAM-RONDAS, desde el panel de CAM-RONDAS.)

## Pantalla de ingreso (CAM-ACCESO/)
- Campo "Puesto de servicio": acepta "portería casa linda" y lo convierte a `porteria-casa-linda`.
- La contraseña y el token viven solo en memoria; no se guardan en el navegador. Los registros locales se conservan al cerrar sesión.
- Se revalida contra el servidor cada 10 min y al volver a la pestaña (si pasaron más de 3 min). Un rechazo del servidor
  (puesto suspendido, contrato vencido, clave rotada) cierra la sesión; sin conexión, la sesión se cierra al vencer el token (15 min).
- Roles: Administrador TIC = perfil Administración; Vigilante y Supervisor = perfil Portería.
- `cam-acceso-config.js` solo contiene la URL y la clave PUBLICABLE (nunca service_role).

## Diferencias frente a CAM-RONDAS
- Producto fijo `CAM-ACCESO`, secreto de sesión y límite de intentos propios.
- **Integración comercial:** el ingreso y la revalidación de sesión consultan el Universal Bridge POST después de las comprobaciones locales. La autorización comercial central es obligatoria y falla cerrada.
- Comprobación de código único por producto al crear puestos.

## Reglas de datos
- Código: letras, números, punto, guion y guion bajo; sin espacios; 2 a 80 caracteres. Se guarda normalizado en MAYÚSCULAS.
  La pantalla de ingreso debe convertir "portería casa linda" en `porteria-casa-linda`.
- Clave: 12 a 128 caracteres.
- Roles permitidos por la base: `Vigilante`, `Supervisor`, `Administrador TIC`
  (Portería = Vigilante; Administración = Administrador TIC).
- Estados del puesto: `active`, `suspended`, `inactive`. Un contrato con puestos no se puede borrar: desactiva los puestos.

## Variables que la función necesita (solo nombres; nunca compartas los valores)
`CAM_ACCESO_SESSION_HMAC_SECRET` (mínimo 32 caracteres, distinto al de otros productos),
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
`CAM_ACCESO_RATE_LIMIT_POST`, `CAM_ACCESO_RATE_LIMIT_IP`, `CAM_ACCESO_RATE_LIMIT_WINDOW_SECONDS`,
`ALLOWED_ORIGINS` (opcional). Sin Upstash o sin IP confiable el ingreso **falla cerrado** (503).

## Pruebas locales
Desde la raíz del paquete: `node --test tests/*.test.mjs`.

## No acreditado todavía
- `deno check` de las tres funciones.
- Conexión real a Upstash y recepción de `cf-connecting-ip`.
- Pruebas HTTP contra Supabase real.
- Índices únicos adicionales sobre `post_code` (consultar `pg_indexes`; la restricción vista es solo `(client_product_id, post_code)`).
- Prueba de la pantalla en navegador contra las funciones desplegadas, y selector de producto en el CRM para crear puestos de CAM-ACCESO.

## Secuencia de activación (cada paso con autorización expresa)
1. Revisar los archivos y correr las pruebas locales y `deno check`.
2. Crear los secretos en Supabase (sin compartirlos).
3. Desplegar `cam-acceso-post-admin`; en el Admin Maestro: producto `CAM-ACCESO` activo, contrato de prueba vigente.
4. Crear un puesto de prueba y verificarlo con `cam-acceso-post-authorize` (200) y `cam-acceso-session-validate`.
5. Pruebas: clave errónea 401 · puesto suspendido 401 · contrato vencido 403 · código duplicado 409 · límite de intentos 429 · sesión vencida 401 · revalidación tras suspender 403.
6. Abrir `CAM-ACCESO/index.html` desde un servidor local (por ejemplo Live Server) y probar: ingreso, clave errónea, suspender el puesto y ver que la sesión se cierra en la siguiente revalidación, cerrar sesión sin perder registros.
7. Solo después, publicar en el repositorio de CAM-ACCESO.

MÉTODO: MEJORAR SIN ROMPER · RESPALDO INTACTO · CAMBIOS AISLADOS.


## Ajuste de identificación del cliente — 14 de noviembre de 2026

Se actualizó el CRM para que los paneles de administración de puestos CAM-RONDAS y CAM-ACCESO muestren, antes de crear un puesto:
- Nombre del cliente seleccionado en la ficha.
- NIT / identificación registrada.
- Producto y número/estado del contrato seleccionado.

La confirmación final de creación vuelve a mostrar cliente, NIT, producto y contrato. No se modificaron endpoints, tablas, credenciales, reglas de autenticación ni servicios remotos.

Pruebas locales ejecutadas: `cam-acceso-puesto.static.test.mjs` 13/13, `cam-acceso-gate.test.mjs` 9/9, `cam-acceso-crm.test.mjs` 6/6. Total: 28/28 aprobadas. No se ejecutó una prueba contra Supabase remoto.


## Iteración PUESTO-05 · Paneles desplegables
- Los paneles de administración de puestos CAM-RONDAS y CAM-ACCESO ahora son acordeones independientes.
- Ambos inician cerrados; al abrir uno, el otro se cierra automáticamente.
- Se conservan los identificadores internos, campos, botones, contratos y lógica de administración.
- Ajuste exclusivamente visual/interactivo del CRM; no incluye cambios remotos ni de esquema.


## Iteración PUESTO-06 · Vista principal enfocada en clientes
- Los bloques superiores de gestión de usuarios temporales y vinculación de usuarios existentes quedan dentro de un acordeón de administración avanzada, cerrado inicialmente.
- La pantalla principal prioriza el directorio de clientes, buscador e indicadores comerciales.
- La administración avanzada sigue disponible al desplegarla; no se eliminan formularios ni se cambian sus IDs o manejadores.
- La sección de puestos operativos permanece dentro de la pestaña «Usuarios y accesos» y conserva los acordeones CAM-RONDAS / CAM-ACCESO de PUESTO-05.
- Cambio visual de CRM únicamente; sin cambios de esquema, endpoints, credenciales ni servicios remotos.


## Adaptación Universal Bridge POST — candidata local

- `cam-acceso-post-authorize` conserva la búsqueda del puesto, bcrypt, estado, contrato local, roles y limitador Upstash; después exige autorización POST central.
- `cam-acceso-session-validate` conserva verificación HMAC de sesión y estado local; después revalida autorización POST central.
- Se agrega `_shared/universal-bridge-client.ts`, exclusivo de Edge Functions. Envía `identity_type=POST`, `project_code=CAM-ACCESO`, `product_code=CAM-ACCESO`, UUID del puesto y UUID del cliente.
- La autorización central falla cerrada: errores de infraestructura devuelven 503; denegaciones comerciales devuelven 403.
- No se modifican el HTML, el CRM, `cam-acceso-post-admin`, tablas, políticas, secretos ni servicios remotos.
- Requiere en el proyecto producto los nombres `CENTRAL_UNIVERSAL_AUTHORIZE_URL` (o alias `CENTRAL_BRIDGE_URL`) y una clave HMAC propia e independiente de CAM-ACCESO en `CAM_ACCESO_PROJECT_HMAC_SECRET`. La clave debe corresponder a la entrada `CAM-ACCESO` del `BRIDGE_PROJECT_SECRETS_JSON` de Bridge Central. No se ha comprobado la configuración remota ni se deben cambiar secretos sin verificarla.
- Estado: cambio local candidato; pendiente Deno Check y pruebas HTTP/E2E reales. No desplegar todavía.


## Revisión de integración POST · V1.1
- Se corrigió el nombre de la variable HMAC del proyecto producto: ahora exige exclusivamente `CAM_ACCESO_PROJECT_HMAC_SECRET`. No acepta secretos genéricos ni aliases compartidos con otros productos.
- La URL central continúa usando `CENTRAL_UNIVERSAL_AUTHORIZE_URL` o `CENTRAL_BRIDGE_URL`.
- Se ajustó la prueba estática para impedir regresiones hacia variables HMAC genéricas.
- Regresión local: 28/28 pruebas aprobadas.
- No se ejecutó Deno Check (Deno no está instalado en el entorno), ni pruebas HTTP/E2E remotas. No se modificó Supabase ni se desplegó ninguna función.


## Aclaración documental V1.1

La descripción anterior de «Sin llamada al Bridge» correspondía a una etapa previa y quedó obsoleta.
La candidata V1.1 sí integra Universal Bridge POST desde `cam-acceso-post-authorize` y
`cam-acceso-session-validate`, mediante `_shared/universal-bridge-client.ts`.
La integración sigue siendo candidata local: no implica despliegue ni prueba HTTP remota.
