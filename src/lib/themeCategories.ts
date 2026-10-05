import type { Theme } from '../types'

export type ThemeCategoryId =
  | 'children_youth'
  | 'parents'
  | 'marriage'
  | 'family'
  | 'creation'
  | 'jehovah'
  | 'jesus'
  | 'prophecy'
  | 'future'
  | 'death_resurrection'
  | 'bible'
  | 'kingdom'
  | 'worship_prayer'
  | 'ministry'
  | 'christian_living'
  | 'faith_hope'

export type ThemeCategory = {
  id: ThemeCategoryId
  label: string
  /** Matched against theme name (and number as text). */
  patterns: RegExp[]
}

/**
 * Topic buckets derived from Kierros 6 outline titles.
 * A theme may belong to several categories.
 */
export const THEME_CATEGORIES: ThemeCategory[] = [
  {
    id: 'children_youth',
    label: 'Lapset ja nuoret',
    patterns: [
      /\blaps/i,
      /\bnuor/i,
      /kasvat/i,
      /koulutus/i,
      /teini/i,
    ],
  },
  {
    id: 'parents',
    label: 'Vanhemmat',
    patterns: [/\bvanhem/i, /lasten kasvatt/i],
  },
  {
    id: 'marriage',
    label: 'Avioliitto',
    patterns: [/avioliit/i, /aviopuol/i, /puoliso/i, /\bseks/i],
  },
  {
    id: 'family',
    label: 'Perhe',
    patterns: [/\bperhe/i, /perhe-eläm/i, /kommunikointia perheessä/i],
  },
  {
    id: 'creation',
    label: 'Luomakunta',
    patterns: [
      /luomakun/i,
      /luomiste/i,
      /luonto/i,
      /maapallo/i,
      /puhdas maa/i,
      /ympärist/i,
      /todisteita jumalasta ympär/i,
    ],
  },
  {
    id: 'jehovah',
    label: 'Jehova',
    patterns: [/jehova/i],
  },
  {
    id: 'jesus',
    label: 'Jeesus',
    patterns: [/jeesus/i, /kristus/i, /messias/i, /jeesuksen/i],
  },
  {
    id: 'prophecy',
    label: 'Raamatun ennustukset',
    patterns: [
      /ennust/i,
      /profeti/i,
      /ilmestyskir/i,
      /viimeisistä päivistä/i,
      /viimeiset päivät/i,
      /lähitulevaisuudessa/i,
    ],
  },
  {
    id: 'future',
    label: 'Tulevaisuus',
    patterns: [
      /tulevaisu/i,
      /ikuisesti/i,
      /ikuinen/i,
      /maailmanlop/i,
      /paratiisi/i,
      /uusi maa/i,
      /uusi maailma/i,
      /maa pysyy/i,
    ],
  },
  {
    id: 'death_resurrection',
    label: 'Kuolema ja ylösnousemus',
    patterns: [/kuole/i, /ylösnous/i, /haud/i],
  },
  {
    id: 'bible',
    label: 'Raamattu',
    patterns: [
      /raamat/i,
      /jumalan sana/i,
      /pyhä kirja/i,
      /kuuntele jumalan sanaa/i,
    ],
  },
  {
    id: 'kingdom',
    label: 'Jumalan valtakunta',
    patterns: [
      /valtakun/i,
      /maailman hallitsija/i,
      /jumalasta tulee maailman/i,
      /jehovan valtaa/i,
    ],
  },
  {
    id: 'worship_prayer',
    label: 'Rukous ja palvonta',
    patterns: [/rukou/i, /palvont/i, /palvelem/i, /kokouk/i],
  },
  {
    id: 'ministry',
    label: 'Evankeliointi',
    patterns: [
      /evankelio/i,
      /saarna/i,
      /hyvä(?:än)? uutis/i,
      /sadonkorjuu/i,
      /kenttäpalvel/i,
    ],
  },
  {
    id: 'faith_hope',
    label: 'Usko ja toivo',
    patterns: [/\busko/i, /luottamu/i, /\btoivo/i, /uskollis/i],
  },
  {
    id: 'christian_living',
    label: 'Kristitty elämä',
    patterns: [
      /rehell/i,
      /puhtau/i,
      /rakka/i,
      /anteeksi/i,
      /vieraanvar/i,
      /hyviä ratkaisu/i,
      /elämän huol/i,
      /maailman henke/i,
      /kristity/i,
      /seuraaja/i,
    ],
  },
]

export function themeMatchesCategory(
  theme: Pick<Theme, 'name' | 'number'>,
  categoryId: ThemeCategoryId,
): boolean {
  const cat = THEME_CATEGORIES.find((c) => c.id === categoryId)
  if (!cat) return false
  const hay = `${theme.number} ${theme.name}`
  return cat.patterns.some((re) => re.test(hay))
}

export function themesInCategory(
  themes: Theme[],
  categoryId: ThemeCategoryId,
): Theme[] {
  return themes.filter((t) => themeMatchesCategory(t, categoryId))
}

export function categoryCounts(
  themes: Theme[],
): Array<{ id: ThemeCategoryId; label: string; count: number }> {
  return THEME_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    count: themes.filter(
      (t) => !t.disabled && themeMatchesCategory(t, c.id),
    ).length,
  })).filter((c) => c.count > 0)
}
