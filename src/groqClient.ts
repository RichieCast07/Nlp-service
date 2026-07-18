import Groq from "groq-sdk";
import { CATEGORIAS_INTERES, ParametrosViajeSchema, type ParametrosViaje, type Recomendacion } from "./schema.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `Eres un extractor de parametros para ExploraChiapas, una plataforma de rutas turisticas.
Tu unica tarea es leer un mensaje de un turista en espanol (puede ser coloquial o mal escrito) y devolver
un objeto JSON con los parametros de su viaje. No inventes datos que no esten en el texto: si un campo no
se menciona, usa null. No agregues explicaciones ni texto fuera del JSON.

Campos a extraer:
- destino: lugar, municipio o region mencionada (string o null).
- interes: clasifica el interes principal en EXACTAMENTE una de estas categorias: ${CATEGORIAS_INTERES.join(", ")}. null si no aplica.
- comida: tipo de comida o plato mencionado (string o null).
- personas: numero entero de personas que viajan (number o null).
- presupuesto: presupuesto en pesos mexicanos, solo el numero (number o null).
- tiempo: duracion disponible tal como la expreso el usuario, ej. "medio dia", "2 dias" (string o null).

Responde SOLO con un JSON con exactamente estas 6 llaves: destino, interes, comida, personas, presupuesto, tiempo.`;

export class ExtractionError extends Error {}

export async function extraerParametros(texto: string): Promise<ParametrosViaje> {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: texto },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new ExtractionError("Groq no devolvio contenido en la respuesta");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new ExtractionError(`La respuesta del modelo no es JSON valido: ${raw}`);
  }

  const result = ParametrosViajeSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new ExtractionError(
      `La respuesta del modelo no cumple el esquema esperado: ${result.error.message}`,
    );
  }

  return result.data;
}

const REDACTOR_SYSTEM_PROMPT = `Eres el asistente conversacional de ExploraChiapas.
Recibiras un itinerario en JSON que ya fue calculado por el motor de recomendacion (clustering,
reglas de asociacion y optimizacion de presupuesto/tiempo). Esos datos son reales y verificados.

Reglas estrictas:
- NO inventes lugares, restaurantes, precios ni datos que no esten en el JSON recibido.
- Si el itinerario esta vacio, dilo con honestidad y sugiere ajustar presupuesto, tiempo o interes.
- Menciona el costo total y el tiempo total del itinerario.
- Tono amigable, breve (maximo 4-5 lineas), en espanol, dirigido directamente al turista.
- No menciones JSON, clusters, Apriori, K-Means ni detalles tecnicos: el usuario solo quiere su plan de viaje.`;

const SALUDO_SYSTEM_PROMPT = `Eres el asistente de ExploraChiapas, una app de turismo en Chiapas, Mexico.
El usuario escribio algo sin mencionar un viaje concreto. Responde de forma amigable en espanol, en maximo 2 lineas.
Invitalo a contarte a donde quiere ir, cuantas personas viajan, su presupuesto y tiempo disponible.
No menciones destinos especificos ni inventes datos.`;

export async function responderConversacional(texto: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0.7,
    messages: [
      { role: "system", content: SALUDO_SYSTEM_PROMPT },
      { role: "user", content: texto },
    ],
  });

  const mensaje = completion.choices[0]?.message?.content;
  if (!mensaje) {
    throw new ExtractionError("Groq no devolvio contenido");
  }
  return mensaje.trim();
}

export async function redactarRespuesta(
  recomendacion: Recomendacion,
  textoOriginal: string,
): Promise<string> {
  const resumen = {
    itinerario: recomendacion.itinerario.map((a) => ({
      nombre: a.nombre,
      tipo: a.tipo,
      municipio: a.municipio,
      costo_estimado: a.costo_estimado,
      costo_total_grupo: a.costo_total_grupo,
      tiempo_horas: a.tiempo_horas,
    })),
    costo_total: recomendacion.costo_total,
    tiempo_total_horas: recomendacion.tiempo_total_horas,
    presupuesto_disponible: recomendacion.presupuesto_disponible,
    reglas_asociacion_aplicadas: recomendacion.reglas_asociacion_aplicadas,
  };

  const completion = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    messages: [
      { role: "system", content: REDACTOR_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Mensaje original del turista: "${textoOriginal}"\n\nItinerario calculado (JSON real, no inventar nada fuera de esto):\n${JSON.stringify(resumen)}`,
      },
    ],
  });

  const mensaje = completion.choices[0]?.message?.content;
  if (!mensaje) {
    throw new ExtractionError("Groq no devolvio contenido al redactar la respuesta final");
  }

  // Si la respuesta contiene etiquetas HTML/SVG el modelo devolvio basura
  // (sobrecarga, alucinacion, o respuesta de error de la API en formato HTML).
  // Lo rechazamos para que Flutter muestre el mensaje de error amigable
  // en lugar del contenido crudo.
  if (/<[a-zA-Z][\s\S]*?>/.test(mensaje)) {
    console.error("[redactarRespuesta] Groq devolvio HTML/SVG en lugar de texto:", mensaje.slice(0, 300));
    throw new ExtractionError("El modelo devolvio HTML en lugar de texto; intenta de nuevo");
  }

  return mensaje.trim();
}
