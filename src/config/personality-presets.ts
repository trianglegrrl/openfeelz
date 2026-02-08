/**
 * Pre-defined OCEAN personality presets based on internationally known
 * historical figures. Diverse across time, region, and domain.
 * Research: Perplexity API (see docs/personality-presets-research.md).
 */

import type { EmotionEngineState, OCEANProfile } from "../types.js";
import {
  computeBaseline,
  computeDimensionDecayRates,
  computeEmotionDecayRates,
} from "../model/personality.js";

export interface PersonalityPreset {
  id: string;
  name: string;
  shortDescription: string;
  bio: string;
  ocean: OCEANProfile;
  /** Per-trait rationale keyed by OCEAN trait name. */
  traitDetails: Record<string, string>;
  rationale: string;
}

function clampOcean(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampProfile(profile: OCEANProfile): OCEANProfile {
  return {
    openness: clampOcean(profile.openness),
    conscientiousness: clampOcean(profile.conscientiousness),
    extraversion: clampOcean(profile.extraversion),
    agreeableness: clampOcean(profile.agreeableness),
    neuroticism: clampOcean(profile.neuroticism),
  };
}

const PRESETS: readonly PersonalityPreset[] = [
  {
    id: "einstein",
    name: "Albert Einstein",
    shortDescription: "Theoretical physicist (Germany/US, 20th c.)",
    bio: "Developed the theory of relativity and E=mc², won the 1921 Nobel Prize for the photoelectric effect, and became a global icon for scientific imagination and advocacy for peace and civil rights.",
    ocean: { openness: 0.95, conscientiousness: 0.7, extraversion: 0.4, agreeableness: 0.6, neuroticism: 0.5 },
    traitDetails: {
      openness: "Revolutionary imagination — thought experiments like riding a beam of light led to special relativity; maximal curiosity and abstract thinking.",
      conscientiousness: "Persistent, methodical work on complex problems over years, but balanced by playful distractions like sailing and violin.",
      extraversion: "Preferred solitary reflection, describing himself as a 'lone traveler' in letters; moderate-low sociability amid later public lectures.",
      agreeableness: "Cooperative in collaborations (e.g. with Besso) but firmly opposed authority; balanced between warmth and independence.",
      neuroticism: "Experienced anxiety over political exile and atomic bomb development, but maintained stability through humor and philosophy.",
    },
    rationale: "Biographical analyses and correspondence; autobiographical notes; Princeton-era accounts.",
  },
  {
    id: "marie-curie",
    name: "Marie Curie",
    shortDescription: "Physicist and chemist (Poland/France, 19th–20th c.)",
    bio: "Pioneered research on radioactivity, discovered polonium and radium, and won Nobel Prizes in both Physics (1903) and Chemistry (1911) — the first woman to win a Nobel and the only person to win in two sciences.",
    ocean: { openness: 0.9, conscientiousness: 0.95, extraversion: 0.3, agreeableness: 0.5, neuroticism: 0.6 },
    traitDetails: {
      openness: "Visionary pursuit of unseen radioactive elements; 'Be less curious about people and more curious about ideas' — near-maximal intellectual novelty-seeking.",
      conscientiousness: "Thousands of meticulous experiments, studying without eating or heat to save resources, persisting through Pierre's death.",
      extraversion: "Introverted, preferring solitary lab work and early morning focus; shunned social frivolity.",
      agreeableness: "Navigated scandals with objectivity, prioritized science over personal relationships; moderate professional resilience.",
      neuroticism: "Lifelong bouts of depression and reckless disregard for radiation dangers, tempered by perseverance.",
    },
    rationale: "Nobel archives, PMC biographical synthesis, *Madame Curie* (Ève Curie).",
  },
  {
    id: "mandela",
    name: "Nelson Mandela",
    shortDescription: "Anti-apartheid leader, President of South Africa (20th c.)",
    bio: "Spent 27 years in prison before leading negotiations to dismantle apartheid peacefully, becoming South Africa's first Black president (1994–1999) and winning the 1993 Nobel Peace Prize for reconciliation.",
    ocean: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.8, agreeableness: 0.9, neuroticism: 0.2 },
    traitDetails: {
      openness: "Adaptive shift from militancy to inclusive democracy; learned Afrikaans in prison to understand oppressors (*Long Walk to Freedom*).",
      conscientiousness: "Disciplined lifelong commitment to justice, enduring prison isolation while studying law and leading covert ANC operations.",
      extraversion: "Charismatic public speeches (1990 release address); post-presidency global advocacy; rallied masses naturally.",
      agreeableness: "Forgiving oppressors at the 1995 Rugby World Cup; chaired reconciliation commissions; promoted unity over vengeance.",
      neuroticism: "Remarkable emotional stability during torture and isolation; calm leadership documented in prison letters and biographies.",
    },
    rationale: "*Long Walk to Freedom*; leadership analyses; Nobel biography.",
  },
  {
    id: "wangari-maathai",
    name: "Wangari Maathai",
    shortDescription: "Environmentalist and Nobel Peace laureate (Kenya, 20th c.)",
    bio: "Founded the Green Belt Movement, planting over 50 million trees to combat deforestation and empower women. First African woman to win the Nobel Peace Prize (2004) for linking democracy, women's rights, and sustainable development.",
    ocean: { openness: 0.9, conscientiousness: 0.9, extraversion: 0.7, agreeableness: 0.6, neuroticism: 0.4 },
    traitDetails: {
      openness: "Innovative fusion of tree-planting with human rights activism, challenging norms with interdisciplinary solutions (*Unbowed*).",
      conscientiousness: "Relentless organizing of rural women for millions of plantings despite beatings, imprisonment, and exile.",
      extraversion: "Bold public protests — 1989 save-Karura-Forest marches drawing thousands; strong mobilization energy.",
      agreeableness: "Cooperative community building balanced by confrontations with authorities, including parliamentary arrests.",
      neuroticism: "Resilience against personal attacks and forced divorce; maintained optimism throughout (*Unbowed*).",
    },
    rationale: "*Unbowed* (memoir); Nobel biography; Washington History.",
  },
  {
    id: "frida-kahlo",
    name: "Frida Kahlo",
    shortDescription: "Painter (Mexico, 20th c.)",
    bio: "Known for surrealist self-portraits exploring pain, identity, and Mexican culture, shaped by polio and a devastating bus accident. Challenged gender norms in a male art world, blending personal trauma with political symbolism. Married to Diego Rivera.",
    ocean: { openness: 0.95, conscientiousness: 0.5, extraversion: 0.7, agreeableness: 0.4, neuroticism: 0.9 },
    traitDetails: {
      openness: "Inventive symbolism in works like *The Two Fridas*, fusing folklore and autobiography amid miscarriages — maximal creative originality.",
      conscientiousness: "Erratic productivity due to chronic pain and tumultuous personal life; fewer than 200 works despite genius.",
      extraversion: "Vibrant social life hosting parties with Rivera and intellectuals; defiant, colorful public persona.",
      agreeableness: "Turbulent marriage with mutual infidelities; sharp-tongued diaries criticizing hypocrisy; fierce independence.",
      neuroticism: "Intense depictions of physical and psychological agony in art and letters; lifelong depression and emotional volatility.",
    },
    rationale: "Art historical analysis; personal diaries and letters; biographical studies.",
  },
  {
    id: "confucius",
    name: "Confucius",
    shortDescription: "Philosopher and teacher (Ancient China)",
    bio: "Developed Confucianism emphasizing moral integrity, social harmony, familial piety, and virtuous governance through personal example and ritual. His teachings in the *Analects* shaped East Asian culture, ethics, and governance for over two millennia.",
    ocean: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.6, agreeableness: 0.9, neuroticism: 0.3 },
    traitDetails: {
      openness: "Deep engagement with ancient rituals, poetry, and innovative ethical teachings that adapted traditions to foster moral intuition.",
      conscientiousness: "Relentless self-discipline, focus on ritual propriety (*li*), and dedication to public duty — 'forgetting to eat while solving problems.'",
      extraversion: "Moderately extraverted — spoke frankly with officials, traveled extensively to advise rulers, but preferred teaching small groups.",
      agreeableness: "Core ethic of *ren* (humaneness) and the Golden Rule; exceptional emphasis on empathy, compassion, and leading by example.",
      neuroticism: "Joyful absorption in learning ('forgets my worries'); composed amid rejection by rulers, maintaining optimism despite setbacks.",
    },
    rationale: "*Analects*; Britannica; Simply Knowledge; academic analyses of Confucian ethics.",
  },
  {
    id: "simon-bolivar",
    name: "Simón Bolívar",
    shortDescription: "Liberator and revolutionary (South America, 19th c.)",
    bio: "Led independence movements across South America, liberating Colombia, Venezuela, Ecuador, Peru, and Bolivia from Spanish rule (1810–1824). Known as 'El Libertador,' his vision of a united continent inspired republican ideals across Latin America.",
    ocean: { openness: 0.9, conscientiousness: 0.8, extraversion: 0.9, agreeableness: 0.4, neuroticism: 0.7 },
    traitDetails: {
      openness: "Visionary writings like the *Jamaica Letter* synthesized Enlightenment ideas, ancient republics, and American models into bold federal proposals.",
      conscientiousness: "Tireless campaigns through 15 years of warfare and persistent constitutional efforts despite defeats (Admirable Campaign of 1813).",
      extraversion: "Thrived as a charismatic orator — rallied armies with impassioned speeches at Angostura (1819); commanded through personal energy.",
      agreeableness: "Ruthless orders including executing prisoners during the 'War to the Death' (1813); prioritized ends over harmony.",
      neuroticism: "High emotional volatility — letters express despair over betrayals (Santander), profound grief after his wife's death, bitter late-life reflections.",
    },
    rationale: "*Jamaica Letter*; Britannica; EBSCO; biographical studies of the liberation campaigns.",
  },
  {
    id: "sitting-bull",
    name: "Sitting Bull",
    shortDescription: "Lakota leader and resistance figure (Indigenous Americas, 19th c.)",
    bio: "Hunkpapa Lakota leader and holy man who united tribes at the Battle of Little Bighorn (1876), overseeing Custer's defeat. His defiance symbolized Native American resistance to U.S. expansionism and the defense of Indigenous sovereignty.",
    ocean: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.8, agreeableness: 0.3, neuroticism: 0.5 },
    traitDetails: {
      openness: "Embraced visionary spirituality — prophetic dreams guided Little Bighorn tactics; later adopted the Ghost Dance movement.",
      conscientiousness: "Steadfast adherence to Lakota values, refusing treaties like Fort Laramie violations; decades of disciplined resistance.",
      extraversion: "Dynamic war chief and diplomat — energized warriors with speeches and rituals; later performed publicly in Wild West shows.",
      agreeableness: "Fierce opposition to assimilation; endorsed violence against encroachers; rejected compromise in defense of sovereignty.",
      neuroticism: "Calm under fire at Little Bighorn but growing frustration in exile; warnings of doom via visions amid reservation hardships.",
    },
    rationale: "NPS; historical accounts of Little Bighorn; biographical studies.",
  },
  {
    id: "sejong",
    name: "Sejong the Great",
    shortDescription: "King and scholar, creator of Hangul (Korea, 15th c.)",
    bio: "Fourth Joseon king of Korea (r. 1418–1450), created Hangul (the Korean alphabet) to boost literacy among commoners. His era advanced astronomy, agriculture, and military technology, establishing Korea as a cultural powerhouse.",
    ocean: { openness: 0.9, conscientiousness: 0.95, extraversion: 0.5, agreeableness: 0.85, neuroticism: 0.2 },
    traitDetails: {
      openness: "Invented Hangul from phonetic principles; patronized the Hall of Worthies; innovated rain gauges and armillary spheres.",
      conscientiousness: "Meticulous governance — compiled legal codes, funded crop research amid famines, personally oversaw 600+ scholarly projects.",
      extraversion: "Preferred scholarly seclusion and delegating via trusted officials; avoided public spectacle despite benevolent edicts.",
      agreeableness: "Tax relief for the poor, slave liberation experiments, and Hangul for the illiterate — deep compassion and equity.",
      neuroticism: "Steady leadership through crises (Japanese invasions, princely rebellions); personal poetry showing serene reflection.",
    },
    rationale: "Asia Society; Korean historical records; scholarly analyses of Joseon governance.",
  },
  {
    id: "tagore",
    name: "Rabindranath Tagore",
    shortDescription: "Poet and philosopher, Nobel laureate (India, 20th c.)",
    bio: "Bengali polymath — poet, novelist, musician, and philosopher — who won the 1913 Nobel Prize in Literature for *Gitanjali*. Founded Visva-Bharati University, critiqued British rule, and influenced global modernism through themes of humanism and spirituality.",
    ocean: { openness: 0.95, conscientiousness: 0.7, extraversion: 0.7, agreeableness: 0.9, neuroticism: 0.4 },
    traitDetails: {
      openness: "Prolific output — over 2,000 songs, plays blending East-West mysticism, experimental novels like *Gora*, and painting; universalist philosophy.",
      conscientiousness: "Dedicated to art and education (managing Shantiniketan rigorously), but bohemian lifestyle and impulsive travels temper rigidity.",
      extraversion: "Charismatic performer of his own works, global lecturer (1920s US/Europe tours), balanced by introspective writing retreats.",
      agreeableness: "Humanist essays advocating non-violence and interfaith harmony; renounced knighthood after the Amritsar Massacre (1919); profound empathy.",
      neuroticism: "Resilient amid deep personal losses (wife, daughters) and political disillusionment; serene poetry and late-life optimism.",
    },
    rationale: "Nobel biography; *Gitanjali*; tagoreanworld; academic studies of Bengali Renaissance.",
  },
];

export function listPresets(): readonly PersonalityPreset[] {
  return PRESETS;
}

export function getPreset(id: string): PersonalityPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function isPresetValid(preset: PersonalityPreset): boolean {
  if (!preset.id || !preset.name || !preset.shortDescription || !preset.bio || !preset.ocean || !preset.rationale || !preset.traitDetails) {
    return false;
  }
  const { ocean } = preset;
  const traits = ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"] as const;
  for (const t of traits) {
    const v = ocean[t];
    if (typeof v !== "number" || v < 0 || v > 1) return false;
  }
  return true;
}

/**
 * Apply a preset's OCEAN profile to state. Recomputes baseline and decay rates.
 * @throws if preset id is unknown
 */
export function applyPresetToState(state: EmotionEngineState, presetId: string): EmotionEngineState {
  const preset = getPreset(presetId);
  if (!preset) {
    throw new Error(`Unknown personality preset: ${presetId}`);
  }
  const personality = clampProfile(preset.ocean);
  const baseline = computeBaseline(personality);
  const decayRates = computeDimensionDecayRates(personality);
  const emotionDecayRates = computeEmotionDecayRates(personality);
  return {
    ...state,
    personality,
    baseline,
    decayRates,
    emotionDecayRates,
    meta: { ...state.meta, totalUpdates: state.meta.totalUpdates + 1 },
  };
}
