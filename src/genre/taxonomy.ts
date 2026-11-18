export const GENRE_TAXONOMY_VERSION = "2026.2";

export interface GenreDefinition {
  id: string;
  label: string;
  family: string;
  aliases: readonly string[];
  regionTags: readonly string[];
  tempoHints?: readonly [number, number];
}

export const GENRE_TAXONOMY: readonly GenreDefinition[] = [
  { id: "afrobeats", label: "Afrobeats", family: "African popular", aliases: ["afro beats", "afropop nigeria", "naija pop", "afrobeat pop"], regionTags: ["west-africa", "african-diaspora"], tempoHints: [92, 128] },
  { id: "afro-pop", label: "Afro-pop", family: "African popular", aliases: ["afropop", "afro pop"], regionTags: ["west-africa", "southern-africa", "east-africa", "african-diaspora"], tempoHints: [88, 132] },
  { id: "afro-fusion", label: "Afro-fusion", family: "African popular", aliases: ["afrofusion", "afro fusion"], regionTags: ["west-africa", "african-diaspora"] },
  { id: "afro-soul", label: "Afro Soul", family: "African soul", aliases: ["afro-soul", "afrosoul", "african soul"], regionTags: ["west-africa", "african-diaspora"] },
  { id: "afro-rnb", label: "Afro-R&B", family: "African popular", aliases: ["afro r&b", "afro rnb", "african r&b"], regionTags: ["west-africa", "african-diaspora"] },
  { id: "alte", label: "Alté", family: "African alternative", aliases: ["alte", "alternative african", "nigerian alternative"], regionTags: ["west-africa", "african-diaspora"] },
  { id: "amapiano", label: "Amapiano", family: "Southern African dance", aliases: ["ama piano", "private school amapiano"], regionTags: ["southern-africa", "african-diaspora"], tempoHints: [105, 120] },
  { id: "3-step", label: "3-Step", family: "Southern African dance", aliases: ["three step", "3 step", "three-step"], regionTags: ["southern-africa", "african-diaspora"], tempoHints: [105, 125] },
  { id: "bacardi", label: "Bacardi", family: "Southern African dance", aliases: ["pretoria bacardi"], regionTags: ["southern-africa"] },
  { id: "gqom", label: "Gqom", family: "Southern African dance", aliases: ["igqom"], regionTags: ["southern-africa"], tempoHints: [110, 130] },
  { id: "kwaito", label: "Kwaito", family: "Southern African popular", aliases: ["south african kwaito"], regionTags: ["southern-africa"], tempoHints: [85, 115] },
  { id: "afro-house", label: "Afro-house", family: "African electronic", aliases: ["afro house", "african house"], regionTags: ["southern-africa", "west-africa", "african-diaspora"], tempoHints: [118, 128] },
  { id: "afro-tech", label: "Afro-tech", family: "African electronic", aliases: ["afrotech", "afro techno"], regionTags: ["southern-africa", "african-diaspora"], tempoHints: [118, 132] },
  { id: "highlife", label: "Highlife", family: "West African popular", aliases: ["ghanaian highlife", "palm wine highlife"], regionTags: ["west-africa", "african-diaspora"], tempoHints: [90, 130] },
  { id: "hiplife", label: "Hiplife", family: "West African popular", aliases: ["hip life", "ghana hiplife"], regionTags: ["west-africa", "african-diaspora"], tempoHints: [80, 115] },
  { id: "fuji", label: "Fuji", family: "Nigerian traditional popular", aliases: ["yoruba fuji"], regionTags: ["west-africa"] },
  { id: "juju", label: "Jùjú", family: "Nigerian traditional popular", aliases: ["juju music"], regionTags: ["west-africa"] },
  { id: "apala", label: "Àpàlà", family: "Nigerian traditional popular", aliases: ["apala music"], regionTags: ["west-africa"] },
  { id: "afroswing", label: "Afroswing", family: "African diaspora", aliases: ["afro swing", "afro-bashment"], regionTags: ["west-africa", "african-diaspora"], tempoHints: [85, 115] },
  { id: "soukou", label: "Soukous", family: "Central African popular", aliases: ["soukous", "congolese rumba"], regionTags: ["central-africa", "african-diaspora"] },
  { id: "ndombolo", label: "Ndombolo", family: "Central African popular", aliases: ["ndombolo"], regionTags: ["central-africa", "african-diaspora"] },
  { id: "makossa", label: "Makossa", family: "Central African popular", aliases: ["cameroonian makossa"], regionTags: ["central-africa"] },
  { id: "mbalax", label: "Mbalax", family: "West African popular", aliases: ["mbalakh"], regionTags: ["west-africa"] },
  { id: "bongo-flava", label: "Bongo Flava", family: "East African popular", aliases: ["bongoflava", "bongo flavour"], regionTags: ["east-africa", "african-diaspora"] },
  { id: "gengetone", label: "Gengetone", family: "East African popular", aliases: ["genge tone", "kenyan gengetone"], regionTags: ["east-africa"] },
  { id: "singeli", label: "Singeli", family: "East African dance", aliases: ["tanzanian singeli"], regionTags: ["east-africa"], tempoHints: [160, 200] },
  { id: "kizomba", label: "Kizomba", family: "Lusophone African dance", aliases: ["urban kiz", "kizomba music"], regionTags: ["southern-africa", "african-diaspora"], tempoHints: [85, 105] },
  { id: "kuduro", label: "Kuduro", family: "Lusophone African dance", aliases: ["kuduru"], regionTags: ["southern-africa", "african-diaspora"], tempoHints: [125, 145] },
  { id: "coupe-decale", label: "Coupé-Décalé", family: "West African dance", aliases: ["coupe decale", "coupé décalé"], regionTags: ["west-africa", "african-diaspora"], tempoHints: [115, 135] },
  { id: "rnb", label: "R&B", family: "Contemporary popular", aliases: ["r and b", "rhythm and blues", "contemporary r&b"], regionTags: ["global", "african-diaspora"], tempoHints: [60, 110] },
  { id: "hip-hop", label: "Hip-Hop", family: "Contemporary popular", aliases: ["hip hop", "rap", "trap"], regionTags: ["global", "african-diaspora"], tempoHints: [65, 115] },
  { id: "house", label: "House", family: "Electronic", aliases: ["deep house", "tech house"], regionTags: ["global"], tempoHints: [118, 132] },
  { id: "pop", label: "Pop", family: "Contemporary popular", aliases: ["dance pop", "indie pop"], regionTags: ["global"], tempoHints: [90, 140] },
  { id: "reggae", label: "Reggae", family: "Caribbean", aliases: ["roots reggae", "dancehall reggae"], regionTags: ["caribbean", "african-diaspora"], tempoHints: [65, 100] },
  { id: "ambient", label: "Ambient", family: "Electronic", aliases: ["ambient music", "soundscape"], regionTags: ["global"], tempoHints: [50, 100] },
] as const;

export interface SceneDefinition {
  id: string;
  label: string;
  kind: "region" | "city" | "diaspora";
  aliases: readonly string[];
}

export const SCENE_TAXONOMY: readonly SceneDefinition[] = [
  { id: "west-africa", label: "West Africa", kind: "region", aliases: ["west african", "west africa", "wa"] },
  { id: "southern-africa", label: "Southern Africa", kind: "region", aliases: ["southern african", "south africa region", "southern africa"] },
  { id: "east-africa", label: "East Africa", kind: "region", aliases: ["east african", "east africa"] },
  { id: "central-africa", label: "Central Africa", kind: "region", aliases: ["central african", "central africa"] },
  { id: "african-diaspora", label: "African diaspora", kind: "diaspora", aliases: ["afro diaspora", "african diaspora", "diaspora african"] },
  { id: "caribbean", label: "Caribbean", kind: "region", aliases: ["caribbean"] },
  { id: "lagos", label: "Lagos", kind: "city", aliases: ["lagos", "naija", "nigerian scene"] },
  { id: "accra", label: "Accra", kind: "city", aliases: ["accra", "ghanaian scene"] },
  { id: "johannesburg", label: "Johannesburg", kind: "city", aliases: ["joburg", "johannesburg", "jozi"] },
  { id: "durban", label: "Durban", kind: "city", aliases: ["durban", "durban scene"] },
  { id: "nairobi", label: "Nairobi", kind: "city", aliases: ["nairobi", "kenyan scene"] },
  { id: "dar-es-salaam", label: "Dar es Salaam", kind: "city", aliases: ["dar es salaam", "dar", "tanzanian scene"] },
  { id: "luanda", label: "Luanda", kind: "city", aliases: ["luanda", "angolan scene"] },
  { id: "kinshasa", label: "Kinshasa", kind: "city", aliases: ["kinshasa", "congolese scene"] },
  { id: "london", label: "London diaspora", kind: "diaspora", aliases: ["london", "uk afrobeats", "uk afro swing"] },
  { id: "atlanta", label: "Atlanta diaspora", kind: "diaspora", aliases: ["atlanta", "atlanta afrobeats"] },
];

export function normalizeGenreToken(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const genreAliases = new Map<string, GenreDefinition>();
for (const genre of GENRE_TAXONOMY) {
  for (const alias of [genre.id, genre.label, ...genre.aliases]) {
    genreAliases.set(normalizeGenreToken(alias), genre);
  }
}
const sceneAliases = new Map<string, SceneDefinition>();
for (const scene of SCENE_TAXONOMY) {
  for (const alias of [scene.id, scene.label, ...scene.aliases]) {
    sceneAliases.set(normalizeGenreToken(alias), scene);
  }
}

export function findGenre(value: string): GenreDefinition | null {
  return genreAliases.get(normalizeGenreToken(value)) ?? null;
}

export function findScene(value: string): SceneDefinition | null {
  return sceneAliases.get(normalizeGenreToken(value)) ?? null;
}
