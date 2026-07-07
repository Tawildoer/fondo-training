import { strToU8, zipSync } from 'fflate';
import type { Body, BodyName } from './types';

export const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

export const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

export const BODY_LABEL: Record<BodyName, string> = {
  base: 'Base',
  water: 'Water',
  grass: 'Land',
  rock: 'Rock',
  snow: 'Snow',
  route: 'Route',
  marker: 'Marker sockets (negative)',
};

/** `<mesh>` block with deduplicated vertices (rounded to 1 µm so corners weld) */
export function meshXml(body: Body): string {
  const vertexIndex = new Map<string, number>();
  const verts: string[] = [];
  const tris: string[] = [];
  const pos = body.positions;
  const idx = new Uint32Array(pos.length / 3);

  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3].toFixed(3);
    const y = pos[v * 3 + 1].toFixed(3);
    const z = pos[v * 3 + 2].toFixed(3);
    const k = `${x},${y},${z}`;
    let vi = vertexIndex.get(k);
    if (vi === undefined) {
      vi = verts.length;
      vertexIndex.set(k, vi);
      verts.push(`    <vertex x="${x}" y="${y}" z="${z}"/>`);
    }
    idx[v] = vi;
  }
  for (let t = 0; t < idx.length; t += 3) {
    tris.push(`    <triangle v1="${idx[t]}" v2="${idx[t + 1]}" v3="${idx[t + 2]}"/>`);
  }

  return [
    '   <mesh>',
    '   <vertices>',
    verts.join('\n'),
    '   </vertices>',
    '   <triangles>',
    tris.join('\n'),
    '   </triangles>',
    '   </mesh>',
  ].join('\n');
}

/**
 * Write a multi-body 3MF: one mesh <object> per color body, all referenced
 * as <components> of a single build item. The single item is critical — if
 * each body were its own build item, slicers would treat them as six
 * independent objects and auto-arrange (translate/rotate!) them apart.
 * As components they import as one model with a filament per part.
 * Vertices are deduplicated per body.
 */
export function writeThreeMF(allBodies: Body[], colors: Record<BodyName, string>, title: string): Blob {
  // 'marker' is a viewer-only preview plug; the pocket is real geometry in
  // the route body, so exports must not include the plug
  const bodies = allBodies.filter((b) => b.name !== 'marker');
  const xml: string[] = [];
  xml.push('<?xml version="1.0" encoding="UTF-8"?>');
  xml.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">'
  );
  xml.push(` <metadata name="Title">${escapeXml(title)}</metadata>`);
  xml.push(' <metadata name="Application">strava3dp</metadata>');
  xml.push(' <resources>');

  xml.push('  <basematerials id="1">');
  for (const body of bodies) {
    const color = (colors[body.name] ?? '#cccccc').toUpperCase();
    xml.push(`   <base name="${BODY_LABEL[body.name]}" displaycolor="${color}FF"/>`);
  }
  xml.push('  </basematerials>');

  bodies.forEach((body, bi) => {
    const objectId = bi + 2; // id 1 is the material group
    xml.push(
      `  <object id="${objectId}" type="model" pid="1" pindex="${bi}" name="${BODY_LABEL[body.name]}">`
    );
    xml.push(meshXml(body));
    xml.push('  </object>');
  });

  const wrapperId = bodies.length + 2;
  xml.push(`  <object id="${wrapperId}" type="model" name="${escapeXml(title)}">`);
  xml.push('   <components>');
  bodies.forEach((_, bi) => {
    xml.push(`    <component objectid="${bi + 2}"/>`);
  });
  xml.push('   </components>');
  xml.push('  </object>');
  xml.push(' </resources>');
  xml.push(' <build>');
  xml.push(`  <item objectid="${wrapperId}"/>`);
  xml.push(' </build>');
  xml.push('</model>');

  const zipped = zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(RELS),
      '3D/3dmodel.model': strToU8(xml.join('\n')),
    },
    { level: 6 }
  );
  return new Blob([zipped.buffer as ArrayBuffer], {
    type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  });
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!));
}
