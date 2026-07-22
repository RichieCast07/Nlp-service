import "dotenv/config";
import express, { type Request, type Response } from "express";
import { ExtractRequestSchema, PlanearRequestSchema } from "./schema.js";
import { extraerParametros, redactarRespuesta, responderConversacional, pedirCamposFaltantes, ExtractionError } from "./groqClient.js";
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
    const fotoValue = foto !== null ? JSON.stringify(foto) : "null";
    try {
      const card = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
      card.foto_principal = foto;
      reemplazos++;
      return "```card\n" + JSON.stringify(card, null, 2) + "\n```";
    } catch {
      // JSON invalido: intentar reemplazo con regex como fallback
      const fixed = jsonStr.replace(
        /"foto_principal"\s*:\s*(?:"[^"]*"|null|[^,}\n]*)/,
        `"foto_principal": ${fotoValue}`
      );
      if (fixed !== jsonStr) {
        reemplazos++;
        return "```card\n" + fixed.trim() + "\n```";
      }
      console.warn(`[inyectarFotos] No se pudo inyectar foto en card ${indice}:`, jsonStr.slice(0, 120));
      return match;
    }
  });
  console.log(`[inyectarFotos] ${reemplazos}/${indice} cards con foto. Fotos: ${JSON.stringify(fotos)}`);
  return resultado;
}

// Devuelve destinos destacados del motor ML (los mejor puntuados del catalogo).
// La home page los usa para mostrar la lista de destinos populares.
app.get("/destacados", async (req: Request, res: Response) => {
  const limite = Math.min(parseInt(req.query.limite as string ?? "10") || 10, 30);
  try {
    const params = { destino: null, interes: null, comida: null, personas: 1, presupuesto: 3000, tiempo: "1 dia" };
    const recomendacion = await obtenerRecomendacion(params as Parameters<typeof obtenerRecomendacion>[0]);
    const destacados = recomendacion.itinerario
      .filter((a) => (a as { tipo: string }).tipo === "destino")
      .slice(0, limite)
      .map((a) => ({
        id: (a as { id: number }).id,
        nombre: (a as { nombre: string }).nombre,
        municipio: (a as { municipio: string }).municipio,
        categoria: (a as { categoria: string | null }).categoria,
        foto_principal: (a as { foto_principal?: string | null }).foto_principal ?? null,
        lat: (a as { lat?: number | null }).lat ?? null,
        lng: (a as { lng?: number | null }).lng ?? null,
        calificacion: 0,
      }));
    res.json({ destacados });
  } catch (err) {
    console.error("[destacados] error:", err);
    res.status(500).json({ error: "Error al obtener destacados" });
  }
});

app.post("/planear", async (req: Request, res: Response) => {
  const parsedBody = PlanearRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten() });
  }
  const { texto, historial = [], user_lat, user_lng, nombre_usuario, es_primer_mensaje } = parsedBody.data;

  try {
    const parametros = await extraerParametros(texto, historial);
    console.log(`[planear] parametros: destino=${parametros.destino} interes=${parametros.interes} presupuesto=${parametros.presupuesto} personas=${parametros.personas} tiempo=${parametros.tiempo}`);

    const sinIntento = Object.values(parametros).every((v) => v === null);
    if (sinIntento) {
      const mensaje = await responderConversacional(texto);
      return res.json({ mensaje });
    }

    // Si el usuario dio pistas de viaje pero falta el destino, pedirlo.
    if (!parametros.destino) {
      const mensaje = await pedirCamposFaltantes(texto, ["destino (¿a qué municipio o lugar de Chiapas quieres ir?)"], historial);
      return res.json({ mensaje });
    }

    const recomendacion = await obtenerRecomendacion(parametros);

    // Calcular tiempos de traslado desde la ubicación del usuario (si la tiene).
    let tiempos = null;
    if (user_lat != null && user_lng != null && recomendacion.itinerario.length > 0) {
      tiempos = await calcularTiempos(user_lat, user_lng, recomendacion.itinerario);
    }

    const contextoFallback = (recomendacion as { mensaje?: string | null }).mensaje ?? null;
    const mensaje = await redactarRespuesta(recomendacion, texto, historial, tiempos, contextoFallback);

    // Inyectar foto_principal por posicion (GROQ inventa IDs, no son confiables)
    const fotosArray = recomendacion.itinerario.map(
      (a) => (a as { foto_principal?: string | null }).foto_principal ?? null
    );
    console.log(`[planear] itinerario: ${recomendacion.itinerario.length} items, fotos: ${JSON.stringify(fotosArray)}`);
    const mensajeConFotos = inyectarFotos(mensaje, fotosArray);

    // Saludo personalizado en el primer mensaje de la conversación
    import('fs').then(({ appendFileSync }) => {
      appendFileSync('/tmp/nlp-saludo.log', `${Date.now()} primer=${String(es_primer_mensaje)} nombre=${String(nombre_usuario)}\n`);
    });
    const mensajeFinal = (es_primer_mensaje && nombre_usuario)
      ? `¡Hola ${nombre_usuario}! ${mensajeConFotos}`
      : mensajeConFotos;

    res.json({ parametros, recomendacion, mensaje: mensajeFinal });
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
