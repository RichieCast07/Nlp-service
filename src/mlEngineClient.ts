import { RecomendacionSchema, type ParametrosViaje, type Recomendacion } from "./schema.js";

const ML_ENGINE_URL = process.env.ML_ENGINE_URL ?? "http://localhost:8001";

export class MlEngineError extends Error {}

export async function obtenerRecomendacion(parametros: ParametrosViaje): Promise<Recomendacion> {
  let response: Response;
  try {
    response = await fetch(`${ML_ENGINE_URL}/recomendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parametros),
    });
  } catch (err) {
    throw new MlEngineError(
      `No se pudo conectar con el motor ML (Capa 2) en ${ML_ENGINE_URL}: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    const detalle = await response.text();
    throw new MlEngineError(`El motor ML respondio ${response.status}: ${detalle}`);
  }

  const raw: unknown = await response.json();
  const result = RecomendacionSchema.safeParse(raw);
  if (!result.success) {
    throw new MlEngineError(`La respuesta del motor ML no cumple el esquema esperado: ${result.error.message}`);
  }

  return result.data;
}
