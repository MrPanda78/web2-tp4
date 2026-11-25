# TP4 · Asincronismo e integración con Node.js y TypeScript

Web II — UNViMe. Aplicación para elegir un regalo grupal mediante propuestas y votos, con un ranking en vivo. Consigna: https://unvime-web-2.matiendres.workers.dev/practicos/tp4/

Es un proyecto independiente del TP2/TP3 de Java. Utiliza Node.js, TypeScript, HTTP, `ws` (protocolo WebSocket estándar), HTML/CSS/JavaScript y DummyJSON. No usa base de datos, Docker, Spring Boot ni Socket.IO. Todos los clientes comparten una única lista en memoria, que se pierde al reiniciar el proceso.

## Instalación y ejecución

Requisitos: Node.js 22 o 24 LTS (mínimo 22.9), npm y conexión a Internet para instalar dependencias y consultar DummyJSON.

Desde la carpeta que contiene `package.json`, en PowerShell:

```powershell
npm install
Copy-Item .env.example .env
npm start
```

En Linux/macOS, reemplazar `Copy-Item .env.example .env` por `cp .env.example .env`. `npm start` compila TypeScript y ejecuta el servidor. También se puede compilar con `npm run build`. El archivo `.env` no es obligatorio si se usan los valores por defecto.

- Participantes: http://localhost:3000/ (abrir tres pestañas o ventanas).
- Pantalla de solo lectura: http://localhost:3000/pantalla.
- Detener: `Ctrl+C`.

El servidor escucha en loopback (`127.0.0.1`), solo para pruebas locales. Las dos páginas, el WebSocket `/ws` y el SSE `/events` usan el mismo puerto. Si `localhost` no resuelve correctamente, usar `http://127.0.0.1:3000/`.

## Configuración

| Variable | Valor por defecto | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP, WS y SSE |
| `CATALOG_URL` | `https://dummyjson.com` | URL base, sin `/products` al final |
| `CATALOG_TIMEOUT_MS` | `3000` | Límite por consulta en milisegundos (1–60000) |
| `CATALOG_DELAY_MS` | `0` | Envía el parámetro `delay` a DummyJSON (0–60000 ms) |
| `CATALOG_SLOW_IDS` | vacío | IDs separados por coma; vacío aplica el retraso a todos |

Los valores pueden modificarse en `.env` (reiniciar el servidor) o mediante variables de entorno. No es necesario modificar el código. Para simular una consulta lenta que falla sin impedir cargar otros productos, usar `CATALOG_DELAY_MS=5000`, `CATALOG_SLOW_IDS=3` y `CATALOG_TIMEOUT_MS=3000`. Los demás IDs no tendrán demora artificial. Con una demora de 2000 ms y timeout de 5000 ms, el producto puede terminar agregándose en vez de fallar, si el catálogo responde dentro del límite.

## Arquitectura

```text
Participante A ── WebSocket bidireccional ─┐
Participante B ── WebSocket bidireccional ─┼─ Node.js / TypeScript ── fetch asíncrono ── DummyJSON
Participante C ── WebSocket bidireccional ─┘       │
Pantalla       ◀── SSE (solo recepción) ──────────┘
```

- `src/contract.ts`: tipos de mensajes y validación de JSON recibido.
- `src/catalog.ts`: configuración, fetch, timeout y validación de respuesta externa.
- `src/server.ts`: HTTP, conexiones WS/SSE, estado, votación y propuestas.
- `public/`: las dos páginas y sus scripts sin framework.

## Contrato de mensajes

Todos los mensajes de aplicación son objetos JSON con el campo `type`. Los participantes se conectan a `/ws`. Los IDs de productos deben ser enteros positivos seguros de JavaScript. El servidor rechaza campos inesperados y tipos incorrectos. Una conexión debe enviar `join` antes de realizar cualquier otra acción.

### Cliente → servidor (WebSocket)

| Tipo | Campos además de `type` | Cuándo se envía | Ejemplo |
|---|---|---|---|
| `join` | `name: string` | Para ingresar una vez por conexión | `{"type":"join","name":"Ana"}` |
| `propose` | `ids: number[]` (1–10) | Al proponer productos por ID | `{"type":"propose","ids":[1,2,999999]}` |
| `vote` | `productId: number` | Al votar un producto existente | `{"type":"vote","productId":1}` |
| `unvote` | `productId: number` | Al retirar un voto propio | `{"type":"unvote","productId":1}` |
| `remove` | `productId: number` | Al quitar un producto existente | `{"type":"remove","productId":1}` |

### Servidor → cliente (WebSocket)

| Tipo | Campos además de `type` | Destinatario y momento |
|---|---|---|
| `joined` | `name: string` | Solo al participante que ingresó correctamente |
| `state` | `participants: string[]`, `products: ParticipantProduct[]` | Estado completo inicial y después de cambios en conexiones, lista o votos. A cada participante conectado, con su indicador de voto propio |
| `proposal_result` | `added: number[]`, `failures: ProposalFailure[]` | Solo al autor de la propuesta cuando finalizan las consultas, incluso si todos fallaron |
| `error` | `code: ErrorCode`, `message: string` | Solo a quien envió un mensaje inválido o una acción no permitida |

Ejemplos:

```json
{"type":"joined","name":"Ana"}
```

```json
{"type":"state","participants":["Ana","Bruno"],"products":[{"id":1,"title":"Essence Mascara Lash Princess","price":9.99,"image":"https://example.com/imagen.png","proposedBy":"Ana","votes":1,"votedByMe":true}]}
```

```json
{"type":"proposal_result","added":[1,2],"failures":[{"id":999999,"code":"not_found","message":"El producto no existe en el catálogo."}]}
```

```json
{"type":"error","code":"invalid_json","message":"El mensaje no es JSON válido."}
```

La URL de imagen anterior es ilustrativa; en ejecución se obtiene el `thumbnail` real del catálogo.

**Estructuras de datos:** `CatalogProduct` contiene `id` (number), `title` (string), `price` (number), `image` (string); `RankedProduct` añade `proposedBy` (string) y `votes` (number); `ParticipantProduct` añade `votedByMe` (boolean). `ProposalFailure` contiene `id` (number), `code` (FailureCode) y `message` (string).

**Códigos de fallo de una propuesta (`FailureCode`):** `not_found` (HTTP 404), `timeout` (se agotó el tiempo), `duplicate` (ya está en la lista), `catalog_error` (otro fallo HTTP, red o respuesta inválida).

**Códigos de error (`ErrorCode`):** `invalid_json`, `invalid_message` (estructura, campos, formato o rango), `unknown_type`, `invalid_name`, `name_taken`, `already_joined`, `not_joined`, `product_not_found`, `already_voted`, `not_voted`, `internal_error`.

### Servidor → pantalla (SSE)

La pantalla abre `new EventSource('/events')`. Solo recibe el evento `ranking`, con los campos `type: 'ranking'`, `participantCount: number`, `products: RankedProduct[]`. Se emite al conectarse y ante cada cambio de estado. No tiene acciones de escritura, ni recibe errores privados ni `votedByMe`.

```text
event: ranking
data: {"type":"ranking","participantCount":2,"products":[{"id":1,"title":"Producto","price":9.99,"image":"https://example.com/imagen.png","proposedBy":"Ana","votes":1}]}

```

## Decisiones y justificación

- **Nombres:** entre 1 y 30 caracteres después de eliminar espacios de los extremos, sin caracteres de control. No se permiten nombres vacíos ni repetidos mientras estén conectados; se ignoran mayúsculas/minúsculas al comparar. Cada conexión obtiene un UUID interno.
- **Productos repetidos:** cada ID existe como máximo una vez. El segundo intento recibe `duplicate`; no suma una propuesta ni un voto. También aplica si el mismo ID aparece dos veces dentro de un lote.
- **Eliminación:** cualquier participante conectado puede quitar productos, incluso con votos. Se trata de una lista colaborativa; así ningún producto queda bloqueado cuando su autor se desconecta. La pantalla no puede efectuar acciones de edición.
- **Votos:** un voto por producto por conexión, validado mediante `Set`. Proponer no equivale a votar. Al desconectarse, se retiran sus votos y su nombre para evitar votos huérfanos y duplicados por reingresos. Las propuestas ya agregadas permanecen; las consultas de una conexión cerrada se descartan al terminar. El ranking se ordena de mayor a menor cantidad de votos; los empates se resuelven por ID ascendente.
- **Timeout:** 3000 ms por defecto, para no dejar la propuesta esperando indefinidamente y ofrecer un margen razonable a una consulta HTTP interactiva. Es configurable. `AbortSignal.timeout` cancela la solicitud si se agota el plazo, incluyendo la lectura del cuerpo.
- **Fallos parciales:** se consultan los IDs en paralelo con `Promise.all` y cada consulta convierte sus errores en un resultado. Se agregan los válidos; el autor ve el motivo de cada rechazo, y los demás solo reciben el estado actualizado. Mientras consulta, el autor ve un indicador de espera. No se bloquean votos ni otras acciones.
- **Consistencia:** tras esperar al catálogo, la inserción vuelve a comprobar la existencia del ID y modifica el `Map` sin `await` entre la comprobación y la inserción. Los votos y las eliminaciones son operaciones síncronas, por lo que dos mensajes no pueden intercalarse dentro de esas operaciones en este único proceso de Node.js.
- **Desconexión:** el evento `close` elimina al participante y sus votos; SSE elimina sus respuestas cerradas. No hay reconexión automática de participantes, ni comprobación periódica `ping/pong` (no se incluyen los opcionales de la consigna).

## ¿Por qué WebSocket y SSE?

Los participantes necesitan enviar acciones y recibir cambios inmediatamente: WebSocket mantiene una conexión bidireccional. La pantalla no envía acciones; SSE mantiene una respuesta HTTP abierta y recibe eventos del servidor mediante `EventSource`, de forma más sencilla. Con polling, la pantalla tendría que consultar repetidamente el estado por HTTP aun cuando no cambie nada, generando solicitudes extra y una demora dependiente del intervalo. SSE envía el estado al producirse cambios.