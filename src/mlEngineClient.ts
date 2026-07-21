import { RecomendacionSchema, type ParametrosViaje, type Recomendacion } from "./schema.js";

const ML_ENGINE_URL = process.env.ML_ENGINE_URL ?? "http://localhost:8001";

const TIMEOUT_POR_INTENTO_MS = 50_000;
const REINTENTOS_MAX = 2;
const ESPERA_ENTRE_REINTENTOS_MS = 3_000;

export class MlEngineError extends Error {}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function llamarMlEngine(parametros: ParametrosViaje): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_POR_INTENTO_MS);
  try {
    return await fetch(`${ML_ENGINE_URL}/recomendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parametros),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new MlEngineError(
        `Tiempo de espera agotado esperando al motor ML (${ML_ENGINE_URL})`
      );
    }
    throw new MlEngineError(
      `No se pudo conectar con el motor ML (Capa 2) en ${ML_ENGINE_URL}: ${(err as Error).message}`
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function warmupMlEngine(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    await fetch(`${ML_ENGINE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
  } catch {
    // silencioso — es solo un ping de calentamiento
  }
}

export async function obtenerRecomendacion(parametros: ParametrosViaje): Promise<Recomendacion> {
  let ultimoError: MlEngineError | null = null;

  for (let intento = 1; intento <= REINTENTOS_MAX; intento++) {
    let response: Response;
    try {
      response = await llamarMlEngine(parametros);
    } catch (err) {
      ultimoError = err as MlEngineError;
      if (intento < REINTENTOS_MAX) {
        console.log(
          `[mlEngineClient] Error en intento ${intento}/${REINTENTOS_MAX}, reintentando en ${ESPERA_ENTRE_REINTENTOS_MS / 1000}s...`
        );
        await esperar(ESPERA_ENTRE_REINTENTOS_MS);
        continue;
      }
      break;
    }

    if (response.status === 502 || response.status === 503) {
      ultimoError = new MlEngineError(
        `El motor ML respondio ${response.status}: el servicio no esta disponible`
      );
      if (intento < REINTENTOS_MAX) {
        console.log(
          `[mlEngineClient] Motor ML respondio ${response.status}, reintento ${intento}/${REINTENTOS_MAX} en ${ESPERA_ENTRE_REINTENTOS_MS / 1000}s...`
        );
        await esperar(ESPERA_ENTRE_REINTENTOS_MS);
        continue;
      }
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
      throw new MlEngineError(
        `La respuesta del motor ML no cumple el esquema esperado: ${result.error.message}`
      );
    }
    return result.data;
  }

  throw ultimoError ?? new MlEngineError("Error desconocido al contactar el motor ML");
}
