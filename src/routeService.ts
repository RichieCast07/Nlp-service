// OSRM public demo server — sin registro, sin API key, usa OpenStreetMap.
// Para producción con alto tráfico se puede hostear uno propio.
const OSRM_URL = "https://router.project-osrm.org/table/v1/driving";

export interface TravelResult {
  tiempoMinutos: number;
  distanciaKm: number;
  nivelTrafico: string;
  esFallback: boolean; // true si se usó Haversine en lugar de OSRM
}

// ---------------------------------------------------------------------------
// Modelo de corrección de tiempo OSRM
//
// OSRM calcula tiempos usando velocidades teóricas por clase de vía OSM:
//   secundaria = 55 km/h, terciaria = 40 km/h, etc.
// En Chiapas esas velocidades no se alcanzan por: topes al entrar a cada
// poblado, curvas de montaña, camiones lentos en carreteras angostas y
// caminos de terracería mal clasificados en OSM.
//
// Aplicamos un factor diferenciado según la distancia real del trayecto:
//   < 20 km  → 1.2x  (urbano: Tuxtla / San Cristóbal, carreteras asfaltadas)
//   20–80 km → 1.4x  (semi-rural: conexiones entre cabeceras municipales)
//   > 80 km  → 1.6x  (rural/montaña: Palenque, Montebello, El Chiflón)
// ---------------------------------------------------------------------------
function factorCorreccion(distanciaMetros: number): number {
  const km = distanciaMetros / 1000;
  if (km < 20) return 1.2;
  if (km < 80) return 1.4;
  return 1.6;
}

// ---------------------------------------------------------------------------
// Haversine — distancia en línea recta entre dos coordenadas (en metros).
// Se usa solo como último recurso cuando OSRM no responde.
// ---------------------------------------------------------------------------
function haversineMetros(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Estima tiempo cuando OSRM falla.
// Tortuosidad 1.35 convierte línea recta → distancia de carretera aproximada.
// Velocidad media 35 km/h es conservadora para Chiapas (mezcla urbano+rural).
function estimarFallback(
  userLat: number, userLng: number,
  destLat: number, destLng: number
): { tiempoMinutos: number; distanciaKm: number } {
  const lineaRecta = haversineMetros(userLat, userLng, destLat, destLng);
  const distanciaMetros = lineaRecta * 1.35;   // coeficiente de tortuosidad
  const distanciaKm = Math.round(distanciaMetros / 100) / 10;
  const tiempoMinutos = Math.round(distanciaMetros / (35_000 / 60));
  return { tiempoMinutos, distanciaKm };
}

// Estima nivel de tráfico por hora local de México (UTC-6).
function nivelTrafico(): string {
  const hora = (new Date().getUTCHours() - 6 + 24) % 24;
  if ((hora >= 7 && hora < 9) || (hora >= 18 && hora < 21)) return "alto";
  if (hora >= 9 && hora < 18) return "moderado";
  return "bajo";
}

export async function calcularTiempos(
  userLat: number,
  userLng: number,
  destinos: Array<{ lat?: number | null; lng?: number | null }>
): Promise<Array<TravelResult | null>> {
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

  const trafico = nivelTrafico();
  const resultados: Array<TravelResult | null> = destinos.map(() => null);

  // destinations=1,2,...N para no calcular la diagonal (usuario→usuario)
  const destinosParam = indexConCoords.map((_, pos) => pos + 1).join(",");
  const url = `${OSRM_URL}/${pares.join(";")}?sources=0&destinations=${destinosParam}&annotations=duration,distance`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json() as {
      code: string;
      durations: number[][];
      distances: number[][];
    };

    if (json.code !== "Ok") throw new Error(`OSRM code: ${json.code}`);

    for (let pos = 0; pos < indexConCoords.length; pos++) {
      const idx = indexConCoords[pos];
      const segundos = json.durations[0]?.[pos];
      const metros   = json.distances[0]?.[pos] ?? 0;
      if (segundos == null) continue;

      const factor = factorCorreccion(metros);
      resultados[idx] = {
        tiempoMinutos: Math.round((segundos * factor) / 60),
        distanciaKm:   Math.round(metros / 100) / 10,
        nivelTrafico:  trafico,
        esFallback:    false,
      };
    }

    return resultados;
  } catch (err) {
    console.error("[routeService] OSRM no disponible, usando Haversine:", (err as Error).message);

    // Fallback: estimación Haversine para todos los destinos con coordenadas
    for (const idx of indexConCoords) {
      const d = destinos[idx];
      if (d.lat == null || d.lng == null) continue;
      const est = estimarFallback(userLat, userLng, d.lat, d.lng);
      resultados[idx] = {
        ...est,
        nivelTrafico: trafico,
        esFallback: true,
      };
    }
    return resultados;
  }
}
