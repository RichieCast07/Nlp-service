# ExploraChiapas — NLP Service (Capa 1)

Microservicio que recibe texto libre de un turista en espanol y devuelve los parametros
de viaje estructurados (destino, interes, comida, personas, presupuesto, tiempo) usando
la API de Groq con salida JSON forzada. Este servicio no decide recomendaciones: solo
interpreta lenguaje natural. La Capa 2 (motor ML con K-Means/Apriori/knapsack) consume
esta salida para filtrar datos reales.

## Setup

```bash
npm install
cp .env.example .env
# edita .env y agrega tu GROQ_API_KEY (gratis en https://console.groq.com/keys)
npm run dev
```

## Endpoints

### `POST /extract`

Request:
```json
{ "texto": "Quiero ir a Suchiapa, conocer un lugar y comer carne asada, somos 2 personas, presupuesto de $500, tengo medio dia." }
```

Response:
```json
{
  "parametros": {
    "destino": "Suchiapa",
    "interes": "gastronomia",
    "comida": "carne asada",
    "personas": 2,
    "presupuesto": 500,
    "tiempo": "medio dia"
  }
}
```

### `GET /health`

Devuelve `{ "status": "ok" }`.

## Coleccion de pruebas (Postman)

En `postman/` hay una coleccion (`ExploraChiapas-NLP.postman_collection.json`) y un
environment (`ExploraChiapas-NLP.postman_environment.json`) listos para importar en
Postman. Cubren: health check, extraccion con todos los campos, extraccion con campos
ausentes (verifica que no se inventen datos), clasificacion de categorias (aventura),
y dos casos de error de validacion (texto vacio / campo faltante) que deben responder 400.

Para correrla por linea de comandos (con el servidor levantado en otra terminal con
`npm run dev`):

```bash
npx newman run postman/ExploraChiapas-NLP.postman_collection.json -e postman/ExploraChiapas-NLP.postman_environment.json
```

Resultado esperado: 6 requests, 18 assertions, 0 failed.

## Notas

- `interes` siempre se normaliza a una de las categorias fijas en `src/schema.ts`
  (`CATEGORIAS_INTERES`), para que la Capa 2 pueda filtrar contra el catalogo real.
- Si el modelo devuelve un JSON que no cumple el esquema, el endpoint responde `502`
  en vez de pasar datos inconsistentes a la Capa 2.
