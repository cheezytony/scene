"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import type { Entity, Scene } from "@/lib/schema";
import { cameraAt, poseAt } from "@/lib/resolve";

const HEX = /^#[0-9a-fA-F]{6}$/;
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Billboard label drawn to a canvas texture. (drei's <Html> mounts a separate React root, which
 * triggers "unmount a root while React was already rendering" when scenes change.)
 */
function Label({ text, sub, selected, y }: { text: string; sub: string; selected: boolean; y: number }) {
  const tex = useMemo(() => {
    const font = "600 28px system-ui, sans-serif";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = font;
    const label = sub ? `${text}  ·  ${sub}` : text;
    const w = Math.ceil(ctx.measureText(label).width) + 28;
    const h = 46;
    canvas.width = w;
    canvas.height = h;
    ctx.font = font; // resizing a canvas resets its context
    ctx.fillStyle = selected ? "#ffffff" : "rgba(0,0,0,0.78)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 10);
    ctx.fill();
    ctx.fillStyle = selected ? "#000000" : "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 14, h / 2 + 1);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return { map, w, h };
  }, [text, sub, selected]);
  useEffect(() => () => tex.map.dispose(), [tex]);
  const k = 0.0042; // world meters per canvas pixel
  return (
    <sprite position={[0, y, 0]} scale={[tex.w * k, tex.h * k, 1]} raycast={() => null}>
      <spriteMaterial map={tex.map} transparent depthTest={false} />
    </sprite>
  );
}

function Actor({
  entity,
  scene,
  t,
  selected,
  onSelect,
}: {
  entity: Entity;
  scene: Scene;
  t: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const pose = poseAt(scene, entity, t);
  if (!pose) return null;
  const { x: w, y: h, z: d } = entity.size;
  const color = HEX.test(entity.color) ? entity.color : "#8892a6";
  const mat = (
    <meshStandardMaterial
      color={color}
      emissive={selected ? "#ffffff" : "#000000"}
      emissiveIntensity={selected ? 0.25 : 0}
    />
  );

  let body: React.ReactNode;
  switch (entity.proxy) {
    case "humanoid":
      body = (
        <>
          <mesh position={[0, h / 2, 0]}>
            <capsuleGeometry args={[Math.min(w, d) / 2, Math.max(h - Math.min(w, d), 0.1), 4, 12]} />
            {mat}
          </mesh>
          {/* nose cone shows facing (+z local) */}
          <mesh position={[0, h * 0.85, d / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.05, 0.15, 8]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </>
      );
      break;
    case "sphere":
      body = (
        <mesh position={[0, h / 2, 0]} scale={[w, h, d]}>
          <sphereGeometry args={[0.5, 24, 16]} />
          {mat}
        </mesh>
      );
      break;
    case "cylinder":
      body = (
        <mesh position={[0, h / 2, 0]} scale={[w, h, d]}>
          <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
          {mat}
        </mesh>
      );
      break;
    case "cone":
      body = (
        <mesh position={[0, h / 2, 0]} scale={[w, h, d]}>
          <coneGeometry args={[0.5, 1, 24]} />
          {mat}
        </mesh>
      );
      break;
    default:
      body = (
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w, h, d]} />
          {mat}
        </mesh>
      );
  }

  return (
    <group
      position={[pose.position.x, pose.position.y, pose.position.z]}
      rotation={[0, rad(pose.rotationY), 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {body}
      <Label y={h + 0.3} text={entity.name} sub={pose.state.replaceAll("_", " ")} selected={selected} />
    </group>
  );
}

/** Drives the viewport camera from the scene's camera setups (shot view). */
function CameraRig({ scene, t }: { scene: Scene; t: number }) {
  useFrame(({ camera }) => {
    const pose = cameraAt(scene, t);
    if (!pose) return;
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(pose.position.x, pose.position.y, pose.position.z);
    cam.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    cam.fov = pose.fov;
    cam.updateProjectionMatrix();
  });
  return null;
}

/** Small camera props at each setup so you can see coverage from the free view. */
function CameraMarkers({ scene, t }: { scene: Scene; t: number }) {
  const active = cameraAt(scene, t)?.camera.id;
  return (
    <>
      {scene.cameras.map((c) => (
        <group
          key={c.id}
          position={[c.position.x, c.position.y, c.position.z]}
          ref={(g) => g?.lookAt(c.lookAt.x, c.lookAt.y, c.lookAt.z)}
        >
          <mesh>
            <boxGeometry args={[0.3, 0.2, 0.3]} />
            <meshStandardMaterial color={c.id === active ? "#fbbf24" : "#64748b"} />
          </mesh>
          <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.08, 0.12, 0.18, 12]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
        </group>
      ))}
    </>
  );
}

export default function SceneViewer({
  scene,
  t,
  selectedId,
  onSelect,
  viewMode,
}: {
  scene: Scene;
  t: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  viewMode: "orbit" | "shot";
}) {
  const shot = viewMode === "shot" && scene.cameras.length > 0;
  return (
    <Canvas camera={{ position: [8, 6, 10], fov: 45 }} onPointerMissed={() => onSelect(null)}>
      <color attach="background" args={["#0e1117"]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 10, 4]} intensity={1.6} />
      <Grid
        args={[24, 24]}
        cellSize={1}
        sectionSize={4}
        cellColor="#2a3140"
        sectionColor="#4a5570"
        fadeDistance={40}
        infiniteGrid
      />
      {scene.entities.map((e) => (
        <Actor
          key={e.id}
          entity={e}
          scene={scene}
          t={t}
          selected={e.id === selectedId}
          onSelect={() => onSelect(e.id)}
        />
      ))}
      {shot ? (
        <CameraRig scene={scene} t={t} />
      ) : (
        <>
          <CameraMarkers scene={scene} t={t} />
          <OrbitControls makeDefault target={[0, 1, 0]} maxPolarAngle={Math.PI / 2.05} />
        </>
      )}
    </Canvas>
  );
}
