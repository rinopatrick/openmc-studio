import type { ReactorModel } from '@openmc-studio/schema';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useMemo } from 'react';

interface Geometry3DViewerProps {
  model: ReactorModel;
}

type Shape = {
  id: string;
  kind: 'box' | 'hex' | 'cylinder' | 'sphere';
  position: [number, number, number];
  size: [number, number, number];
  radius?: number;
  color: string;
  wireframe?: boolean;
  rotation?: [number, number, number];
};

const colors = ['#5eead4', '#38bdf8', '#f59e0b', '#a78bfa', '#f97316', '#22c55e', '#f43f5e'];

export function Geometry3DViewer({ model }: Geometry3DViewerProps) {
  const shapes = useMemo(() => buildShapes(model), [model]);

  return (
    <div className="geometry-3d-shell">
      <Canvas camera={{ position: [24, 20, 24], fov: 45 }}>
        <color attach="background" args={['#08111f']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[20, 24, 12]} intensity={0.7} />
        <gridHelper args={[80, 40, '#28435f', '#1b2b3f']} position={[0, -0.01, 0]} />
        <axesHelper args={[8]} />

        {shapes.map((shape) => (
          <mesh key={shape.id} position={shape.position} rotation={shape.rotation ?? [0, 0, 0]}>
            {shape.kind === 'box' && <boxGeometry args={shape.size} />}
            {shape.kind === 'hex' && <cylinderGeometry args={[shape.radius ?? 0.6, shape.radius ?? 0.6, shape.size[1], 6]} />}
            {shape.kind === 'cylinder' && <cylinderGeometry args={[shape.radius ?? 0.6, shape.radius ?? 0.6, shape.size[1], 24]} />}
            {shape.kind === 'sphere' && <sphereGeometry args={[shape.radius ?? 1, 24, 24]} />}
            <meshStandardMaterial color={shape.color} wireframe={Boolean(shape.wireframe)} opacity={shape.wireframe ? 1 : 0.45} transparent={!shape.wireframe} />
          </mesh>
        ))}

        <OrbitControls makeDefault enablePan enableZoom enableRotate />
      </Canvas>
    </div>
  );
}

function buildShapes(model: ReactorModel): Shape[] {
  const shapes: Shape[] = [];
  const components = model.components;

  if (components?.coreLayout) {
    const { coreLayout, assemblyTypes } = components;
    const pitch = Math.max(1, coreLayout.assemblyPitch / 8);
    const originX = -((coreLayout.columns - 1) * pitch) / 2;
    const originZ = -((coreLayout.rows - 1) * pitch) / 2;

    coreLayout.assemblyMap.forEach((row, rIdx) => {
      row.forEach((asmId, cIdx) => {
        const asm = assemblyTypes.find((a) => a.id === asmId);
        if (!asm) return;
        const color = colors[(rIdx + cIdx) % colors.length];
        shapes.push({
          id: `core-${rIdx}-${cIdx}`,
          kind: asm.latticeKind === 'hex' ? 'hex' : 'box',
          position: [originX + cIdx * pitch, 1.4, originZ + rIdx * pitch],
          size: [pitch * 0.9, 2.8, pitch * 0.9],
          radius: pitch * 0.52,
          color,
        });
      });
    });
  }

  for (const [latIdx, lattice] of model.lattices.entries()) {
    const rows = lattice.map.length;
    const cols = Math.max(1, ...lattice.map.map((row) => row.length));
    const pitch = Math.max(0.8, lattice.pitch?.value ?? 1.4);
    const baseY = -2 - latIdx * 1.3;
    const ox = -((cols - 1) * pitch) / 2;
    const oz = -((rows - 1) * pitch) / 2;

    lattice.map.forEach((row, rIdx) => {
      for (let cIdx = 0; cIdx < cols; cIdx += 1) {
        if (!(row[cIdx] ?? '').trim()) continue;
        const color = colors[(latIdx + rIdx + cIdx) % colors.length];
        shapes.push({
          id: `lat-${latIdx}-${rIdx}-${cIdx}`,
          kind: lattice.kind === 'hex' ? 'hex' : 'box',
          position: [ox + cIdx * pitch, baseY, oz + rIdx * pitch],
          size: [pitch * 0.82, 0.65, pitch * 0.82],
          radius: pitch * 0.48,
          color,
        });
      }
    });
  }

  if (model.openmcGeometry) {
    const span = 18;
    model.openmcGeometry.surfaces.forEach((surface, index) => {
      const coeffs = surface.coeffs;
      const color = '#93c5fd';
      if (surface.type === 'x-plane') {
        shapes.push({ id: `surf-${surface.id}`, kind: 'box', position: [coeffs[0] ?? 0, 0, 0], size: [0.08, span, span], color, wireframe: true });
      } else if (surface.type === 'y-plane') {
        shapes.push({ id: `surf-${surface.id}`, kind: 'box', position: [0, coeffs[0] ?? 0, 0], size: [span, 0.08, span], color, wireframe: true });
      } else if (surface.type === 'z-plane') {
        shapes.push({ id: `surf-${surface.id}`, kind: 'box', position: [0, 0, coeffs[0] ?? 0], size: [span, span, 0.08], color, wireframe: true });
      } else if (surface.type === 'sphere') {
        shapes.push({
          id: `surf-${surface.id}`,
          kind: 'sphere',
          position: [coeffs[0] ?? 0, coeffs[1] ?? 0, coeffs[2] ?? 0],
          size: [1, 1, 1],
          radius: Math.max(0.2, coeffs[3] ?? 1),
          color,
          wireframe: true,
        });
      } else if (surface.type === 'z-cylinder' || surface.type === 'x-cylinder' || surface.type === 'y-cylinder') {
        const pos: [number, number, number] = [coeffs[0] ?? 0, coeffs[1] ?? 0, 0];
        const rotation: [number, number, number] = surface.type === 'x-cylinder' ? [0, 0, Math.PI / 2] : surface.type === 'y-cylinder' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
        shapes.push({
          id: `surf-${surface.id}`,
          kind: 'cylinder',
          position: pos,
          size: [1, span, 1],
          radius: Math.max(0.15, coeffs[2] ?? 0.5),
          color,
          wireframe: true,
          rotation,
        });
      } else {
        shapes.push({
          id: `surf-fallback-${surface.id}`,
          kind: 'box',
          position: [0, -5 - index * 0.2, 0],
          size: [2, 0.05, 2],
          color,
          wireframe: true,
        });
      }
    });
  }

  if (shapes.length === 0) {
    shapes.push({ id: 'fallback-box', kind: 'box', position: [0, 1, 0], size: [6, 2, 6], color: '#5eead4', wireframe: true });
  }

  return shapes;
}
