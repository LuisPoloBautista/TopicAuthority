# topicIA: estimación de costos y propuesta comercial

Fecha: 22 de septiembre de 2026. Moneda: pesos mexicanos (MXN), salvo indicación de USD. Importes antes de impuestos. Propuesta preliminar para una biblioteca con una instalación Koha y hasta cinco catalogadores. Tipo de cambio presupuestario: 20 MXN/USD; es un supuesto de cálculo, no una cotización cambiaria. Horas, honorarios y reservas son estimaciones propias, no tarifas de mercado verificadas.

## 1. Evaluación de la aplicación

La aplicación implementa un asistente de indización bibliográfica: genera un encabezamiento MARC 650 con hasta dos subdivisiones o cinco propuestas desde un PDF con texto; conserva el encabezamiento principal existente; recupera encabezamientos del historial y los transfiere a Koha. Verifica el MARCXML guardado antes de contabilizar registros que usan cada encabezamiento. La revisión bibliográfica final corresponde al catalogador.

Arquitectura: interfaz HTML/CSS/JavaScript con PDF.js, servidor Node/Express, Responses API de OpenAI y almacenamiento JSON. El modelo predeterminado es gpt-5.5. El módulo Python de autoridades existe como componente independiente; la interfaz actual ofrece enlaces manuales a UNESCO, Wikidata y LCSH. No debe ofrecerse comercialmente como validación automática de autoridades externas.

Se revisaron README.md, server.js, script.js, heading-store.js, render.yaml y el integrador docs/topic-authority-koha-integration.js. Se ejecutaron correctamente 14 pruebas JavaScript y 11 Python. Estas pruebas no acreditan calidad bibliográfica del modelo, capacidad de concurrencia ni compatibilidad con una instalación real del cliente. No se realizaron generaciones de pago ni pruebas en Koha de producción.

Pendientes incluidos en la estimación de puesta en producción:

- Proteger el acceso al servicio y sus endpoints; CORS por sí solo no autentica usuarios. Definir con TI una solución compatible con el iframe de Koha.
- Configurar almacenamiento persistente, respaldos externos y probar restauración. La configuración actual solicita alojamiento gratuito sin disco persistente.
- Añadir límites de entrada, frecuencia y gasto; registrar consumo de tokens. El servidor actual no conserva el campo usage de OpenAI y la interfaz extrae todas las páginas del PDF.
- Validar transferencia, campos repetidos, cancelación, sincronización y errores en el Koha del cliente.
- Mantener una sola instancia de Node mientras el historial use JSON; una plataforma multiinstitucional requiere otro alcance.

## 2. Estimación interna de trabajo

Tarifa de cálculo: 650 MXN/hora. Es un supuesto de costo técnico para presupuestar; cada proveedor deberá sustituirlo por su costo real.

| Puesta en producción sobre el código existente | Horas | Importe MXN |
|---|---:|---:|
| Levantamiento y revisión del Koha del cliente | 6 | 3,900 |
| Protección de acceso y controles de consumo | 16 | 10,400 |
| Despliegue, persistencia, respaldos y restauración | 10 | 6,500 |
| Adaptación y validación de integración Koha | 14 | 9,100 |
| Piloto y ajustes de aceptación | 8 | 5,200 |
| Manuales, capacitación y entrega | 6 | 3,900 |
| Subtotal | 60 | 39,000 |
| Reserva de contingencia del 15% | | 5,850 |
| Costo técnico presupuestado | | 44,850 |

Precio comercial propuesto: **55,000 MXN**. Diferencia sobre costo presupuestado: 10,150 MXN, equivalente al 18.5% del precio, antes de gastos comerciales, administrativos e impuestos. El alcance supone acceso remoto oportuno, una integración sin modificaciones profundas de Koha y un entorno de pruebas disponible.

Como referencia separada, reconstruir una aplicación de alcance comparable desde cero se estima en 180–260 horas: 117,000–169,000 MXN, o **134,550–194,350 MXN** con 15% de contingencia. No es una valoración de venta del negocio ni un cargo adicional a la implementación. El trabajo ya realizado no se reconstruyó mediante un registro histórico de horas.

## 3. Costos de operación

La tarifa oficial consultada de GPT-5.5 es 5 USD por millón de tokens de entrada y 30 USD por millón de tokens de salida. Los ejemplos siguientes usan entradas inferiores a 272,000 tokens, sin descuentos por caché ni Batch. Fuente: [OpenAI, GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5).

Fórmula: costo USD = (tokens de entrada × 5 + tokens de salida facturables × 30) / 1,000,000.

| Generación | Entrada supuesta, incluido prompt | Salida presupuestada | USD por llamada | MXN por llamada |
|---|---:|---:|---:|---:|
| MARC | 2,000 tokens | 1,200 tokens | 0.046 | 0.92 |
| PDF | 12,000 tokens | 2,500 tokens | 0.135 | 2.70 |

Las salidas presupuestadas corresponden a los límites configurados en server.js; no son promedios medidos. Debe contabilizarse toda salida facturable, incluido razonamiento. El tamaño de entrada supuesto para PDF no es un límite actual. Un PDF extenso, reintentos o cambios de modelo alteran el costo. Cada llamada PDF produce cinco propuestas: no se cobra cinco veces por ello. Buscar en el historial no llama a OpenAI.

Escenario: 80% de llamadas MARC y 20% PDF. Costo ponderado: 1.276 MXN por llamada. Se agrega 20% de reserva para variación/reintentos: 1.5312 MXN por llamada prevista. Esta reserva no garantiza cubrir documentos arbitrariamente grandes.

| Llamadas de generación al mes | IA calculada, con reserva | Infraestructura presupuestada | Costo técnico mensual aproximado |
|---|---:|---:|---:|
| 1,000 | 1,531 | 500 | 2,031 |
| 3,000 | 4,594 | 500 | 5,094 |
| 5,000 | 7,656 | 500 | 8,156 |

Los 500 MXN mensuales son una provisión propia para cómputo, almacenamiento persistente y respaldo externo de una instalación pequeña; no una tarifa confirmada de Render. Se sustituirá por una cotización del proveedor antes de contratar. Revisar [precios de Render](https://render.com/pricing) y [requisitos de discos persistentes](https://render.com/docs/disks). No incluye servidor Koha, dominio nuevo, planes de equipo, impuestos del proveedor ni soporte humano. Esta tabla no acredita que una instancia soporte cualquiera de los volúmenes o picos concurrentes; se validará en el piloto.

## 4. Propuesta comercial para presentar al cliente

**Objeto:** implementar topicIA como asistente de indización integrado en Koha, con paquetes de tokens para obtener cinco propuestas temáticas por PDF y un encabezamiento con hasta dos subdivisiones por generación MARC, bajo revisión del catalogador.

**Esta sección contiene la oferta comercial actualizada y sustituye los precios comerciales y condiciones recurrentes anteriores del documento.** Las demás secciones conservan la estimación original y no deben utilizarse como cotización vigente ni como cálculo actualizado del retorno.

### Implementación: pago único de 20,200 MXN

Incluye configuración para una biblioteca con una instalación Koha y hasta cinco catalogadores, integración MARC y PDF, protección de acceso, persistencia del historial, respaldos y prueba de restauración, piloto, manual breve y dos sesiones remotas de capacitación de una hora. La implementación se paga únicamente al contratar por primera vez; no se vuelve a cobrar en las renovaciones de la misma instalación.

### Límites por generación

| Modalidad | Máximo de entrada, incluido prompt y formato de mensajes | Máximo de salida | Resultado esperado |
|---|---:|---:|---|
| PDF con texto | 12,000 tokens | 2,500 tokens | Cinco propuestas temáticas por documento |
| MARC | 2,000 tokens | 1,200 tokens | Un encabezamiento con hasta dos subdivisiones |

La app verifica la entrada mediante el [conteo de tokens de OpenAI](https://developers.openai.com/api/docs/guides/token-counting). Si excede el límite, conserva automáticamente el inicio del contenido que cabe dentro del máximo de 2,000 tokens para MARC o 12,000 para PDF, incluidas las instrucciones y el formato de mensajes. Conserva las instrucciones y el encabezamiento MARC existente, y descarta el contenido final que no cabe, sin mostrar errores ni avisos por exceso. Las propuestas se basan únicamente en el fragmento conservado. El ajuste puede necesitar varios conteos de fragmentos distintos; no son reintentos de solicitudes fallidas. Después se realiza una sola solicitud de generación, sin reintentos automáticos ni llamadas para resumir o completar resultados. Si falla el servicio de conteo, no se solicita la generación y se informa del fallo técnico. El conteo inicial envía el texto completo a OpenAI; la generación recibe únicamente el fragmento ajustado.

Las salidas son máximos, no consumos fijos. Una generación incompleta o fallida no se repite automáticamente. Volver a pulsar generar constituye una nueva solicitud y puede consumir tokens. Las respuestas reutilizadas desde la caché y las búsquedas en el historial no hacen una nueva generación.

### Paquetes de tokens

Los paquetes separan entrada y salida porque tienen distinto costo. La combinación de documentos indicada puede consumirse dentro del mismo paquete: PDF **más** MARC, no una modalidad u otra.

| Paquete | Tokens de entrada | Tokens de salida | Total de tokens | Capacidad de referencia combinada | Precio de la bolsa de IA MXN |
|---|---:|---:|---:|---|---:|
| Inicial | 300,000 | 86,000 | 386,000 | 20 PDF (100 propuestas temáticas) + 30 generaciones MARC | 200 |
| Biblioteca | 1,500,000 | 430,000 | 1,930,000 | 100 PDF (500 propuestas temáticas) + 150 generaciones MARC | 900 |
| Intensivo | 6,000,000 | 1,720,000 | 7,720,000 | 400 PDF (2,000 propuestas temáticas) + 600 generaciones MARC | 3,500 |

Cálculo del paquete Inicial al máximo por llamada:

- Entrada: 20 × 12,000 + 30 × 2,000 = **300,000 tokens**.
- Salida: 20 × 2,500 + 30 × 1,200 = **86,000 tokens**.
- Biblioteca equivale a cinco veces esa bolsa; Intensivo, a veinte veces.

Estas capacidades presuponen una generación por documento o registro, entradas dentro de los límites y respuestas válidas. No garantizan el número de resultados útiles: los intentos con consumo facturable pero sin resultado utilizable también utilizan saldo. Si el consumo real es menor, la bolsa permite más generaciones mientras quede saldo en ambas categorías. Las bolsas de entrada y salida no son intercambiables; la cifra total es informativa.

**Base del precio:** tarifa consultada de GPT-5.5 de 5 USD por millón de entrada y 30 USD por millón de salida, con tipo de cambio presupuestario de 20 MXN/USD. Costo de generación estimado de las bolsas completas: Inicial **81.60 MXN**, Biblioteca **408 MXN**, Intensivo **1,632 MXN**, sin descuentos. Fuente: [tarifa oficial GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5).

Los precios comerciales de IA son aproximadamente el doble del costo calculado, redondeados hacia arriba para cubrir administración y variaciones del proveedor o del tipo de cambio; no incluyen una reserva de generaciones de reintento automático. La fórmula corresponde a generación; cualquier cargo aplicable al conteo previo deberá verificarse con el proveedor antes de contratar. Los precios se confirman al contratar y pueden actualizarse en futuras renovaciones, con aviso previo.

### Soporte, alojamiento y precio total del paquete

| Concepto por vigencia de 30 días | Inicial | Biblioteca | Intensivo |
|---|---:|---:|---:|
| Bolsa de IA | 200 | 900 | 3,500 |
| Soporte remoto incluido | 850 (1 hora) | 1,700 (2 horas) | 2,550 (3 horas) |
| Alojamiento de la app y respaldos | 500 | 500 | 500 |
| **Precio del paquete / renovación MXN** | **1,550** | **3,100** | **6,550** |
| Implementación, solo la primera vez | 20,200 | 20,200 | 20,200 |
| **Primera contratación MXN** | **21,750** | **23,300** | **26,750** |

Todos los importes son antes de impuestos. **Al renovar se paga únicamente el paquete elegido**, que ya incluye IA, soporte y alojamiento; no se añade nuevamente la implementación, la mensualidad anterior de 4,900 MXN ni un cargo separado de OpenAI por los tokens incluidos. La cuenta API de la prestación administrada la opera el proveedor del servicio, con identificación del consumo de esta instalación.

Ejemplo: contratar Inicial cuesta **21,750 MXN** la primera vez. Cada renovación de Inicial cuesta **1,550 MXN**. Doce periodos de Inicial más la implementación suman **38,800 MXN**, si no hay compras adicionales ni cambios de precio.

### Vigencia y renovación

Cada paquete tiene una vigencia de 30 días desde su activación. Los tokens y las horas de soporte no utilizados no se acumulan. La renovación es manual, al vencer el periodo o cuando el cliente requiera una nueva bolsa; no se realizan compras ni cargos automáticos. Una renovación anticipada inicia un nuevo periodo y reemplaza el saldo anterior, condición que se informará antes de la compra.

El servicio comercial deberá detener nuevas generaciones cuando no alcance el saldo de entrada contado o la reserva máxima de salida para la siguiente solicitud. La reserva se ajustará al consumo real informado por el proveedor; ante un timeout con consumo incierto se conciliará antes de liberar saldo. No se ofrecerá consumo ilimitado ni cargos por excedentes sin autorización.

**Estado de implementación del esquema comercial:** los límites por solicitud y la ausencia de reintentos ya están implementados. La gestión de paquetes, registro persistente de consumo, reserva de saldo, conciliación, vencimientos y bloqueo por saldo son entregables pendientes de la puesta en marcha comercial; estas tablas no implican que la app ya venda o controle paquetes. Su aceptación es requisito para activar la oferta prepago.

El alojamiento cubre una instancia de la app y respaldos diarios con retención de 30 días; no incluye servidor Koha, dominio nuevo ni infraestructura de alta disponibilidad. La provisión de 500 MXN debe validarse antes de contratar. Al vencer el paquete sin renovación, se suspende el servicio administrado; el historial y sus respaldos se conservan 30 días adicionales para renovación o entrega al cliente.

### Condiciones de servicio y entrega

Soporte de lunes a viernes de 09:00 a 18:00, hora de Ciudad de México, excepto festivos, con primera respuesta en un día hábil. Incluye asistencia de uso y ajustes menores dentro de las horas del paquete. No incluye cobertura 24/7, garantía de disponibilidad ni nuevas funcionalidades. Horas adicionales: **850 MXN/hora**, previa autorización. Los defectos atribuibles a la entrega se corrigen durante los primeros 30 días sin consumir la bolsa de soporte.

**Plazo estimado:** cuatro semanas desde la disponibilidad de accesos, entorno Koha de pruebas y muestras bibliográficas, sujeto a validar en el diagnóstico el alcance del control de paquetes y la integración del cliente. El precio de implementación es el propuesto de 20,200 MXN; cambios sustanciales de alcance se cotizan antes de ejecutarse.

**Aceptación:** validar generación MARC y PDF, conservación de 650$a, transferencia de subdivisiones y campos repetidos, historial tras guardado sin doble conteo, restauración de respaldo, recorte automático y silencioso de entradas superiores a 2,000/12,000 tokens, conservando las instrucciones y el encabezamiento MARC y ausencia de reintentos automáticos. Antes de activar los paquetes, probar también consumo real por categoría, reserva concurrente de saldo, vencimiento y bloqueo sin saldo. El piloto utiliza 30 registros MARC y 10 PDF con texto; su consumo lo asume el proveedor dentro de la implementación y no descuenta el primer paquete. La revisión de pertinencia corresponde al bibliotecario designado.

**Pagos de implementación:** 50% al inicio (**10,100 MXN**), 30% al entregar el piloto (**6,060 MXN**) y 20% contra aceptación (**4,040 MXN**). El primer paquete se paga al activar el servicio, adicional a la implementación. Oferta preliminar con vigencia de 30 días.

**Responsabilidades del cliente:** aportar Koha de pruebas, permisos para IntranetUserJS y exportación MARCXML, responsable de TI, bibliotecario validador y documentos autorizados para procesamiento externo. El texto se envía a OpenAI para conteo y generación, conforme a las políticas de la institución.

**Fuera de alcance:** OCR, catalogación masiva retrospectiva, validación automática contra autoridades externas, nuevas funciones Python, SaaS multiinstitucional, SSO complejo, migración de Koha y sincronización universal de eliminaciones. Se cotizan por separado.

El repositorio contiene LICENSE con Apache 2.0. Se cobra por implementación y prestación del servicio; la propuesta no presupone cesión exclusiva del código preexistente.

## 5. Justificación económica ilustrativa

Sin mediciones no se puede afirmar un ahorro real. Ejemplo para decidir un piloto: 1,000 registros/mes × 3 minutos netos ahorrados / 60 = 50 horas mensuales. A un costo laboral interno supuesto de 180 MXN/h, representan 9,000 MXN de capacidad liberada. Descontando 6,450 MXN/mes de servicio e IA, quedarían 2,550 MXN/mes; recuperación simple de la implementación: 55,000 / 2,550 = aproximadamente 21.6 meses.

Este ejemplo supone una llamada de generación por registro y un ahorro neto que ya descuenta revisión y correcciones. La capacidad liberada no equivale necesariamente a ahorro de caja. Si el piloto no confirma esos tiempos, volúmenes y costos laborales, debe recalcularse el retorno antes de justificar la compra.
