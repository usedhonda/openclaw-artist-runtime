export const personaCanonicalVersion = 1;

export const artistManagedSections = [
  "Public Identity",
  "Current Artist Core",
  "Sound",
  "Lyrics",
  "Social Voice",
  "Suno Production Profile"
] as const;

export const soulManagedSections = ["Telegram Persona Voice"] as const;

export const personaFileContracts = {
  "ARTIST.md": {
    owns: "artist name, premise, obsessions, sound anchors, lyric constraints, public output voice, and Suno production traits",
    forbidden: [
      "producer relationship",
      "producer identity",
      "producer facts",
      "private weather",
      "what i fear",
      "telegram persona voice",
      "conversation tone",
      "refusal style"
    ]
  },
  "SOUL.md": {
    owns: "direct speaking style: conversation tone, refusal style, first person, producer callname, sentence endings, and signature moves",
    forbidden: [
      "suno production profile",
      "genre dna",
      "sonic anchors",
      "producer identity",
      "private weather",
      "what i fear"
    ]
  },
  "IDENTITY.md": {
    owns: "derived identity card from ARTIST.md and SOUL.md; no new setup facts",
    forbidden: [
      "genre dna",
      "core obsessions",
      "producer identity",
      "private weather",
      "conversation tone",
      "suno production profile"
    ]
  },
  "INNER.md": {
    owns: "private creative pressure that changes the work",
    forbidden: [
      "artist name",
      "suno production profile",
      "producer identity",
      "conversation tone",
      "genre dna",
      "social voice"
    ]
  },
  "PRODUCER.md": {
    owns: "producer-specific facts that change response or decisions",
    forbidden: [
      "artist name",
      "genre dna",
      "suno production profile",
      "conversation tone",
      "private weather",
      "voice fingerprint"
    ]
  }
} as const;

export type PersonaTemplateFile = keyof typeof personaFileContracts;

