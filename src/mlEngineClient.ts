import { RecomendacionSchema, type ParametrosViaje, type Recomendacion } from "./schema.js";

const ML_ENGINE_URL = process.env.ML_ENGINE_URL ?? "http://localhost:8001";

export class MlEngineError extends Error {}

export async function obtenerRecomendacion(parametros: ParametrosViaje): Promise<Recomendacion> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(`${ML_ENGINE_URL}/recomendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parametros),
      signal: controller.signal,
    });
  } catch (err) {
    const msg = (err as Error).name === "AbortError"
      ? `Tiempo de espera agotado esperando al motor ML (${ML_ENGINE_URL})`
      : `No se pudo conectar con el motor ML (Capa 2) en ${ML_ENGINE_URL}: ${(err as Error).message}`;
    throw new MlEngineError(msg);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const detalle = await response.text();
    // Render devuelve paginas HTML completas en errores 502/503 (cold start, caida).
    // No las propagamos al cliente — solo el codigo y un mensaje corto.
    const resumen = detalle.trimStart().startsWith("<")
      ? "el servicio no esta disponible (posible cold start, espera unos segundos e intenta de nuevo)"
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
