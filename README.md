# topicIA

Asistente de indizacion que recibe un PDF o texto, genera encabezamientos de materia con la API de OpenAI y compara autoridades BNE locales mas catalogos externos para encontrar equivalencias directas.

## Flujo

```text
Documento o texto
  -> OpenAI genera temas
  -> authority_search compara BNE local y consulta fuentes externas
  -> la interfaz muestra equivalencias por tema
```

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
  "result": "Botanica mexicana -- Siglo XVIII",
  "topics": ["Botanica mexicana -- Siglo XVIII"],
  "raw": "[\"Botanica mexicana -- Siglo XVIII\"]"
}
```

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
| `PYTHON_BIN` | `python3` | Ejecutable usado para llamar el modulo Python. |
| `AUTHORITY_SOURCES` | `viaf,wikidata,bne,dbpedia,unesco,lcsh` | Fuentes habilitadas. |
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
node --check server.js
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
   - `AUTHORITY_SOURCES=viaf,wikidata,bne,dbpedia,unesco,lcsh`
5. Deploy.

## Seguridad

- No pongas `OPENAI_API_KEY` en `index.html`, `script.js` ni commits.
- `.env` esta ignorado por Git y solo debe usarse localmente.
- Las consultas a autoridades se hacen desde el backend.
