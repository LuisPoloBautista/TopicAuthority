# topicIA

Asistente de indización para Koha: genera un encabezamiento con hasta dos subdivisiones desde MARC, o cinco propuestas temáticas desde un PDF, busca encabezamientos usados anteriormente y permite revisar autoridades externas.

## Flujo

```text
Espacio MARC: 650$a con información -> conservarlo + hasta 2 subdivisiones en total
Espacio MARC: 650$a vacío -> 1 encabezamiento + hasta 2 subdivisiones
Espacio PDF: 5 temas independientes del 650$a, hasta 2 subdivisiones por tema
  -> comprobar historial local, advertir coincidencias e importar una forma usada
  -> consultar automáticamente UNESCO, Wikidata y LCSH, sin tokens de IA
  -> transferir a Koha -> guardar registro -> verificar MARCXML -> contabilizar uso
```

## Integracion con Koha

El integrador actualizado está incluido en este repositorio: [`docs/topic-authority-koha-integration.js`](docs/topic-authority-koha-integration.js). Reemplaza la versión anterior de TopicAuthority en `IntranetUserJS`, después del integrador principal de MARC21. No pegues ambas versiones. Ajusta `AUTHORITY_ORIGIN` al origen del servidor si es diferente del configurado.

Los botones de los campos 650 repetidos usan un único manejador de clics en el documento, que resuelve el campo desde el botón pulsado. Esto permite usar botones clonados por Koha sin depender de sus eventos originales ni de identificadores DOM únicos.

El botón **Ampliar ventana / Restaurar tamaño** está en la cabecera del modal de Koha. La app recibe `existingMain`, `existingTerm`, `targetId` y `marcText` por `postMessage`. Consulta automáticamente los catálogos al abrir un 650 con texto y para cada propuesta generada; la generación de IA sigue requiriendo un clic. Comprueba el historial al mostrar propuestas de IA y nuevamente antes de transferirlas. El manejador de botones usa captura para evitar interferencias de eventos clonados; las importaciones incluyen el identificador del campo destino y se rechazan si ya cambió. Actualiza tanto la app como el integrador de IntranetUserJS.

Las propuestas nuevas usan indicador 2 = `4` (fuente no especificada), sin URI ni código de autoridad inventados. Las subdivisiones se transfieren a sus subcampos, conservando el orden y las repeticiones. Si falta un subcampo o una ocurrencia en el framework, la transferencia se detiene antes de modificar el formulario y avisa cuál agregar.

La selección no cuenta como uso. El integrador conserva provisionalmente la selección en la pestaña, detecta el envío del formulario y, al llegar a `detail.pl`, `MARCdetail.pl` o `additem.pl`, consulta el MARCXML guardado mediante `catalogue/export.pl?format=marcxml&op=export&bib=ID`. El parámetro `op=export` es obligatorio. Si falla la exportación o devuelve HTML, intenta `GET /api/v1/biblios/ID` con `Accept: application/marcxml+xml` y la sesión del staff. Ambas vías son de solo lectura; ninguna confirma usos si no devuelve un MARCXML válido. Solo sincroniza encabezamientos presentes en ese MARC. Un guardado repetido del mismo registro no suma usos; retirar un encabezamiento y guardar actualiza su contador. El contador representa **registros distintos que usan el encabezamiento**, no clics ni consultas. Los registros ajenos a este flujo y las eliminaciones completas desde otras pantallas no se sincronizan automáticamente.

Si ambas vías de lectura fallan, se conservan los datos pendientes y aparece un aviso con el estado HTTP o error de cada vía, más **Reintentar sincronización**. También se informa si falla el servidor de historial. Este aviso se refiere a la sincronización del historial, no al resultado del guardado bibliográfico de Koha. Los datos pendientes caducan a los 30 minutos y no se contabilizan al cancelar la edición. Koha necesita permitir la exportación MARCXML al usuario del staff. El flujo completo debe comprobarse en la instalación de Koha antes de ponerlo en producción.

## Historial de encabezamientos

`heading-store.js` administra el historial compartido. Se persiste como datos JSON en `data/used-headings.json`, sin ejecutar contenido introducido por usuarios. El botón «Buscar en el historial» consulta exclusivamente este JSON; no llama a IA, Python ni catálogos externos. Se retiraron la descarga JS y su endpoint.

La búsqueda normaliza mayúsculas, acentos, espacios y puntuación final para recuperar formas usadas, conservando su escritura original. Las subdivisiones y sus códigos forman parte de la identidad del encabezamiento. Se muestran coincidencias exactas, variantes del mismo encabezamiento principal y términos similares mediante pares de caracteres y palabras principales compartidas (umbral 72%). Para comparar palabras se omiten artículos, preposiciones y calificativos entre paréntesis, y se requieren al menos dos palabras significativas compartidas. Por ejemplo, «Modelos de lenguaje (Ciencia de la computación)» recupera «Modelos grandes de lenguaje» como similar, sin fusionar los encabezamientos ni declararlos equivalentes exactos. El porcentaje es similitud textual, no validación bibliográfica. El índice normalizado se mantiene en memoria y se reconstruye cuando cambia el JSON, incluidos los cambios hechos fuera de la app; cada búsqueda necesita una sola petición. Las peticiones idénticas simultáneas se comparten. El historial local no equivale a una autoridad validada por una institución externa.

Las coincidencias aparecen en una tabla con encabezamiento, tipo de coincidencia, número de registros, biblionumber y acción de importar. Los resultados no incluyen sugerencias de búsqueda manual; los enlaces a catálogos permanecen en el área general de búsqueda.

El JSON conserva `recordInfo`, con origen de Koha y biblionumber, asociado a los registros de uso. Los identificadores enlazan al detalle bibliográfico del catálogo correspondiente. Los datos antiguos solo guardaban un hash irreversible del identificador: se mantienen sus contadores y se indica que falta el biblionumber, sin inventarlo. Al volver a guardar y sincronizar un registro anterior se completa su referencia sin duplicar usos. La eliminación de un encabezamiento del registro actualiza también sus enlaces.

Configura `HEADING_STORE_PATH` en un **disco persistente**, por ejemplo `/var/data/topic-authority/used-headings.json`, para conservarlo al desplegar de nuevo. El `render.yaml` existente usa un plan gratuito sin disco persistente: el almacenamiento local de ese despliegue no garantiza conservar el historial. Ejecuta una sola instancia Node con este almacenamiento; para varias instancias hace falta una base de datos compartida. Respalda el JSON para conservar también la contabilidad por registro.

`GET /api/authorities?source=UNESCO&q=Botánica` consulta los catálogos públicos desde Node mediante `authority-catalogs.js`, sin Python ni OpenAI. Usa la [API REST de UNESCO](https://vocabularies.unesco.org/api), la [API de Wikidata](https://www.mediawiki.org/wiki/Wikibase/API) y la autosugerencia de materias LCSH. Cada tarjeta consulta las tres fuentes en paralelo y muestra cada respuesta al llegar. Hay un presupuesto total de 4.5 segundos por fuente, caché de diez minutos (máximo 300 consultas) y reutilización de solicitudes simultáneas. Los errores permiten reintentar manualmente y no se presentan como ausencia de resultados.

Se busca el encabezamiento principal; si no hay resultados se prueba su primera palabra significativa (por ejemplo, «Botánica sistemática» → «Botánica»). Se aprovechan las variantes que devuelven los catálogos, sin traducción ni inferencias de IA. LCSH usa principalmente inglés. Las coincidencias relacionadas requieren revisión. «Usar este término» reemplaza el 650 seleccionado, limpia subdivisiones anteriores y transfiere URI a $0, código a $2 e indicador según la fuente; el framework debe incluir esos subcampos. Los encabezamientos compuestos LCSH con `--` se muestran para revisión, sin importación automática porque su texto no identifica los códigos de subdivisión. Se conservan enlaces manuales en cada tarjeta.

El módulo Python independiente (ya no conectado a la app) no usa embeddings, bases vectoriales ni entrenamiento. BNE se compara localmente con RapidFuzz a partir de los archivos descargados del Catalogo de autoridades de BNE Lab: https://bnelab.bne.es/dato/catalogo-de-autoridades/. Las demas equivalencias se obtienen mediante consultas directas a fuentes externas.

## Modulo de autoridades

El modulo independiente esta en `authority_search/`:

```text
authority_search/
  bne.py
  viaf.py
  wikidata.py
  dbpedia.py
  unesco.py
  lcsh.py
  authority_manager.py
```

Cada archivo expone una funcion `search_<fuente>(term)`. El manager unifica resultados:

```bash
python3 -m authority_search.authority_manager "Botanica mexicana del siglo XVIII"
```

## Fuentes del módulo Python independiente

Estas implementaciones se utilizan al ejecutar el módulo Python por separado. La app utiliza su propio cliente Node para UNESCO, Wikidata y LCSH, además del historial JSON local.

- VIAF: autosugerencia de autoridades `https://www.viaf.org/viaf/AutoSuggest`
- Wikidata: API `wbsearchentities`
- BNE: comparacion local con RapidFuzz sobre `doc_bne/`, con datos tomados de BNE Lab
- DBpedia: DBpedia Lookup API
- UNESCO: consulta SPARQL a `https://vocabularies.unesco.org/sparql`
- EuroVoc: tesauro multilingue oficial de la Union Europea mediante su endpoint SPARQL
- LCSH: endpoint `id.loc.gov/authorities/subjects/suggest`

Cada fuente puede fallar sin detener el flujo completo; el servidor registra el error y devuelve las fuentes que si respondieron.

## API

Generar temas:

```http
POST /api/topics
Content-Type: application/json

{
  "mode": "pdf",
  "text": "Contenido del documento..."
}
```

Respuesta:

```json
{
  "result": "Educación -- México\n...",
  "topics": ["Educación -- México", "..."],
  "headings": [{"main": "Educación", "subdivisions": [{"code": "z", "value": "México"}], "label": "Educación -- México"}]
}
```

El ejemplo PDF está abreviado: `mode: "pdf"` devuelve cinco propuestas y omite `existingMain`, aunque se envíe. `mode: "marc"` devuelve un único encabezamiento con hasta dos subdivisiones en total; envía `existingMain` para conservar el 650$a. Si está vacío, se sugiere un encabezamiento nuevo. Las cinco propuestas son exclusivas del PDF. Por compatibilidad, omitir `mode` elige MARC si existe `existingMain`, o PDF en caso contrario. Si el modelo incumple la estructura, la app muestra un error para reintentar; no inventa propuestas para completar el cupo.

Las generaciones idénticas se reutilizan durante cinco minutos (hasta 30 entradas en memoria), incluyendo solicitudes simultáneas. MARC solicita una respuesta más pequeña que PDF. La primera generación sigue dependiendo del tiempo de respuesta del proveedor; estas optimizaciones no eliminan latencia de red ni arranque del alojamiento.

Historial: `GET /api/headings?q=Educación` devuelve `{ "headings": [...] }`. Tras verificar el registro guardado, el integrador envía `POST /api/heading-usage` con `{ "confirmed": true, "recordId": "https://koha.example:123", "headings": [...] }`. Es una instantánea de los encabezamientos locales presentes en ese registro; los reintentos son idempotentes. Este endpoint confía en el integrador del staff, no autentica por sí solo una sesión Koha: restringe el acceso de red al servicio y configura `ALLOWED_ORIGINS` para los orígenes del staff (CORS no sustituye autenticación).

## Variables de entorno

| Variable | Valor por defecto | Descripcion |
|---|---|---|
| `OPENAI_API_KEY` | requerido | Clave secreta de OpenAI. No se debe subir a GitHub. |
| `OPENAI_MODEL` | `gpt-5.5` | Modelo usado para generar temas. |
| `OPENAI_TIMEOUT_MS` | `120000` | Timeout de OpenAI. |
| `PORT` | `3000` | Puerto del servidor. |
| `AUTHORITY_SOURCES` | `lcsh,bne,unesco,eurovoc,wikidata,viaf,dbpedia` | Fuentes habilitadas, priorizando LC y vocabularios multilingues en espanol. |
| `AUTHORITY_TIMEOUT_SECONDS` | `5` | Timeout por consulta externa. |
| `AUTHORITY_MAX_RESULTS` | `3` | Resultados maximos por fuente. |
| `AUTHORITY_LANGUAGE` | `es` | Idioma preferente en fuentes que lo soportan. |
| `AUTHORITY_EXPAND_WITH_WIKIDATA` | `true` | Usa etiquetas y alias de Wikidata como variantes de consulta para LCSH, DBpedia y UNESCO. |
| `AUTHORITY_QUERY_VARIANTS` | `4` | Maximo de variantes de Wikidata agregadas a la consulta. |
| `AUTHORITY_INCLUDE_GEOGRAPHIC` | `false` | Si es `true`, tambien busca subdivisiones geograficas como Mexico. Por defecto se omiten para que no opaquen el encabezamiento principal. |
| `VIAF_INCLUDE_RELATED` | `false` | Si es `true`, muestra coincidencias VIAF relacionadas aunque no sean parciales/exactas. Por defecto se ocultan para evitar ruido en materias. |
| `VIAF_INCLUDE_PARTIAL` | `false` | Si es `true`, muestra coincidencias parciales de VIAF. Por defecto se ocultan porque suelen ser ruido para materias. |
| `DBPEDIA_ENABLE_SPARQL` | `false` | Si es `true`, intenta SPARQL en DBpedia. Por defecto se usa lookup/candidatos controlados para evitar timeouts. |
| `DBPEDIA_LOOKUP_TIMEOUT_SECONDS` | `4` | Timeout del lookup de DBpedia. |
| `BNE_LOCAL_DIR` | `doc_bne` | Directorio con JSON/NT locales de encabezamientos y subencabezamientos BNE. |
| `BNE_INDEX_CACHE` | `doc_bne/bne_authority_index.pkl.gz` | Indice compacto BNE comprimido. Permite desplegar sin subir los archivos BNE gigantes. |
| `BNE_LOCAL_SCORE_CUTOFF` | `74` | Puntaje minimo de RapidFuzz para aceptar una coincidencia BNE local. |
| `BNE_INCLUDE_NT` | `false` | Si es `true`, tambien carga `materias.nt`. Por defecto se omite para mejorar tiempo de respuesta en Render. |
| `ALLOWED_ORIGINS` | `*` | Origenes permitidos para CORS. |
| `HEADING_STORE_PATH` | `data/used-headings.json` | Archivo de historial; requiere disco persistente y una sola instancia Node. |

## Instalacion local

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m authority_search.bne --build-index
export OPENAI_API_KEY="tu_clave"
npm start
```

Los archivos `doc_bne/materia-JSON.json` y `doc_bne/materias.nt` superan el limite de GitHub y estan ignorados. El despliegue usa `doc_bne/bne_authority_index.pkl.gz`, generado localmente desde esos datos.

Abre `http://localhost:3000`.

## Pruebas

```bash
python3 -m unittest discover -s tests
npm test
node --check server.js
node --check script.js
node --check docs/topic-authority-koha-integration.js
```

## Despliegue en Render

Este repositorio incluye `render.yaml`.

1. Sube el repositorio a GitHub.
2. En Render crea un **Web Service** o **Blueprint**.
3. Usa:
   - Build Command: `npm install && python3 -m pip install --user --break-system-packages -r requirements.txt`
   - Start Command: `npm start`
   - Runtime/Language: `Node`
4. Configura variables de entorno:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
   - `PYTHON_BIN=python3`
   - `AUTHORITY_SOURCES=lcsh,bne,unesco,eurovoc,wikidata,viaf,dbpedia`
5. Deploy.

## Seguridad

- No pongas `OPENAI_API_KEY` en `index.html`, `script.js` ni commits.
- `.env` esta ignorado por Git y solo debe usarse localmente.
- La app consulta UNESCO, Wikidata y LCSH sin tokens de IA; conserva enlaces manuales para revisar los resultados.
