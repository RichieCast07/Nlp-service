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
