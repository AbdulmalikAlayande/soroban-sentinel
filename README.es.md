<p align="center">
  <h1 align="center">Sorokeep</h1>
  <p align="center">
    <a href="README.md">English</a>
    &middot;
    <a href="README.es.md">Español</a>
    &middot;
    <a href="README.pt.md">Português (Brasil)</a>
  </p>
  <p align="center">
    La capa de operaciones faltante para contratos inteligentes Soroban desplegados.
    <br />
    Monitorea los TTL. Recibe alertas antes de la expiración. Extiende automáticamente el almacenamiento. Restaura entradas archivadas.
    <br />
    <br />
    <a href="#install">Instalación</a>
    &middot;
    <a href="#quick-start">Inicio Rápido</a>
    &middot;
    <a href="#commands">Comandos</a>
    &middot;
    <a href="#alerting">Alertas</a>
    &middot;
    <a href="#contributing">Contribución</a>
  </p>
</p>

<br />

## Por qué existe esto

*(¿No estás familiarizado con la terminología de Soroban/Stellar como TTL, footprint o ledger entry? Consulta el [Glosario](docs/glossary.md).)*

El modelo de almacenamiento de Soroban es poco común entre las principales plataformas de contratos inteligentes: **el estado expira.** Cada entrada del libro mayor (instancias de contratos, almacenamiento persistente, código WASM) tiene un Tiempo de Vida (TTL). Cuando se agota, la entrada se archiva. Si la entrada de la instancia de un contrato expira, el contrato entero deja de funcionar. Si las entradas de almacenamiento persistente expiran, los datos del usuario se vuelven inaccesibles hasta que alguien pague para restaurarlos.

Esto es por diseño — el archivo del estado mantiene a Stellar ligero y escalable. Pero significa que **debes gestionar activamente el ciclo de vida del estado de tu contrato, o este muere.**

Actualmente no existe una herramienta dedicada de código abierto que combine el monitoreo de TTL, alertas, extensión automática, seguimiento de costos y restauración para los contratos Soroban. Los desarrolladores usan comandos manuales de CLI, construyen scripts ad-hoc o incrustan lógica de extensión de TTL directamente en sus contratos.

Sorokeep es la capa de operaciones unificada que maneja todo esto.

> Los auditores de seguridad han comenzado a señalar la mala gestión de TTL como un área de riesgo en los contratos de Soroban. [Veridise](https://veridise.com/audits/soroban/) incluye el manejo de TTL en el alcance de sus auditorías. La [auditoría del endpoint de LayerZero para Stellar](https://code4rena.com/audits/2026-04-layerzero-stellar-endpoint) enumera explícitamente los casos extremos de expiración de TTL como una preocupación. La [biblioteca de contratos Stellar de OpenZeppelin](https://docs.openzeppelin.com/stellar-contracts) deja deliberadamente la gestión del TTL de almacenamiento de instancia al desarrollador de la aplicación.

## Características

- **Observación e Introspección** — Registra contratos, descubre *footprints* a partir de transacciones en la cadena y especificaciones de introspección
- **Monitoreo** — Consulta continua de TTL con intervalos configurables a través de un daemon de larga duración
- **Alertas** — Notificaciones multicanal desacopladas y respaldadas por cola (Webhook con HMAC-SHA256, Slack Block Kit, Discord, Telegram, PagerDuty) con una lógica sólida de reintento para TTLs bajos, picos en el uso de recursos y cambios de estado
- **Extensión Automática** — Extensión automática de TTL basada en políticas con simulación de transacciones antes del envío a través de `ExtendFootprintTTLOp`
- **Restauración** — Recupera entradas archivadas mediante `RestoreFootprintOp` con simulación previa al envío
- **Seguimiento de Costos y Recursos** — Rastrea el historial de extensiones, costos en XLM, proyecciones a 30 días, registros de uso de recursos e impone presupuestos mensuales configurables para evitar gastos descontrolados
- **Inspección** — Inspecciona el estado en la cadena, analiza balances de tokens SAC y compara cambios de estado
- **Canales** — Gestiona cuentas de canal financiadas para envíos de transacciones concurrentes sin cuellos de botella de secuencia
- **Primero Local** — Todo el estado se almacena en una cola respaldada por una base de datos SQLite. Sin servicios externos más allá de un endpoint RPC de Stellar
- **Listo para IA** — Servidor Model Context Protocol (MCP) integrado que expone herramientas para que los agentes de IA interactúen de forma nativa con los datos de Sorokeep
- **Seguridad Avanzada** — Se integra con AWS Secrets Manager y HashiCorp Vault para una resolución segura de claves
- **Implementaciones listas para Producción** — Incluye Dockerfile, plantillas de servicio systemd y GitHub Actions para integración CI/CD

## Instalación

**Requisitos:** Node.js 22+

```bash
# Desde el código fuente
git clone https://github.com/AbdulmalikAlayande/sorokeep.git
cd sorokeep
npm install
npm run build

# Ejecutar directamente
npx tsx src/index.ts --help

# O vincular globalmente después de compilar
npm link
sorokeep --help

# Instalar el manual local
mkdir -p ~/.local/share/man/man1
cp man/sorokeep.1 ~/.local/share/man/man1/
mandb 2>/dev/null || true
man sorokeep
```

<!--
# npm (próximamente)
npm install -g sorokeep
-->

## Inicio Rápido

```bash
# 1. Registrar un contrato para monitoreo
sorokeep watch CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --network testnet \
  --name "XLM Native Token"

# 2. Comprobar su salud de TTL actual
sorokeep status CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# 3. Configurar una alerta webhook (se dispara cuando el TTL cae por debajo de 20,000 ledgers)
sorokeep alerts add \
  --contract CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --type webhook \
  --url https://your-server.com/webhook \
  --threshold 20000

# 4. Iniciar el daemon de monitoreo
sorokeep daemon --network testnet
```

El daemon verificará los TTLs cada 5 minutos, disparará alertas cuando se crucen los umbrales, enviará notificaciones de resolución cuando los TTLs se recuperen y extenderá automáticamente las entradas si se configuran políticas de guardia.

## Comandos

### `sorokeep watch <contract-id>`

Registra un contrato para su monitoreo. Se conecta al RPC de Stellar, descubre la instancia del contrato y las entradas del código WASM, lee sus TTLs y almacena todo localmente.

```bash
sorokeep watch <contract-id> [options]
```

| Opción | Descripción | Por defecto |
|--------|-------------|---------|
| `-n, --name <name>` | Nombre del contrato legible por humanos | — |
| `--network <network>` | `testnet` o `mainnet` | `testnet` |
| `-r, --rpc-url <url>` | Endpoint RPC de Stellar personalizado | Valor de red |
| `--storage-keys <keys>` | Claves de almacenamiento XDR en base64 separadas por comas a rastrear | — |

**Ejemplo de salida:**

```
$ sorokeep watch CDLZFC3S...CYSC --network testnet --name "XLM Native Token"

✔ Contract XLM Native Token registered successfully.

  Contract: XLM Native Token (CDLZFC3S...CYSC)
  Network:  testnet
  Entries:  1 discovered
  Instance TTL: 113,918 ledgers (~7d 6h)  OK

  Run 'sorokeep status CDLZFC3S...CYSC' to check TTLs anytime.
  Run 'sorokeep guard CDLZFC3S...CYSC' to enable auto-extension.
```

El descubrimiento de entradas ocurre en capas:

1. **Determinista** (automático) — Entradas de instancia de contrato y código WASM, derivadas del ID del contrato y el hash WASM. Siempre rastreadas.
2. **Basado en Footprint** (daemon) — Descubierto escaneando eventos de transacciones en cadena en busca de claves de almacenamiento que usa tu contrato.
3. **Manual** (opcional) — Claves de almacenamiento específicas declaradas a través de `--storage-keys`.

---

### `sorokeep status <contract-id>`

Muestra el estado actual del TTL para un contrato en observación. Lee de la base de datos local — sin llamada RPC.

```bash
sorokeep status <contract-id>
```

Muestra el nombre del contrato, la red, el último ledger verificado y una tabla de todas las entradas rastreadas con el TTL restante en ledgers y en formato de tiempo legible, además de un indicador de estado (OK / Warning / Critical).

---

### `sorokeep daemon`

Inicia el proceso de monitoreo de larga duración.

```bash
sorokeep daemon [options]
```

| Opción | Descripción | Por defecto |
|--------|-------------|---------|
| `--network <network>` | Red a monitorear | `testnet` |
| `--interval <ms>` | Intervalo de sondeo en milisegundos (mínimo: 10,000) | `300000` (5 min) |
| `-r, --rpc-url <url>` | Endpoint RPC personalizado | Valor de red |

Cada ciclo realiza tres fases:

1. **Monitoreo** — Obtiene TTLs frescos para todos los contratos, detecta cruces de umbrales, resuelve alertas recuperadas
2. **Entrega** — Envía las alertas pendientes a los webhooks y canales de Slack configurados
3. **Extensión Automática** — Extiende los TTL para contratos con políticas de guardia activas

El daemon maneja el cierre elegante en `SIGINT`/`SIGTERM` e incluye una protección de reingreso para evitar ciclos superpuestos.

---

### `sorokeep alerts`

Gestiona las configuraciones de alertas. Soporta cinco subcomandos.

#### `alerts add` — Crea una nueva alerta

```bash
sorokeep alerts add [options]
```

| Opción | Descripción |
|--------|-------------|
| `--contract <id>` | ID de contrato sobre el cual alertar (requerido) |
| `--type <type>` | `webhook` o `slack` (requerido) |
| `--url <url>` | URL de POST para Webhook (requerido para webhook) |
| `--channel <channel>` | Nombre o ID del canal de Slack (requerido para slack) |
| `--threshold <ledgers>` | Disparar cuando el TTL restante caiga por debajo de esto (requerido) |
| `--secret <secret>` | Secreto de firma HMAC para webhooks (autogenerado si se omite) |

Para las alertas webhook, se autogenera un secreto de firma HMAC (hexadecimal de 32 bytes) si no proporcionas uno. El secreto se muestra una vez al momento de la creación — guárdalo para verificar las firmas webhook en tu servidor. Consulta [Firma de Webhooks](#webhook-signing) para más detalles.

#### `alerts list` — Ve las alertas configuradas

```bash
sorokeep alerts list --contract <id>
```

#### `alerts remove` — Elimina una configuración de alerta

```bash
sorokeep alerts remove --id <config-id>
```

#### `alerts test` — Envía una alerta de prueba

```bash
sorokeep alerts test --id <config-id>
```

Dispara un evento sintético `threshold_crossed` a través del flujo de entrega real. Útil para verificar que tu endpoint webhook o canal de Slack estén correctamente configurados antes de salir a producción.

#### `alerts history` — Ve el historial de alertas pasadas

```bash
sorokeep alerts history --contract <id> [--limit 20]
```

Muestra una tabla con las alertas disparadas: marca de tiempo, etiqueta de la entrada, TTL en el momento de disparo, tipo de canal, estado de la entrega, conteo de reintentos y tiempo de resolución.

---

### `sorokeep guard`

Configura políticas de extensión automática. Cuando se habilita, el daemon extiende automáticamente los TTLs mediante el envío de transacciones `ExtendFootprintTTLOp` usando un par de claves Stellar con fondos.

```bash
sorokeep guard <contract-id> [options]
```

| Opción | Descripción | Por defecto |
|--------|-------------|---------|
| `--target-ttl <ledgers>` | TTL al cual extender las entradas | `100000` |
| `--threshold <ledgers>` | Extender cuando el TTL caiga por debajo de esto | `20000` |
| `--keypair <secret>` | Clave secreta Stellar (para extensión única) | — |
| `--keypair-env <var>` | Nombre de la variable de entorno que contiene la clave secreta | — |
| `--auto-extend` | Habilita la extensión automática del daemon (requiere `--keypair-env`) | — |
| `--dry-run` | Simula la extensión y muestra la tarifa estimada | — |
| `--disable` | Deshabilita la extensión automática para este contrato | — |

**Modos de uso:**

```bash
# Comprobar la política actual
sorokeep guard <contract-id>

# Ejecución en seco — ver tarifa estimada sin enviar
sorokeep guard <contract-id> --keypair S... --dry-run

# Extensión inmediata por única vez
sorokeep guard <contract-id> --keypair S...

# Habilitar extensión automática para el daemon
sorokeep guard <contract-id> --keypair-env STELLAR_SECRET_KEY --auto-extend

# Deshabilitar extensión automática
sorokeep guard <contract-id> --disable
```

**Seguridad:** Las claves secretas nunca se almacenan en la base de datos. Cuando se usa `--auto-extend`, solo se guarda la clave pública y el nombre de la variable de entorno. El daemon resuelve la clave secreta real desde el entorno en tiempo de ejecución.

---

### `sorokeep costs`

Ver el historial de extensiones y los gastos de renta para un contrato.

```bash
sorokeep costs <contract-id> [options]
```

| Opción | Descripción | Por defecto |
|--------|-------------|---------|
| `--period <days>` | Muestra costos para los últimos N días | `30` |
| `--all` | Muestra todo el historial | — |

**La salida incluye:**

- Total de extensiones y costo total en XLM
- Desglose por tipo de entrada (instancia, wasm, persistente) con cantidad y costo
- Proyección de costos a 30 días extrapolada del período seleccionado
- Tabla de extensiones recientes: marca de tiempo, etiqueta de la entrada, TTL viejo → TTL nuevo, costo en XLM, hash de la transacción

---

### `sorokeep restore`

Recuperar entradas de ledger archivadas a través de transacciones `RestoreFootprintOp`.

```bash
sorokeep restore <contract-id> [options]
```

| Opción | Descripción |
|--------|-------------|
| `--keypair <secret>` | Clave secreta Stellar |
| `--keypair-env <var>` | Variable de entorno que contiene la clave secreta |
| `--entry <keyXdr>` | XDR de clave de entrada específica para restaurar (repetible) |
| `--all` | Restaura todas las entradas rastreadas para el contrato |

Se requiere ya sea `--keypair` o `--keypair-env`. Se requiere ya sea `--entry` o `--all` (mutuamente excluyentes).

```bash
# Restaurar una entrada específica
sorokeep restore <contract-id> --keypair-env STELLAR_SECRET_KEY --entry <base64-xdr>

# Restaurar todas las entradas rastreadas
sorokeep restore <contract-id> --keypair-env STELLAR_SECRET_KEY --all
```

---

### `sorokeep resources`

Visualizar registros de uso de recursos (instrucciones CPU, bytes de memoria, estructuras de tarifas) de un contrato para rastrear la eficiencia de ejecución con el tiempo.

---

### `sorokeep budget`

Establece y monitorea un presupuesto de extensión mensual en XLM para un contrato. Evita costos descontrolados si un contrato requiere extensiones frecuentes.

---

### `sorokeep channels`

Gestionar cuentas de canal financiadas que se utilizan para enviar transacciones de extensión y restauración concurrentemente, evitando cuellos de botella en los números de secuencia.

---

### `sorokeep inspect`

Inspecciona el estado en la cadena directamente. Puede analizar los balances de tokens de Stellar Asset Contract (SAC), comparar cambios de estado y decodificar XDR sin intervención manual.

---

### `sorokeep check`

Realiza una ejecución de un solo uso ad-hoc del ciclo de monitoreo sin iniciar el daemon de larga duración.

---

### `sorokeep db`

Tareas de gestión de la base de datos, incluyendo migraciones, copias de seguridad y administración de caché de introspección.

---

### `sorokeep completion`

Genera scripts de autocompletado de shell para bash/zsh para habilitar el completado con tabulador de todos los comandos de Sorokeep.

## Alertas

Sorokeep entrega alertas a través de múltiples canales: **webhooks**, **Slack**, **Discord**, **Telegram** y **PagerDuty**. Cada alerta incluye un nivel de severidad y contexto detallado sobre la entrada afectada. Sorokeep utiliza una arquitectura de despacho y detección desacoplada robusta con una cola respaldada por base de datos.

### Ciclo de Vida de las Alertas

1. **Umbral Cruzado** — Durante cada ciclo de monitoreo, si el TTL restante de una entrada cae por debajo de un umbral configurado, el monitor escribe una alerta `threshold_crossed` en la cola de la base de datos.
2. **Entrega** — El despachador lee las filas no entregadas de la cola y enruta la alerta al canal configurado. Las entregas fallidas se reintentan en los ciclos posteriores, hasta 5 intentos, y luego se abandonan con gracia. El éxito marca la fila como entregada.
3. **Resolución** — Cuando el TTL se recupera pasado el umbral (por ejemplo, después de una extensión), Sorokeep dispara una notificación `alert_resolved` a todos los canales configurados.

### Niveles de Severidad

La severidad se calcula automáticamente en función de cuánto TTL queda en relación con el umbral configurado:

| Severidad | Condición | Descripción |
|----------|-----------|-------------|
| **critical** | TTL restante < 25% del umbral, o TTL = 0 | La entrada está en peligro inminente de archivo |
| **warning** | TTL restante por debajo del umbral pero por encima del 25% | La entrada necesita atención pronto |
| **info** | Alerta resuelta (TTL recuperado) | La entrada vuelve a ser saludable |

### Entrega de Webhook

Las alertas de webhook se envían como solicitudes HTTP POST con un cuerpo JSON:

```json
{
  "type": "threshold_crossed",
  "severity": "warning",
  "contractId": "CDLZFC3S...",
  "contractName": "XLM Native Token",
  "network": "testnet",
  "entry": {
    "keyXdr": "AAAA1234...",
    "type": "instance",
    "label": "Contract Instance"
  },
  "threshold": {
    "configuredLedgers": 20000,
    "currentRemainingLedgers": 8500,
    "approximateTimeRemaining": "~13h 0m"
  },
  "firedAtLedger": 2500000,
  "timestamp": "2026-06-13T12:00:00.000Z"
}
```

### Firma de Webhooks

Las peticiones de webhook incluyen una firma HMAC-SHA256 en el encabezado `X-Sorokeep-Signature` para verificación del payload:

```
X-Sorokeep-Signature: sha256=a1b2c3d4e5f6...
```

Para verificar en tu servidor:

```javascript
import { createHmac } from "node:crypto";

function verifySignature(payload, signature, secret) {
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return signature === expected;
}
```

El secreto de firma se genera automáticamente al crear una alerta de webhook (o puedes proveer el tuyo con `--secret`). Se muestra una vez en el momento de la creación — guárdalo de forma segura.

### Entrega en Slack

Las alertas de Slack se envían usando la [API Web de Slack](https://api.slack.com/methods/chat.postMessage) y utilizando Block Kit para formato enriquecido. Los mensajes incluyen íconos de severidad, detalles del contrato, TTL restante y sugerencias de acciones.

**Configuración:**

1. Crea una aplicación en Slack con alcance `chat:write` en [api.slack.com/apps](https://api.slack.com/apps)
2. Instala la app en tu espacio de trabajo y copia el Bot User OAuth Token (`xoxb-...`)
3. Proporciona el token mediante variable de entorno:

```bash
export SOROKEEP_SLACK_TOKEN=xoxb-tu-bot-token
```

Alternativamente, almacena el token en tu archivo de configuración en `~/.sorokeep/config.yaml`:

```yaml
slackToken: "xoxb-tu-bot-token"
```

La variable de entorno tiene precedencia sobre el archivo de configuración.

### Política de Reintentos

Las entregas de alertas fallidas se reintentan automáticamente en los siguientes ciclos del daemon. Después de **5 fallos consecutivos**, la alerta se abandona y no se realizan más intentos de entrega. Puedes ver el estado de la entrega y el número de reintentos con `sorokeep alerts history`.

## Cómo Funciona

Sorokeep es una herramienta de monitoreo fuera de la cadena. Lee datos del RPC de Stellar, los almacena localmente en SQLite y actúa sobre ellos (alertas, extensión automática, restauración). No se ejecuta en la cadena y no requiere que modifiques tus contratos.

```
                         ┌─────────────────────┐
                         │   Stellar Network    │
                         │  (testnet / mainnet) │
                         └──────────┬───────────┘
                                    │ RPC
                         ┌──────────▼───────────┐
                         │   Sorokeep    │
                         │                       │
                         │  ┌─────────────────┐  │
                         │  │  Monitor Cycle   │  │
                         │  │  (fetch TTLs,    │  │
                         │  │   detect alerts, │  │
                         │  │   resolve)       │  │
                         │  └────────┬────────┘  │
                         │           │            │
                         │  ┌────────▼────────┐  │
                         │  │   Dispatcher     │  │
                         │  │  (webhook/slack) │  │
                         │  └────────┬────────┘  │
                         │           │            │
                         │  ┌────────▼────────┐  │
                         │  │  Auto-Extend     │  │
                         │  │  (guard policy)  │  │
                         │  └─────────────────┘  │
                         │                       │
                         │  ┌─────────────────┐  │
                         │  │   SQLite DB      │  │
                         │  │  ~/.soroban-     │  │
                         │  │   sorokeep/     │  │
                         │  │   sorokeep.db    │  │
                         │  └─────────────────┘  │
                         └───────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              ┌──────────┐  ┌────────────┐  ┌────────────┐
              │ Webhooks │  │   Slack    │  │  Terminal  │
              └──────────┘  └────────────┘  └────────────┘
```

### El Ciclo del Daemon

Cada intervalo de sondeo (por defecto: 5 minutos), el daemon ejecuta tres fases:

1. **Monitoreo** — Para cada contrato registrado, obtiene TTLs recientes del RPC, actualiza la base de datos, comprueba cada entrada contra todos los umbrales de alerta configurados. Dispara `threshold_crossed` cuando el TTL cae por debajo de un umbral; dispara `alert_resolved` cuando el TTL se recupera.

2. **Entrega** — Procesa todas las alertas no entregadas de la cola de la base de datos. Enruta cada una hacia su canal configurado (Webhook, Slack, Discord, Telegram, PagerDuty), marca las entregas exitosas, incrementa los contadores de reintento en caso de fallo, y abandona con gracia después de 5 reintentos.

3. **Extensión Automática** — Para los contratos con una política de guardia activa, comprueba qué entradas tienen un TTL por debajo del umbral de la política y simula una transacción `ExtendFootprintTTLOp` vía el RPC de Stellar. Si tiene éxito, envía la transacción, registra el costo exacto en XLM y actualiza el uso del presupuesto mensual del contrato para prevenir gastos descontrolados.

Para el flujo de datos completo (orden exacto de llamadas, aislamiento de fallos entre fases, dónde suele aterrizar una nueva contribución), consulta [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Almacenamiento

Todo el estado es local. Sorokeep almacena los datos en `~/.sorokeep/sorokeep.db` (SQLite con modo WAL). No requiere servicios externos más allá de un endpoint RPC de Stellar.

**Tablas de la base de datos:**

| Tabla | Propósito |
|-------|---------|
| `contracts` | Contratos registrados con red, nombre, hash WASM |
| `contract_entries` | Entradas del ledger rastreadas con TTLs y fuente de descubrimiento |
| `extension_policies` | Reglas de extensión automática por contrato (umbral, objetivo, referencia a clave) |
| `alert_configs` | Canales de alerta, umbrales y secretos de webhook |
| `alerts_fired` | Registros de alertas disparadas con estado de entrega, cuenta de reintentos y seguimiento de resolución |
| `extension_history` | Cada extensión de TTL con su hash de transacción y costo en XLM |

### Configuración

Sorokeep almacena la configuración del usuario en `~/.sorokeep/config.yaml`:

```yaml
network: testnet
pollingIntervalSeconds: 300
slackToken: "xoxb-..."        # Opcional — también puede usar la variable env SOROKEEP_SLACK_TOKEN
rpcUrl: "https://..."         # Opcional — anula el valor por defecto de la red
```

El archivo de configuración se crea con permisos `0600` (lectura/escritura solo por el propietario) para proteger valores sensibles como el token de Slack.

## Estructura del Proyecto

```
sorokeep/
├── src/
│   ├── index.ts                 # Punto de entrada de la CLI (Commander.js)
│   ├── commands/                # Manejadores de comandos CLI (capa de presentación fina)
│   │   ├── watch.ts             # Registro del contrato
│   │   ├── status.ts            # Visualización de salud TTL
│   │   ├── daemon.ts            # Monitor de larga duración
│   │   ├── alerts.ts            # CRUD de alertas + pruebas + historial
│   │   ├── guard.ts             # Políticas de auto-extensión
│   │   ├── costs.ts             # Informes de costo de extensión
│   │   └── restore.ts           # Recuperación de entradas archivadas
│   ├── core/                    # Lógica de negocio (sin dependencias de CLI)
│   │   ├── watch.ts             # Registro y descubrimiento de contrato
│   │   ├── monitor.ts           # Ciclo de sondeo, detección de umbral, resolución
│   │   ├── extension.ts         # Extensión TTL, auto-extensión, restauración, registro de costos
│   │   └── discovery.ts         # Descubrimiento de claves de almacenamiento basadas en footprint
│   ├── alerts/                  # Pipeline de entrega de alertas
│   │   ├── types.ts             # AlertEvent, AlertSeverity, buildAlertEvent
│   │   ├── dispatcher.ts        # Enrutamiento, lógica de reintento, orquestación de entrega
│   │   ├── webhook.ts           # HTTP POST con firma HMAC-SHA256
│   │   └── slack.ts             # API Web de Slack + formateo con Block Kit
│   ├── daemon/                  # Ciclo de vida del Daemon
│   │   └── loop.ts              # Inicio/parada, guardia de reingreso, orquestación de ciclos
│   ├── rpc/                     # Wrapper del cliente RPC de Stellar
│   │   └── client.ts            # Obtención de Instancia/WASM, TTLs por lotes, extensión, restauración
│   ├── db/                      # Capa de base de datos
│   │   ├── schema.sql           # Esquema completo de SQLite
│   │   ├── database.ts          # Inicialización, modo WAL, migraciones en vivo
│   │   └── repositories.ts      # Todas las funciones de consulta
│   ├── logging/                 # Registro estructurado (pino)
│   └── utils/                   # Cargador de configuración, formateo de TTL
├── tests/                       # Refleja la estructura de src/ — 891 tests en 66 archivos
├── .github/workflows/           # CI (tests + comprobación de tipos) y publicación
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── Dockerfile                   # Definición de contenedor Docker
├── systemd/                     # Plantillas de servicio Systemd para implementaciones en Linux
├── LICENSE
└── CONTRIBUTING.md
```

**Capas de la arquitectura:**

- **Commands** (`src/commands/`) — Capa delgada de CLI. Analiza los argumentos, llama a core y formatea la salida de la terminal. Sin lógica de negocios.
- **Core** (`src/core/`) — Lógica de negocio pura. Probable sin red o CLI. El daemon reutiliza las mismas funciones.
- **RPC** (`src/rpc/`) — Wrapper del SDK de Stellar. Todas las llamadas de red pasan por aquí. Maneja la construcción de transacciones, la simulación, la firma y el envío.
- **Alerts** (`src/alerts/`) — Pipeline de entrega. Formateo y transporte específicos del canal, enrutamiento, gestión de reintentos.
- **DB** (`src/db/`) — Repositorios de SQLite. Todas las consultas centralizadas aquí. Modo en memoria para las pruebas.

## Stack Tecnológico

| Paquete | Propósito |
|---------|---------|
| [TypeScript](https://www.typescriptlang.org/) | Lenguaje de la aplicación (ESM) |
| [@stellar/stellar-sdk](https://github.com/nicktomlin/js-stellar-sdk) | Interacciones RPC con Stellar y Soroban |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Base de datos local (síncrona, cero dependencias externas) |
| [Commander.js](https://github.com/tj/commander.js) | Framework CLI |
| [pino](https://github.com/pinojs/pino) | Logging estructurado JSON |
| [chalk](https://github.com/chalk/chalk) / [ora](https://github.com/sindresorhus/ora) | Formato de terminal y spinners |
| [yaml](https://github.com/eemeli/yaml) | Analizador de archivos de configuración |
| [Vitest](https://vitest.dev/) | Framework de pruebas |

## Pruebas

```bash
# Ejecutar todas las pruebas
npm test

# Ejecutar un archivo de prueba específico
npx vitest run tests/core/monitor.test.ts

# Modo observación (watch mode)
npx vitest
```

**891 tests** en **66 archivos de prueba** que cubren:

- **Formato** — Conversión de TTL, clasificación de estados, tiempo legible para humanos
- **Base de datos** — CRUD, cascadas, inserciones (upserts), desduplicación, colas de entrega de alertas
- **Cliente RPC** — Instancia de contrato, código WASM, consultas de TTL por lotes, simulación de transacciones
- **Watch** — Registro, re-observación, contratos SAC, manejo de errores, aislamiento de red, introspección
- **Ciclo del Monitor** — Refresco de TTL, detección de umbral, desduplicación de alertas, resolución, aislamiento de fallas, escalación de múltiples umbrales, respuestas RPC parciales
- **Extensión** — Extensión de TTL, evaluación de políticas de auto-extensión, restauración, registro de costos, ejecución de presupuestos
- **Despachador de Alertas** — Enrutamiento de canales, lógica de reintento, límite máximo de reintentos, alertas abandonadas (Slack, Discord, Telegram, Webhook, PagerDuty)
- **Webhook** — Firma HMAC-SHA256, manejo de tiempos de espera, respuestas de error HTTP
- **Slack** — Resolución de tokens, estructura Block Kit, validación `body.ok`
- **Comandos CLI** — Alertas, presupuesto, guardia, costos, reloj, estado, demonio, comprobar, restaurar, bd, canales
- **Configuración** — Cargar/guardar, valores predeterminados, manejo de fallas de análisis, permisos de archivos
- **Daemon** — Inicio/parada, guardia de reingreso, aislamiento de errores de ciclo
- **Servidor MCP** — Cobertura de prueba para todas las herramientas expuestas por MCP

Todas las pruebas utilizan bases de datos SQLite en memoria y respuestas RPC simuladas — sin llamadas de red ni efectos secundarios en el sistema de archivos. Se practica TDD en todo momento.

## FAQ (Preguntas Frecuentes)

### ¿Por qué TypeScript y no Rust?

Sorokeep es una herramienta operativa fuera de la cadena, no un contrato inteligente. Se eligió TypeScript porque:

1. El Stellar JS SDK es la biblioteca de cliente más completa para interactuar con Soroban RPC
2. Los desarrolladores de Soroban ya tienen Node.js en su cadena de herramientas
3. La distribución a través de npm significa una instalación sin fricciones
4. Los requisitos de rendimiento (sondeo RPC periódico) están perfectamente dentro de las capacidades de Node.js
5. Maximiza el grupo de colaboradores — la mayoría de los desarrolladores de Soroban conocen TypeScript

### ¿Se guarda mi clave secreta en algún lugar?

No. Cuando configuras la extensión automática con `--keypair-env`, Sorokeep almacena solo la **clave pública** y el **nombre de la variable de entorno** en la base de datos. La clave secreta real se resuelve desde tu entorno en tiempo de ejecución. Si usas `--keypair` para una operación única, la clave se usa en la memoria y nunca se persiste.

### ¿Qué sucede si el daemon se bloquea en medio del ciclo?

Cada fase (monitor, entrega, extensión automática) está envuelta en un manejo de errores aislado. Una falla en una fase no impide que se ejecuten las demás. Las entregas de alertas son idempotentes — si una entrega se marcó como exitosa, no se volverá a enviar. Si el daemon se reinicia, las alertas no entregadas se recogerán en el siguiente ciclo.

### ¿Qué redes son compatibles?

Testnet (`https://soroban-testnet.stellar.org`) y Mainnet (`https://mainnet.sorobanrpc.com`). También puedes apuntar Sorokeep a cualquier endpoint RPC personalizado con `--rpc-url`.

### ¿Qué pasa con las alertas de correo electrónico?

El correo electrónico aún no se ha implementado. La CLI rechazará `--type email` con un mensaje de error claro. Los canales soportados hoy en día son Webhook y Slack.

## Hoja de Ruta

Haz un seguimiento del progreso general en el [tablero de la hoja de ruta de Sorokeep](https://github.com/AbdulmalikAlayande/sorokeep/projects) — las incidencias están agrupadas por fase (`phase-1` hasta `phase-15`) con estados como Por Hacer / En Progreso / Hecho.

> **Nota:** El tablero está configurado mediante una propuesta en [`docs/roadmap-board-proposal.md`](docs/roadmap-board-proposal.md).
> Si eres un mantenedor, sigue ese documento para crear y vincular el tablero.

- Interfaz de plugins para canales de alertas — para que un nuevo canal (Matrix, MS Teams, email) no requiera tocar el código de despacho principal ni el esquema de BD
- Endpoint `/metrics` de Prometheus para equipos que ya cuenten con herramientas de observabilidad
- GitHub Action reutilizable envolviendo `sorokeep check` para verificaciones de TTL integradas en CI
- Panel web para monitoreo visual del TTL
- Operaciones en lote para múltiples contratos

## Contribución

Las contribuciones son bienvenidas. Consulta [CONTRIBUTING.md](CONTRIBUTING.md) para pautas, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para saber cómo funciona el sistema en tiempo de ejecución y [SECURITY.md](SECURITY.md) para informar sobre vulnerabilidades. Este proyecto sigue un [Código de Conducta](CODE_OF_CONDUCT.md).

## Licencia

[MIT](LICENSE)

## Autor

**Abdulmalik Alayande**

- GitHub: [@AbdulmalikAlayande](https://github.com/AbdulmalikAlayande)
- X: [@The_good_man02](https://twitter.com/The_good_man02)
