import { strToU8, zipSync } from 'fflate';
import { BODY_LABEL, CONTENT_TYPES, RELS, escapeXml, meshXml } from './threemf';
import type { Body, BodyName } from './types';

/**
 * Fixed filament slot per color, identical on every tile of a set, so a
 * multi-tile trip prints with one AMS setup (route is always slot 6 etc.)
 * even when a tile lacks some bodies.
 */
export const BAMBU_EXTRUDER: Record<BodyName, number> = {
  base: 1,
  water: 2,
  grass: 3,
  rock: 4,
  snow: 5,
  route: 6,
  marker: 0, // negative part — no filament slot
};

/**
 * Bambu Studio project 3MF: same component-structured geometry as the
 * vanilla export, plus the two things Bambu Studio actually reads
 * (verified against BambuStudio's bbs_3mf.cpp importer):
 *
 * - `<metadata name="Application">BambuStudio-…` marks the file as a Bambu
 *   project so it opens with settings instead of "geometry only";
 * - `Metadata/model_settings.config` assigns each part (matched by its
 *   component object id) an `extruder`, i.e. an AMS filament slot — the
 *   zero-click part→filament mapping.
 *
 * Deliberately NOT included: `Metadata/project_settings.config` (a full
 * printer/print/filament preset dump) — shipping one would override the
 * user's own printer profile. Filament colors follow whatever is loaded
 * in the user's AMS slots.
 */
export function writeBambu3MF(allBodies: Body[], title: string): Blob {
  // 'marker' is a viewer-only preview plug — pockets are modeled directly
  // into the route body, so nothing special is needed slicer-side
  const bodies = allBodies.filter((b) => b.name !== 'marker');
  const wrapperId = bodies.length + 2;

  const model: string[] = [];
  model.push('<?xml version="1.0" encoding="UTF-8"?>');
  model.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
  );
  model.push(' <metadata name="Application">BambuStudio-01.10.00.89</metadata>');
  model.push(' <metadata name="BambuStudio:3mfVersion">1</metadata>');
  model.push(` <metadata name="Title">${escapeXml(title)}</metadata>`);
  model.push(' <resources>');
  bodies.forEach((body, bi) => {
    model.push(`  <object id="${bi + 2}" type="model" name="${BODY_LABEL[body.name]}">`);
    model.push(meshXml(body));
    model.push('  </object>');
  });
  model.push(`  <object id="${wrapperId}" type="model" name="${escapeXml(title)}">`);
  model.push('   <components>');
  bodies.forEach((_, bi) => {
    model.push(`    <component objectid="${bi + 2}"/>`);
  });
  model.push('   </components>');
  model.push('  </object>');
  model.push(' </resources>');
  model.push(' <build>');
  model.push(`  <item objectid="${wrapperId}" printable="1"/>`);
  model.push(' </build>');
  model.push('</model>');

  const config: string[] = [];
  config.push('<?xml version="1.0" encoding="UTF-8"?>');
  config.push('<config>');
  config.push(`  <object id="${wrapperId}">`);
  config.push(`    <metadata key="name" value="${escapeXml(title)}"/>`);
  bodies.forEach((body, bi) => {
    config.push(`    <part id="${bi + 2}" subtype="normal_part">`);
    config.push(`      <metadata key="name" value="${BODY_LABEL[body.name]}"/>`);
    config.push(`      <metadata key="extruder" value="${BAMBU_EXTRUDER[body.name]}"/>`);
    config.push('    </part>');
  });
  config.push('  </object>');
  config.push('  <plate>');
  config.push('    <metadata key="plater_id" value="1"/>');
  config.push('    <model_instance>');
  config.push(`      <metadata key="object_id" value="${wrapperId}"/>`);
  config.push('      <metadata key="instance_id" value="0"/>');
  config.push('    </model_instance>');
  config.push('  </plate>');
  config.push('</config>');

  const zipped = zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(RELS),
      '3D/3dmodel.model': strToU8(model.join('\n')),
      'Metadata/model_settings.config': strToU8(config.join('\n')),
    },
    { level: 6 }
  );
  return new Blob([zipped.buffer as ArrayBuffer], {
    type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  });
}
