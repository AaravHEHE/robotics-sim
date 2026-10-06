// The VEX parts catalog (data/parts/vex-parts.json), shared by the parts kit and the robots
// drawn from their profiles.

import catalogJson from '../../../data/parts/vex-parts.json';
import type { Catalog, PartDef } from './assembly.ts';

export const CATALOG = catalogJson as unknown as Catalog;

export function partDef(id: string): PartDef {
  const d = CATALOG.parts.find((x) => x.id === id);
  if (!d) throw new Error(`No part "${id}" in the catalog.`);
  return d;
}
