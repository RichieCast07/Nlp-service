import Groq from "groq-sdk";
import { CATEGORIAS_INTERES, ParametrosViajeSchema, type ParametrosViaje } from "./schema.js";

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
