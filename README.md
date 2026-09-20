# topicIA

Asistente de indización para Koha: genera cinco propuestas desde los campos MARC anteriores a 650 o desde un PDF, busca encabezamientos usados anteriormente y permite revisar autoridades externas.

## Flujo

```text
650$a vacío -> sugerir 5 encabezamientos desde MARC o PDF
650$a con información -> conservarlo y sugerir subdivisiones desde MARC o PDF
  -> máximo 2 subdivisiones por propuesta ($x, $y, $z, $v)
  -> comprobar historial local, advertir coincidencias e importar una forma usada
  -> consultar manualmente UNESCO, Wikidata o LCSH, o buscar desde la app
  -> transferir a Koha -> guardar registro -> verificar MARCXML -> contabilizar uso
```

## Integracion con Koha

El integrador actualizado está incluido en este repositorio: [`docs/topic-authority-koha-integration.js`](docs/topic-authority-koha-integration.js). Reemplaza la versión anterior de TopicAuthority en `IntranetUserJS`, después del integrador principal de MARC21. No pegues ambas versiones. Ajusta `AUTHORITY_ORIGIN` al origen del servidor si es diferente del configurado.

El botón **Ampliar ventana / Restaurar tamaño** está en la cabecera del modal de Koha. La app recibe `existingMain`, `existingTerm`, `targetId` y `marcText` por `postMessage`. No genera ni consulta catálogos externos automáticamente: el usuario elige la acción. Sí comprueba el historial al mostrar propuestas de IA y nuevamente antes de transferirlas, incluso si no se pulsó «Buscar».

Las propuestas nuevas usan indicador 2 = `4` (fuente no especificada), sin URI ni código de autoridad inventados. Las subdivisiones se transfieren a sus subcampos, conservando el orden y las repeticiones. Si falta un subcampo o una ocurrencia en el framework, la transferencia se detiene antes de modificar el formulario y avisa cuál agregar. Los resultados externos conservan el tratamiento de fuente de la versión anterior; el catalogador debe revisar su alcance antes de importarlos.

La selección no cuenta como uso. El integrador conserva provisionalmente la selección en la pestaña, detecta el envío del formulario y, al llegar a `detail.pl`, `MARCdetail.pl` o `additem.pl`, consulta el MARCXML guardado mediante `catalogue/export.pl`. Solo sincroniza encabezamientos presentes en ese MARC. Un guardado repetido del mismo registro no suma usos; retirar un encabezamiento y guardar actualiza su contador. El contador representa **registros distintos que usan el encabezamiento**, no clics ni consultas. Los registros ajenos a este flujo y las eliminaciones completas desde otras pantallas no se sincronizan automáticamente.

Si falla la verificación o el servidor de historial, aparece un aviso con **Reintentar sincronización**. Los datos pendientes caducan a los 30 minutos y no se contabilizan al cancelar la edición. Koha necesita permitir la exportación MARCXML al usuario del staff. El flujo completo debe comprobarse en la instalación de Koha antes de ponerlo en producción.

## Historial de encabezamientos

`heading-store.js` administra el historial compartido. Se persiste como datos JSON en `data/used-headings.json`, sin ejecutar contenido introducido por usuarios. La app ofrece **Descargar historial de uso (.js)**: `/api/used-headings.js` entrega un módulo JavaScript `export default [...]` con encabezamientos, subdivisiones, fecha y contador. No incluye identificadores internos de registros.

La búsqueda normaliza mayúsculas, acentos, espacios y puntuación final para recuperar formas usadas, conservando su escritura original. Las subdivisiones y sus códigos forman parte de la identidad del encabezamiento. Si no hay coincidencia completa se muestran variantes del mismo encabezamiento principal. El historial local no equivale a una autoridad validada por una institución externa.

Configura `HEADING_STORE_PATH` en un **disco persistente**, por ejemplo `/var/data/topic-authority/used-headings.json`, para conservarlo al desplegar de nuevo. El `render.yaml` existente usa un plan gratuito sin disco persistente: el almacenamiento local de ese despliegue no garantiza conservar el historial. Ejecuta una sola instancia Node con este almacenamiento; para varias instancias hace falta una base de datos compartida. Respalda el JSON para conservar también la contabilidad por registro; la descarga JS contiene únicamente las entradas públicas.

Las búsquedas manuales abren el término codificado en [UNESCO](https://vocabularies.unesco.org/unesco/es/search), [Wikidata](https://www.wikidata.org/wiki/Special:Search) y [LCSH](https://id.loc.gov/search/). La consulta dentro de la app reutiliza los conectores HTTP existentes; no se agregó un cliente Z39.50.

No usa embeddings, bases vectoriales ni entrenamiento. BNE se compara localmente con RapidFuzz a partir de los archivos descargados del Catalogo de autoridades de BNE Lab: https://bnelab.bne.es/dato/catalogo-de-autoridades/. Las demas equivalencias se obtienen mediante consultas directas a fuentes externas.

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

## Fuentes configuradas

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

El ejemplo de respuesta está abreviado: una respuesta satisfactoria tiene exactamente cinco propuestas y como máximo dos subdivisiones por propuesta. Envía `existingMain` junto a `text` para conservar el 650$a existente. Si el modelo incumple la estructura, la app muestra un error para reintentar; no inventa propuestas para completar el cupo.

Historial: `GET /api/headings?q=Educación` devuelve `{ "headings": [...] }`. Tras verificar el registro guardado, el integrador envía `POST /api/heading-usage` con `{ "confirmed": true, "recordId": "https://koha.example:123", "headings": [...] }`. Es una instantánea de los encabezamientos locales presentes en ese registro; los reintentos son idempotentes. Este endpoint confía en el integrador del staff, no autentica por sí solo una sesión Koha: restringe el acceso de red al servicio y configura `ALLOWED_ORIGINS` para los orígenes del staff (CORS no sustituye autenticación).

Buscar autoridades:

```http
GET /topics/Botanica%20mexicana%20del%20siglo%20XVIII/authorities
```

Respuesta:

```json
{
  "topic": "Botanica mexicana del siglo XVIII",
  "authorities": [
    {
      "source": "Wikidata",
      "label": "botanica",
      "url": "https://www.wikidata.org/wiki/Q441",
      "type": "Entidad relacionada"
    }
  ]
}
```

Tambien existe el alias:

```http
GET /api/topics/{topic}/authorities
```

## Variables de entorno

| Variable | Valor por defecto | Descripcion |
|---|---|---|
| `OPENAI_API_KEY` | requerido | Clave secreta de OpenAI. No se debe subir a GitHub. |
| `OPENAI_MODEL` | `gpt-5.5` | Modelo usado para generar temas. |
| `OPENAI_TIMEOUT_MS` | `120000` | Timeout de OpenAI. |
| `PORT` | `3000` | Puerto del servidor. |
| `PYTHON_BIN` | `.venv` local, si existe; de lo contrario `python` en Windows o `python3` | Ejecutable usado para llamar el modulo Python. |
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
- Las consultas a autoridades se hacen desde el backend.
