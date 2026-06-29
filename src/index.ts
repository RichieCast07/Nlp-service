import "dotenv/config";
import express, { type Request, type Response } from "express";
import { ExtractRequestSchema } from "./schema.js";
import { extraerParametros, ExtractionError } from "./groqClient.js";

if (!process.env.GROQ_API_KEY) {
  throw new Error("Falta GROQ_API_KEY en el entorno. Copia .env.example a .env y agrega tu clave.");
}

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
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

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`NLP service (Capa 1) escuchando en http://localhost:${PORT}`);
});
