// Splitting a big STEP assembly so the in-browser reader can hold each piece.
import { describe, expect, it } from 'vitest';
import { splitStep } from '../src/app/step-split.ts';

/** Two parts, each a solid with its own geometry, colored by styled items in one presentation. */
const STEP = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('test'),'2;1');
ENDSEC;
DATA;
#1 = CARTESIAN_POINT ( 'NONE', ( 0.0, 0.0, 0.0 ) ) ;
#2 = VERTEX_POINT ( 'NONE', #1 ) ;
#3 = CLOSED_SHELL ( 'NONE', ( #2 ) ) ;
#4 = MANIFOLD_SOLID_BREP ( 'part a', #3 ) ;
#5 = CARTESIAN_POINT ( 'NONE', ( 1.0, 0.0, 0.0 ) ) ;
#6 = VERTEX_POINT ( 'NONE', #5 ) ;
#7 = CLOSED_SHELL ( 'NONE', ( #6 ) ) ;
#8 = MANIFOLD_SOLID_BREP ( 'part b', #7 ) ;
#9 = ADVANCED_BREP_SHAPE_REPRESENTATION ( 'a', ( #4, #20 ), #30 ) ;
#10 = ADVANCED_BREP_SHAPE_REPRESENTATION ( 'b', ( #8, #20 ), #30 ) ;
#11 = STYLED_ITEM ( 'color', ( #40 ), #4 ) ;
#12 = STYLED_ITEM ( 'color', ( #40 ), #8 ) ;
#13 = MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION ( '', ( #11, #12 ), #30 ) ;
#20 = AXIS2_PLACEMENT_3D ( 'NONE', #1, $, $ ) ;
#30 = GEOMETRIC_REPRESENTATION_CONTEXT ( 3 ) ;
#40 = PRESENTATION_STYLE_ASSIGNMENT ( ( ) ) ;
ENDSEC;
END-ISO-10303-21;
`;

const ids = (chunk: string) => new Set([...chunk.matchAll(/^#(\d+) =/gm)].map((m) => Number(m[1])));
const entity = (chunk: string, id: number) => new RegExp(`^#${id} =[^;]*`, 'm').exec(chunk)?.[0] ?? '';

describe('splitting a STEP file', () => {
  it('a small file stays whole', () => {
    expect(splitStep(STEP)).toEqual([STEP]);
  });

  it('each chunk keeps the assembly but only its own parts’ geometry, and nothing dangles', () => {
    const chunks = splitStep(STEP, 3);
    expect(chunks).toHaveLength(2);
    for (const c of chunks) {
      const have = ids(c);
      // every reference resolves
      for (const m of c.matchAll(/#(\d+)/g)) expect(have.has(Number(m[1])), `#${m[1]} in chunk`).toBe(true);
      // the shared placement, context and styles stay in every chunk
      for (const shared of [9, 10, 20, 30, 40]) expect(have.has(shared)).toBe(true);
      expect(c.startsWith('ISO-10303-21;')).toBe(true);
      expect(c.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
    }
    const [a, b] = chunks[0].includes("'part a'") ? chunks : [chunks[1], chunks[0]];
    expect(a).not.toContain("'part b'");
    expect(b).not.toContain("'part a'");
    // the other part's solid is dropped from its representation, and its color with it
    expect(entity(a, 10)).toMatch(/\(\s*#20\s*\)/);
    expect(ids(a).has(12)).toBe(false);
    expect(entity(a, 13)).toMatch(/\(\s*#11\s*\)/);
    // the point shared through the placement (#1 is part a's vertex too) stays in b's chunk
    expect(ids(b).has(1)).toBe(true);
  });
});
