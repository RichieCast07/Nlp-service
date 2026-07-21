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

    res.json({ parametros, recomendacion, mensaje });
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
