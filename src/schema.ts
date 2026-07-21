import { z } from "zod";

export const CATEGORIAS_INTERES = [
  "naturaleza",
  "cultura",
  "gastronomia",
  "aventura",
  "familiar",
  "descanso",
  "fotografia",
  "eventos",
] as const;

export const ExtractRequestSchema = z.object({
  texto: z.string().min(3, "El texto debe tener al menos 3 caracteres"),
});
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;

export const ParametrosViajeSchema = z.object({
  destino: z.string().nullable(),
  interes: z.enum(CATEGORIAS_INTERES).nullable(),
  comida: z.string().nullable(),
  personas: z.number().int().positive().nullable(),
  presupuesto: z.number().nonnegative().nullable(),
  tiempo: z.string().nullable(),
});
export type ParametrosViaje = z.infer<typeof ParametrosViajeSchema>;

const ActividadSchema = z.object({
  id: z.number(),
  nombre: z.string(),
  tipo: z.enum(["destino", "restaurante"]),
  municipio: z.string(),
  categoria: z.string().nullable(),
  costo_estimado: z.number(),
  costo_total_grupo: z.number(),
  tiempo_horas: z.number(),
  nivel_afluencia: z.number(),
  cluster_afluencia: z.string().nullable(),
  tipo_comida: z.string().nullable().optional(),
});

export const RecomendacionSchema = z.object({
  id: z.number(),
  parametros_entrada: z.unknown(),
  itinerario: z.array(ActividadSchema),
  costo_total: z.number(),
  tiempo_total_horas: z.number(),
  presupuesto_disponible: z.number().nullable(),
  tiempo_disponible_horas: z.number(),
  reglas_asociacion_aplicadas: z.array(z.string()),
  resumen_clusters_candidatos: z.record(z.string(), z.number()),
  creado_en: z.string(),
});
export type Recomendacion = z.infer<typeof RecomendacionSchema>;
