export type Genre = "nu-jazz rap" | "alternative pop" | "edm" | "post-punk" | "rap" | "default";

export interface StyleTemplate {
  genreLine: string;
  instruments: string[];
  mixVision: string[];
  texture: string[];
  vocalProduction: string[];
  arrangementNotes: string[];
}

export const STYLE_TEMPLATES: Record<Genre, StyleTemplate> = {
  "nu-jazz rap": {
    genreLine: "nu-jazz rap, 132 BPM, minor key, 2000s underground lineage",
    instruments: ["live jazz drums", "fat upright bass", "Rhodes voicings", "tenor sax fragments", "muted horn stabs"],
    mixVision: ["wide stereo room", "raw analog glue", "bass-forward low mids", "dry vocal center", "tight transient control"],
    texture: ["vintage tape character", "vinyl warmth without lo-fi blur", "dim club air", "brushed cymbal grain"],
    vocalProduction: ["close mic dry lead", "restrained doubles", "spoken-rap edges", "clear consonants above bass"],
    arrangementNotes: ["Verse: stripped Rhodes and bass answer the vocal", "Hook: horn chant and drum lift", "Bridge: drums thin out, sax ghosts behind the line"]
  },
  "alternative pop": {
    genreLine: "alternative pop, 124 BPM, minor key, late-night city lineage",
    instruments: ["warm bass guitar", "brushed drums", "glass synth pads", "muted piano", "small room percussion"],
    mixVision: ["intimate stereo field", "soft compression", "clean vocal pocket", "subtle tape saturation", "polished but not glossy"],
    texture: ["rainy neon air", "analog pad haze", "soft attack transients", "modern indie polish"],
    vocalProduction: ["close dry vocal", "thin harmony shadows", "restrained lift on hook", "unforced phrasing"],
    arrangementNotes: ["Verse: small and observational", "Hook: wider but still tense", "Bridge: harmonic color shifts without arena scale"]
  },
  edm: {
    genreLine: "edm, 128 BPM, minor key, restrained underground club lineage",
    instruments: ["sub bass pulse", "tight kick", "metallic hats", "cold synth arp", "filtered chord stab"],
    mixVision: ["club-weight low end", "wide sidechain motion", "clean drop headroom", "sharp stereo automation", "controlled brightness"],
    texture: ["night-drive digital sheen", "no festival crowd noise", "sleek transient snap", "humid warehouse space"],
    vocalProduction: ["dry lead phrase", "short delay throws", "minimal tuning sheen", "vocal chops used sparingly"],
    arrangementNotes: ["Verse: pulse under vocal restraint", "Hook: groove opens without maximal drop", "Bridge: filter narrows before final release"]
  },
  "post-punk": {
    genreLine: "post-punk, 138 BPM, minor key, cold industrial city lineage",
    instruments: ["driving bass guitar", "dry snare", "chorused guitar", "mono synth drone", "floor tom accents"],
    mixVision: ["narrow center pressure", "hard room reflections", "gritty midrange", "minimal reverb tail", "urgent drum image"],
    texture: ["concrete hallway echo", "tape scrape", "cold amplifier hiss", "angular guitar bite"],
    vocalProduction: ["close stern vocal", "minimal doubles", "talk-sung attack", "dry consonant edge"],
    arrangementNotes: ["Verse: bass carries the motion", "Hook: guitar widens in short stabs", "Bridge: synth drone and toms expose tension"]
  },
  rap: {
    genreLine: "rap, 150 BPM, minor key, dry modern street lineage",
    instruments: ["fat 808 bass", "tight snare", "dusty Rhodes stab", "low brass hit", "syncopated hat pattern"],
    mixVision: ["vocal-forward center", "heavy low-end pocket", "dry punch", "controlled stereo adlibs", "no muddy bass bloom"],
    texture: ["smoked room air", "sampled dust without nostalgia cosplay", "hard transient snap", "dark polished edge"],
    vocalProduction: ["close rap lead", "selective doubles on punchlines", "adlibs tucked low", "breath cuts left intact"],
    arrangementNotes: ["Verse: dense flow with air at bar turns", "Hook: short chant locks the title", "Bridge: beat strips to bass and voice"]
  },
  default: {
    genreLine: "alternative pop, 124 BPM, minor key, observational city lineage",
    instruments: ["warm bass", "restrained drums", "cold synth texture", "muted keys", "small percussion"],
    mixVision: ["intimate mix", "wide but uncluttered stereo", "clear vocal lane", "bass-forward warmth", "controlled reverb"],
    texture: ["urban dusk atmosphere", "soft analog grain", "no novelty effects", "clean nocturnal pressure"],
    vocalProduction: ["close dry vocal", "quiet doubles", "natural phrasing", "clear lyric intelligibility"],
    arrangementNotes: ["Verse: sparse details carry the story", "Hook: repeat the central image", "Bridge: remove drums to expose the turn"]
  }
};
