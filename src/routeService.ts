// OSRM public demo server — sin registro, sin API key, usa OpenStreetMap.
// Para producción con alto tráfico se puede hostear uno propio.
const OSRM_URL = "https://router.project-osrm.org/table/v1/driving";

export interface TravelResult {
  tiempoMinutos: number;
  distanciaKm: number;
  nivelTrafico: string;
}

// Estima nivel de tráfico por hora local de México (UTC-6).
function nivelTrafico(): string {
  const hora = (new Date().getUTCHours() - 6 + 24) % 24;
  if ((hora >= 7 && hora < 9) || (hora >= 18 && hora < 21)) return "alto";
  if ((hora >= 9 && hora < 18)) return "moderado";
  return "bajo";
}

export async function calcularTiempos(
  userLat: number,
  userLng: number,
  destinos: Array<{ lat: number | null; lng: number | null }>
): Promise<Array<TravelResult | null>> {
  // Solo destinos con coordenadas conocidas
  const indexConCoords: number[] = [];
  // Primera coordenada = usuario (fuente), resto = destinos
  const pares: string[] = [`${userLng},${userLat}`];

  for (let i = 0; i < destinos.length; i++) {
    const d = destinos[i];
    if (d.lat != null && d.lng != null) {
      indexConCoords.push(i);
      pares.push(`${d.lng},${d.lat}`);
    }
  }

  if (indexConCoords.length === 0) {
    return destinos.map(() => null);
  }

  // destinations=1,2,...N para no calcular la diagonal (usuario→usuario)
  const destinosParam = indexConCoords.map((_, pos) => pos + 1).join(",");
  const url = `${OSRM_URL}/${pares.join(";")}?sources=0&destinations=${destinosParam}&annotations=duration,distance`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      console.error(`[routeService] OSRM respondio ${resp.status}`);
      return destinos.map(() => null);
    }

    const json = await resp.json() as {
      code: string;
      durations: number[][];
      distances: number[][];
    };

    if (json.code !== "Ok") {
      console.error("[routeService] OSRM code:", json.code);
      return destinos.map(() => null);
    }

    const trafico = nivelTrafico();
    const resultados: Array<TravelResult | null> = destinos.map(() => null);

    for (let pos = 0; pos < indexConCoords.length; pos++) {
      const idx = indexConCoords[pos];
      const segundos = json.durations[0]?.[pos];
      const metros   = json.distances[0]?.[pos];
      if (segundos != null) {
        resultados[idx] = {
          tiempoMinutos: Math.round(segundos / 60),
          distanciaKm:   Math.round((metros ?? 0) / 100) / 10,
          nivelTrafico:  trafico,
        };
      }
    }

    return resultados;
  } catch (err) {
    console.error("[routeService] Error al llamar OSRM:", (err as Error).message);
    return destinos.map(() => null);
  }
}
