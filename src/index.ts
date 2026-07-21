import "dotenv/config";
import express, { type Request, type Response } from "express";
import { ExtractRequestSchema, PlanearRequestSchema } from "./schema.js";
import { extraerParametros, redactarRespuesta, responderConversacional, ExtractionError } from "./groqClient.js";
import { obtenerRecomendacion, warmupMlEngine, MlEngineError } from "./mlEngineClient.js";
import { calcularTiempos } from "./routeService.js";

if (!process.env.GROQ_API_KEY) {
  throw new Error("Falta GROQ_API_KEY en el entorno. Copia .env.example a .env y agrega tu clave.");
}

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Despierta el motor ML (Render free tier duerme tras 15 min).
// Llamar esto al abrir la pantalla de chat.
app.get("/warmup", async (_req: Request, res: Response) => {
  await warmupMlEngine();
  res.json({ status: "ok" });
});

app.post("/extract", async (req: Request, res: Response) => {
  const parsedBody = ExtractRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten() });
  }

  try {
    const parametros = await extraerParametros(parsedBody.data.texto);
    res.json({ parametros });
  } catch (err) {
    if (err instanceof ExtractionError) {
      return res.status(502).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno al extraer parametros" });
  }
});

// Reemplaza foto_principal en los bloques ```card``` del texto de GROQ
// usando la posicion del card (GROQ no recibe los IDs reales, los inventa).
function inyectarFotos(mensaje: string, fotos: Array<string | null>): string {
  let indice = 0;
  let reemplazos = 0;
  const resultado = mensaje.replace(/```card\s*([\s\S]*?)```/g, (match, jsonStr) => {
    const foto = fotos[indice] ?? null;
    indice++;
    try {
      const card = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
      card.foto_principal = foto;
      reemplazos++;
      return "```card\n" + JSON.stringify(card, null, 2) + "\n```";
    } catch {
      console.warn(`[inyectarFotos] JSON invalido en card ${indice}:`, jsonStr.slice(0, 100));
      return match;
    }
  });
  console.log(`[inyectarFotos] ${reemplazos} cards reemplazadas. Fotos: ${JSON.stringify(fotos)}`);
  return resultado;
}

app.post("/planear", async (req: Request, res: Response) => {
  const parsedBody = PlanearRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten() });
  }
  const { texto, historial = [], user_lat, user_lng } = parsedBody.data;

  try {
    const parametros = await extraerParametros(texto, historial);

    const sinIntento = Object.values(parametros).every((v) => v === null);
    if (sinIntento) {
      const mensaje = await responderConversacional(texto);
      return res.json({ mensaje });
    }

    const recomendacion = await obtenerRecomendacion(parametros);

    // Calcular tiempos de traslado desde la ubicación del usuario (si la tiene).
    let tiempos = null;
    if (user_lat != null && user_lng != null && recomendacion.itinerario.length > 0) {
      tiempos = await calcularTiempos(user_lat, user_lng, recomendacion.itinerario);
    }

    const mensaje = await redactarRespuesta(recomendacion, texto, historial, tiempos);

    // Inyectar foto_principal por posicion (GROQ inventa IDs, no son confiables)
    const fotosArray = recomendacion.itinerario.map(
      (a) => (a as { foto_principal?: string | null }).foto_principal ?? null
    );
    console.log(`[planear] itinerario: ${recomendacion.itinerario.length} items, fotos: ${JSON.stringify(fotosArray)}`);
    const mensajeConFotos = inyectarFotos(mensaje, fotosArray);

    res.json({ parametros, recomendacion, mensaje: mensajeConFotos });
  } catch (err) {
    if (err instanceof ExtractionError) {
      return res.status(502).json({ error: `Capa 1 (LLM): ${err.message}` });
    }
    if (err instanceof MlEngineError) {
      return res.status(502).json({ error: `Capa 2 (motor ML): ${err.message}` });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno al planear la ruta" });
  }
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`NLP service (Capa 1) escuchando en http://localhost:${PORT}`);
});
