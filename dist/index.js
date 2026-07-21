import "dotenv/config";
import express from "express";
import { ExtractRequestSchema } from "./schema.js";
import { extraerParametros, redactarRespuesta, responderConversacional, ExtractionError } from "./groqClient.js";
import { obtenerRecomendacion, warmupMlEngine, MlEngineError } from "./mlEngineClient.js";
if (!process.env.GROQ_API_KEY) {
    throw new Error("Falta GROQ_API_KEY en el entorno. Copia .env.example a .env y agrega tu clave.");
}
const app = express();
app.use(express.json());
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});
// Despierta el motor ML (Render free tier duerme tras 15 min).
// Llamar esto al abrir la pantalla de chat.
app.get("/warmup", async (_req, res) => {
    await warmupMlEngine();
    res.json({ status: "ok" });
});
app.post("/extract", async (req, res) => {
    const parsedBody = ExtractRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(400).json({ error: parsedBody.error.flatten() });
    }
    try {
        const parametros = await extraerParametros(parsedBody.data.texto);
        res.json({ parametros });
    }
    catch (err) {
        if (err instanceof ExtractionError) {
            return res.status(502).json({ error: err.message });
        }
        console.error(err);
        res.status(500).json({ error: "Error interno al extraer parametros" });
    }
});
app.post("/planear", async (req, res) => {
    const parsedBody = ExtractRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(400).json({ error: parsedBody.error.flatten() });
    }
    const { texto } = parsedBody.data;
    try {
        const parametros = await extraerParametros(texto);
        // Si el usuario no menciono ningun parametro de viaje (saludo, pregunta general, etc.)
        // respondemos conversacionalmente sin llamar al motor ML.
        const sinIntento = Object.values(parametros).every((v) => v === null);
        if (sinIntento) {
            const mensaje = await responderConversacional(texto);
            return res.json({ mensaje });
        }
        const recomendacion = await obtenerRecomendacion(parametros);
        const mensaje = await redactarRespuesta(recomendacion, texto);
        res.json({ parametros, recomendacion, mensaje });
    }
    catch (err) {
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
