import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Body, BodyName } from './lib/types';

export type TilePlacement = {
  bodies: Body[];
  /** mm offsets of the tile's SW corner within the trip layout */
  x: number;
  y: number;
};

type Props = {
  /** Tiles at their geographic positions (map-aligned) */
  tiles: TilePlacement[];
  colors: Record<BodyName, string>;
  widthMM: number;
  depthMM: number;
  heightMM: number;
};

function BodyMesh({ body, color }: { body: Body; color: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(body.positions, 3));
    if (body.normals) {
      g.setAttribute('normal', new THREE.BufferAttribute(body.normals, 3));
    } else {
      g.computeVertexNormals(); // non-indexed → face normals → crisp flat shading
    }
    return g;
  }, [body]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} roughness={0.85} metalness={0} />
    </mesh>
  );
}

/**
 * Reframe the camera when the scene footprint changes (tiles added/removed,
 * shape/width changed) — the Canvas camera prop is initial-only.
 */
function CameraRig({ camDist }: { camDist: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    // Mutating the three.js camera is the idiomatic R3F escape hatch here
    camera.position.set(0, camDist * 0.75, camDist);
    // eslint-disable-next-line react-hooks/immutability
    camera.far = camDist * 20;
    camera.updateProjectionMatrix();
  }, [camera, camDist]);
  return null;
}

export default function Viewer({ tiles, colors, widthMM, depthMM, heightMM }: Props) {
  const extentX = Math.max(...tiles.map((t) => t.x)) + widthMM;
  const extentY = Math.max(...tiles.map((t) => t.y)) + depthMM;
  const camDist = Math.max(extentX, extentY) * 1.15;

  return (
    <Canvas
      camera={{ position: [0, camDist * 0.75, camDist], fov: 42, near: 1, far: camDist * 20 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#16181d']} />
      <CameraRig camDist={camDist} />
      <hemisphereLight intensity={0.5} color="#ffffff" groundColor="#404040" />
      <directionalLight position={[camDist, camDist * 1.2, camDist * 0.6]} intensity={1.6} />
      <directionalLight position={[-camDist, camDist * 0.5, -camDist * 0.4]} intensity={0.4} />
      {/* Models are built Z-up in mm; rotate to Y-up and center the layout */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {tiles.map((tile, t) => (
          <group key={t} position={[tile.x - extentX / 2, tile.y - extentY / 2, 0]}>
            {tile.bodies.map((body) => (
              <BodyMesh key={body.name} body={body} color={colors[body.name]} />
            ))}
          </group>
        ))}
      </group>
      <OrbitControls target={[0, heightMM / 3, 0]} maxPolarAngle={Math.PI * 0.55} makeDefault />
    </Canvas>
  );
}
