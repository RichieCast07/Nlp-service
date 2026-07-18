import { RecomendacionSchema, type ParametrosViaje, type Recomendacion } from "./schema.js";

const ML_ENGINE_URL = process.env.ML_ENGINE_URL ?? "http://localhost:8001";

const REINTENTOS_MAX = 3;
const ESPERA_ENTRE_REINTENTOS_MS = 20_000;

export class MlEngineError extends Error {}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function llamarMlEngine(parametros: ParametrosViaje, signal: AbortSignal): Promise<Response> {
  return fetch(`${ML_ENGINE_URL}/recomendar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parametros),
    signal,
  });
}

export async function obtenerRecomendacion(parametros: ParametrosViaje): Promise<Recomendacion> {
  // Timeout total de 90s para cubrir cold start (50+ s) + procesamiento.
  // Render free tier devuelve 502 instantaneo mientras el servicio despierta,
  // por eso reintentamos hasta 3 veces con 20 s de espera entre intentos.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);

  let ultimoError: MlEngineError | null = null;

  try {
    for (let intento = 1; intento <= REINTENTOS_MAX; intento++) {
      let response: Response;
      try {
        response = await llamarMlEngine(parametros, controller.signal);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new MlEngineError(`Tiempo de espera agotado esperando al motor ML (${ML_ENGINE_URL})`);
        }
        throw new MlEngineError(`No se pudo conectar con el motor ML (Capa 2) en ${ML_ENGINE_URL}: ${(err as Error).message}`);
      }

      if (response.status === 502 || response.status === 503) {
        if (intento < REINTENTOS_MAX) {
          console.log(`[mlEngineClient] Motor ML respondio ${response.status}, reintento ${intento}/${REINTENTOS_MAX - 1} en ${ESPERA_ENTRE_REINTENTOS_MS / 1000}s...`);
          await esperar(ESPERA_ENTRE_REINTENTOS_MS);
          continue;
        }
        ultimoError = new MlEngineError(
          `El motor ML respondio ${response.status}: el servicio no esta disponible (el cold start tomo demasiado, intenta de nuevo en unos segundos)`
        );
        break;
      }

      if (!response.ok) {
        const detalle = await response.text();
        const resumen = detalle.trimStart().startsWith("<")
          ? "el servicio no esta disponible"
          : detalle.slice(0, 150);
        throw new MlEngineError(`El motor ML respondio ${response.status}: ${resumen}`);
      }

      const raw: unknown = await response.json();
      const result = RecomendacionSchema.safeParse(raw);
      if (!result.success) {
        throw new MlEngineError(`La respuesta del motor ML no cumple el esquema esperado: ${result.error.message}`);
      }
      return result.data;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  throw ultimoError ?? new MlEngineError("Error desconocido al contactar el motor ML");
}
