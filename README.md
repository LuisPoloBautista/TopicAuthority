# topicIA

Asistente de indizacion que recibe un PDF o texto, genera encabezamientos de materia con la API de OpenAI y consulta catalogos externos de autoridades para encontrar equivalencias directas.

## Flujo

```text
Documento o texto
  -> OpenAI genera temas
  -> authority_search consulta fuentes externas
  -> la interfaz muestra equivalencias por tema
```

No usa embeddings, bases vectoriales, entrenamiento, RDF local ni indexacion propia. Las equivalencias se obtienen mediante consultas directas a fuentes externas.

## Modulo de autoridades

El modulo independiente esta en `authority_search/`:

```text
authority_search/
  bne.py
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

- BNE: consulta SPARQL a `https://datos.bne.es/sparql`
- Wikidata: API `wbsearchentities`
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
| `AUTHORITY_SOURCES` | `bne,wikidata,dbpedia,unesco,lcsh` | Fuentes habilitadas. |
| `AUTHORITY_TIMEOUT_SECONDS` | `8` | Timeout por consulta externa. |
| `AUTHORITY_MAX_RESULTS` | `3` | Resultados maximos por fuente. |
| `AUTHORITY_LANGUAGE` | `es` | Idioma preferente en fuentes que lo soportan. |
| `AUTHORITY_INCLUDE_GEOGRAPHIC` | `false` | Si es `true`, tambien busca subdivisiones geograficas como Mexico. Por defecto se omiten para que no opaquen el encabezamiento principal. |
| `ALLOWED_ORIGINS` | `*` | Origenes permitidos para CORS. |

## Instalacion local

```bash
npm install
export OPENAI_API_KEY="tu_clave"
npm start
```

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
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Runtime/Language: `Node`
4. Configura variables de entorno:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
   - `PYTHON_BIN=python3`
   - `AUTHORITY_SOURCES=bne,wikidata,dbpedia,unesco,lcsh`
5. Deploy.

## Seguridad

- No pongas `OPENAI_API_KEY` en `index.html`, `script.js` ni commits.
- `.env` esta ignorado por Git y solo debe usarse localmente.
- Las consultas a autoridades se hacen desde el backend.
