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
];
export const ExtractRequestSchema = z.object({
    texto: z.string().min(3, "El texto debe tener al menos 3 caracteres"),
});
export const MensajeHistorialSchema = z.object({
    rol: z.enum(["user", "bot"]),
    contenido: z.string().min(1).max(5000),
});
export const PlanearRequestSchema = z.object({
    texto: z.string().min(3, "El texto debe tener al menos 3 caracteres"),
    historial: z.array(MensajeHistorialSchema).max(20).optional(),
    user_lat: z.number().optional(),
    user_lng: z.number().optional(),
});
export const ParametrosViajeSchema = z.object({
    destino: z.string().nullable(),
    interes: z.enum(CATEGORIAS_INTERES).nullable(),
    comida: z.string().nullable(),
    personas: z.number().int().positive().nullable(),
    presupuesto: z.number().nonnegative().nullable(),
    tiempo: z.string().nullable(),
});
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
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    foto_principal: z.string().nullable().optional(),
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
