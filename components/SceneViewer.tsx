"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import type { Entity, Scene } from "@/lib/schema";
import { cameraAt, worldPose } from "@/lib/resolve";
import { EYE_HEIGHT, FLOOR_CLEARANCE, moveSpeed, type Bounds } from "@/lib/space";
import type { ViewerSettings } from "@/lib/viewer-settings";

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
  const pose = worldPose(scene, entity, t);  if (!pose) return null;
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

const FREE_VIEW_FOV = 45;

/** Restores the free-view field of view after the camera rig has changed it. */
function FovReset() {
  useFrame(({ camera }) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== FREE_VIEW_FOV) {
      cam.fov = FREE_VIEW_FOV;
      cam.updateProjectionMatrix();
    }
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

/** The bounds as THREE vectors, rebuilt only when the bounds change. */
function useBoundsBox(bounds: Bounds) {
  return useMemo(
    () => ({
      min: new THREE.Vector3(bounds.min.x, Math.max(bounds.min.y, FLOOR_CLEARANCE), bounds.min.z),
      max: new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
    }),
    [bounds],
  );
}

/** Faint wireframe showing the limits of the space while boundaries are on. */
function BoundsBox({ bounds }: { bounds: Bounds }) {
  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z,
    );
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [bounds]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments
      geometry={geometry}
      position={[
        (bounds.min.x + bounds.max.x) / 2,
        (bounds.min.y + bounds.max.y) / 2,
        (bounds.min.z + bounds.max.z) / 2,
      ]}
      raycast={() => null}
    >
      <lineBasicMaterial color="#334155" transparent opacity={0.6} />
    </lineSegments>
  );
}

/** Orbit navigation. With boundaries on, the camera and its focus point are kept inside the space. */
function OrbitRig({ settings, bounds }: { settings: ViewerSettings; bounds: Bounds }) {
  const controls = useRef<React.ElementRef<typeof OrbitControls>>(null);
  const box = useBoundsBox(bounds);
  const diagonal = box.min.distanceTo(box.max);
  const bounded = settings.boundaries;
  useFrame(({ camera }) => {
    if (!bounded || !controls.current) return;
    controls.current.target.clamp(box.min, box.max);
    camera.position.clamp(box.min, box.max);
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 1, 0]}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={0.5}
      maxDistance={bounded ? diagonal : Infinity}
    />
  );
}

const MOVE_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Space", "KeyC", "ShiftLeft", "ShiftRight",
]);

/**
 * Walk (locked to eye height) and fly (free vertical movement) navigation: drag to look, WASD or
 * arrows to move, Shift to sprint, Space / C to rise and sink while flying.
 */
function FirstPersonRig({
  mode,
  settings,
  bounds,
  container,
}: {
  mode: "walk" | "fly";
  settings: ViewerSettings;
  bounds: Bounds;
  /** The focusable wrapper element that receives keyboard and pointer input. */
  container: React.RefObject<HTMLDivElement | null>;
}) {
  const box = useBoundsBox(bounds);
  const input = useRef({ keys: new Set<string>(), yaw: 0, pitch: 0, dragging: false });

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const inp = input.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!MOVE_KEYS.has(e.code)) return;
      e.preventDefault(); // keep arrows and space from scrolling the page
      inp.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => inp.keys.delete(e.code);
    const onBlur = () => {
      inp.keys.clear();
      inp.dragging = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      el.focus();
      inp.dragging = true;
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!inp.dragging) return;
      inp.yaw -= e.movementX * 0.004;
      inp.pitch = Math.min(Math.max(inp.pitch - e.movementY * 0.004, -1.5), 1.5);
    };
    const onPointerUp = () => {
      inp.dragging = false;
    };
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("keyup", onKeyUp);
    el.addEventListener("blur", onBlur);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    return () => {
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", onKeyUp);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
    };
  }, [container]);
  const speed = moveSpeed(bounds, settings.speed);
  const adopted = useRef(false);
  const scratch = useRef({
    move: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    euler: new THREE.Euler(),
  });

  useFrame(({ camera }, delta) => {
    const inp = input.current;
    const s = scratch.current;
    if (!adopted.current) {
      // Start from wherever the camera is looking now, so switching modes doesn't jump.
      s.euler.setFromQuaternion(camera.quaternion, "YXZ");
      inp.yaw = s.euler.y;
      inp.pitch = s.euler.x;
      adopted.current = true;
    }
    camera.rotation.order = "YXZ";
    camera.rotation.set(inp.pitch, inp.yaw, 0);

    const down = (...codes: string[]) => codes.some((c) => inp.keys.has(c));
    const forward = Number(down("KeyW", "ArrowUp")) - Number(down("KeyS", "ArrowDown"));
    const strafe = Number(down("KeyD", "ArrowRight")) - Number(down("KeyA", "ArrowLeft"));
    const rise = mode === "fly" ? Number(down("Space")) - Number(down("KeyC")) : 0;

    const dt = Math.min(delta, 0.1);
    s.move.set(0, rise, 0);
    if (mode === "fly") s.forward.set(0, 0, -1).applyEuler(camera.rotation);
    else s.forward.set(-Math.sin(inp.yaw), 0, -Math.cos(inp.yaw));
    s.right.set(Math.cos(inp.yaw), 0, -Math.sin(inp.yaw));
    s.move.addScaledVector(s.forward, forward).addScaledVector(s.right, strafe);
    if (s.move.lengthSq() > 0) {
      const boost = down("ShiftLeft", "ShiftRight") ? 2 : 1;
      camera.position.addScaledVector(s.move.normalize(), speed * boost * dt);
    }
    if (mode === "walk") camera.position.y = EYE_HEIGHT;
    if (settings.boundaries) camera.position.clamp(box.min, box.max);
  });
  return null;
}

export default function SceneViewer({
  scene,
  t,
  selectedId,
  onSelect,
  viewMode,
  settings,
  bounds,
}: {
  scene: Scene;
  t: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  viewMode: "orbit" | "shot";
  settings: ViewerSettings;
  bounds: Bounds;
}) {
  const shot = viewMode === "shot" && scene.cameras.length > 0;
  const firstPerson = !shot && settings.movement !== "orbit";
  const container = useRef<HTMLDivElement>(null);

  return (
    <div ref={container} className="h-full w-full outline-none" tabIndex={0}>
      <Canvas
        // Orbit and shot views only draw when something changes; walking and flying need every frame.
        frameloop={firstPerson ? "always" : "demand"}
        dpr={[1, 2]}
        camera={{ position: [8, 6, 10], fov: FREE_VIEW_FOV }}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={["#0e1117"]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[6, 10, 4]} intensity={1.6} />
        {settings.grid && (
          <Grid
            args={[24, 24]}
            cellSize={1}
            sectionSize={4}
            cellColor="#2a3140"
            sectionColor="#4a5570"
            fadeDistance={40}
            infiniteGrid
          />
        )}
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
            <FovReset />
            <CameraMarkers scene={scene} t={t} />
            {settings.boundaries && <BoundsBox bounds={bounds} />}
            {settings.movement === "orbit" ? (
              <OrbitRig settings={settings} bounds={bounds} />
            ) : (
              <FirstPersonRig key={settings.movement} mode={settings.movement} settings={settings} bounds={bounds} container={container} />
            )}
          </>
        )}
      </Canvas>
    </div>
  );
}
