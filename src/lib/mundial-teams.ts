/**
 * Lista compartida de las 48 selecciones clasificadas al Mundial 2026.
 * Usada por el panel admin (toggles) y la API (validación de ids).
 *
 * NOTA: La paleta de colores de cada selección vive en el script inline de
 * Layout.astro (no puede importar módulos). Aquí solo va lo mínimo necesario
 * para identificar cada selección: id, nombre y bandera.
 */

export interface MundialTeam {
  id: string;
  name: string;
  flag: string;
}

export const MUNDIAL_TEAMS: MundialTeam[] = [
  // CONMEBOL (6)
  { id: 'argentina', name: 'Argentina', flag: '🇦🇷' },
  { id: 'brazil', name: 'Brasil', flag: '🇧🇷' },
  { id: 'uruguay', name: 'Uruguay', flag: '🇺🇾' },
  { id: 'colombia', name: 'Colombia', flag: '🇨🇴' },
  { id: 'ecuador', name: 'Ecuador', flag: '🇪🇨' },
  { id: 'paraguay', name: 'Paraguay', flag: '🇵🇾' },
  // UEFA (16)
  { id: 'france', name: 'Francia', flag: '🇫🇷' },
  { id: 'germany', name: 'Alemania', flag: '🇩🇪' },
  { id: 'spain', name: 'España', flag: '🇪🇸' },
  { id: 'england', name: 'Inglaterra', flag: '🇬🇧' },
  { id: 'portugal', name: 'Portugal', flag: '🇵🇹' },
  { id: 'netherlands', name: 'Países Bajos', flag: '🇳🇱' },
  { id: 'belgium', name: 'Bélgica', flag: '🇧🇪' },
  { id: 'croatia', name: 'Croacia', flag: '🇭🇷' },
  { id: 'switzerland', name: 'Suiza', flag: '🇨🇭' },
  { id: 'austria', name: 'Austria', flag: '🇦🇹' },
  { id: 'scotland', name: 'Escocia', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  { id: 'turkey', name: 'Turquía', flag: '🇹🇷' },
  { id: 'norway', name: 'Noruega', flag: '🇳🇴' },
  { id: 'sweden', name: 'Suecia', flag: '🇸🇪' },
  { id: 'czechia', name: 'Chequia', flag: '🇨🇿' },
  { id: 'bosnia', name: 'Bosnia', flag: '🇧🇦' },
  // CONCACAF (6)
  { id: 'usa', name: 'EE. UU.', flag: '🇺🇸' },
  { id: 'mexico', name: 'México', flag: '🇲🇽' },
  { id: 'canada', name: 'Canadá', flag: '🇨🇦' },
  { id: 'panama', name: 'Panamá', flag: '🇵🇦' },
  { id: 'haiti', name: 'Haití', flag: '🇭🇹' },
  { id: 'curacao', name: 'Curazao', flag: '🇨🇼' },
  // CAF (10)
  { id: 'morocco', name: 'Marruecos', flag: '🇲🇦' },
  { id: 'senegal', name: 'Senegal', flag: '🇸🇳' },
  { id: 'ghana', name: 'Ghana', flag: '🇬🇭' },
  { id: 'ivory_coast', name: 'Costa de Marfil', flag: '🇨🇮' },
  { id: 'algeria', name: 'Argelia', flag: '🇩🇿' },
  { id: 'egypt', name: 'Egipto', flag: '🇪🇬' },
  { id: 'south_africa', name: 'Sudáfrica', flag: '🇿🇦' },
  { id: 'tunisia', name: 'Túnez', flag: '🇹🇳' },
  { id: 'cape_verde', name: 'Cabo Verde', flag: '🇨🇻' },
  { id: 'dr_congo', name: 'RD Congo', flag: '🇨🇩' },
  // AFC (9)
  { id: 'japan', name: 'Japón', flag: '🇯🇵' },
  { id: 'south_korea', name: 'Corea del Sur', flag: '🇰🇷' },
  { id: 'saudi_arabia', name: 'Arabia Saudita', flag: '🇸🇦' },
  { id: 'iran', name: 'Irán', flag: '🇮🇷' },
  { id: 'australia', name: 'Australia', flag: '🇦🇺' },
  { id: 'qatar', name: 'Catar', flag: '🇶🇦' },
  { id: 'iraq', name: 'Irak', flag: '🇮🇶' },
  { id: 'jordan', name: 'Jordania', flag: '🇯🇴' },
  { id: 'uzbekistan', name: 'Uzbekistán', flag: '🇺🇿' },
  // OFC (1)
  { id: 'new_zealand', name: 'Nueva Zelanda', flag: '🇳🇿' }
];

const VALID_IDS = new Set(MUNDIAL_TEAMS.map((t) => t.id));

/** Filtra una lista de ids dejando solo los que corresponden a selecciones válidas. */
export function sanitizeTeamIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === 'string' && VALID_IDS.has(id));
}
