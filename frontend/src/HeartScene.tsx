import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Pause, Play, RotateCcw } from "lucide-react";
import * as THREE from "three";

type Structure =
  | "myocardium"
  | "right-atrium"
  | "left-atrium"
  | "right-ventricle"
  | "left-ventricle"
  | "aorta"
  | "vena-cava"
  | "pulmonary-trunk"
  | "pulmonary-veins"
  | "coronary-arteries"
  | "coronary-veins";

type ViewPreset = "Anterior" | "Posterior" | "Left lateral" | "Right lateral";

type Waveform = {
  times: number[];
  values: number[];
  unit: string;
  peaks: number[];
  sampleRate: number;
};

const structureInfo: Record<Structure, { label: string; function: string }> = {
  myocardium: {
    label: "Myocardium",
    function: "Cardiac muscle contracts to propel blood through the pulmonary and systemic circulations.",
  },
  "right-atrium": {
    label: "Right atrium",
    function: "Receives systemic venous blood from the superior and inferior vena cava and passes it to the right ventricle.",
  },
  "left-atrium": {
    label: "Left atrium",
    function: "Receives oxygenated blood from the pulmonary veins and passes it to the left ventricle.",
  },
  "right-ventricle": {
    label: "Right ventricle",
    function: "Pumps deoxygenated blood into the pulmonary trunk toward the lungs.",
  },
  "left-ventricle": {
    label: "Left ventricle",
    function: "Pumps oxygenated blood into the aorta for delivery to the body.",
  },
  aorta: {
    label: "Aorta",
    function: "The aorta carries blood from the left ventricle to the systemic arterial circulation.",
  },
  "vena-cava": {
    label: "Superior and inferior vena cava",
    function: "These large veins return systemic venous blood to the right atrium.",
  },
  "pulmonary-trunk": {
    label: "Pulmonary trunk and arteries",
    function: "The pulmonary trunk leaves the right ventricle and branches toward the lungs.",
  },
  "pulmonary-veins": {
    label: "Pulmonary veins",
    function: "Pulmonary veins return oxygenated blood from the lungs to the left atrium.",
  },
  "coronary-arteries": {
    label: "Coronary arteries",
    function: "Coronary arteries supply oxygenated blood to the myocardium.",
  },
  "coronary-veins": {
    label: "Coronary veins",
    function: "Coronary veins collect blood from the myocardium and return it toward the right atrium.",
  },
};

const selectableStructures = Object.keys(structureInfo) as Structure[];
const cameraViews: Record<ViewPreset, [number, number, number]> = {
  Anterior: [0, 0.1, 6.3],
  Posterior: [0, 0.1, -6.3],
  "Left lateral": [6.3, 0.1, 0],
  "Right lateral": [-6.3, 0.1, 0],
};

function createMyocardiumGeometry() {
  const ringCount = 56;
  const segmentCount = 72;
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring <= ringCount; ring += 1) {
    const t = ring / ringCount;
    const y = 1.36 - t * 2.92;
    const radius = 0.035 + 0.84 * Math.pow(Math.sin(Math.PI * t), 0.78);
    const centerX = 0.04 + 0.23 * t;
    for (let segment = 0; segment <= segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2;
      const contour = 1 + 0.045 * Math.sin(angle * 3 + t * 7) + 0.025 * Math.sin(angle * 7 - t * 5);
      vertices.push(
        centerX + Math.cos(angle) * radius * contour,
        y,
        Math.sin(angle) * radius * 0.52 * contour,
      );
    }
  }

  for (let ring = 0; ring < ringCount; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const a = ring * (segmentCount + 1) + segment;
      const b = a + segmentCount + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createChamberGeometry(kind: "atrium" | "ventricle") {
  const geometry = new THREE.SphereGeometry(1, 48, 36);
  const positions = geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    vertex.fromBufferAttribute(positions, i);
    const taper = kind === "ventricle" ? 1 - 0.44 * Math.max(0, -vertex.y) : 1 + 0.08 * vertex.y;
    const contour = 1 + 0.035 * Math.sin(vertex.y * 11 + vertex.x * 5) * Math.cos(vertex.z * 7);
    positions.setXYZ(i, vertex.x * taper * contour, vertex.y, vertex.z * contour);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function Vessel({
  points,
  color,
  name,
  visible = true,
  selected = false,
  onSelect,
  radius = 0.075,
}: {
  points: [number, number, number][];
  color: string;
  name: Structure;
  visible?: boolean;
  selected?: boolean;
  onSelect: (name: Structure) => void;
  radius?: number;
}) {
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    return new THREE.TubeGeometry(curve, Math.max(32, points.length * 12), radius, 12, false);
  }, [points.map((point) => point.join(",")).join(";"), radius]);
  return (
    <mesh
      geometry={geometry}
      visible={visible}
      castShadow
      receiveShadow
      onClick={(event) => {
        event.stopPropagation();
        onSelect(name);
      }}
    >
      <meshPhysicalMaterial
        color={selected ? "#ffd28c" : color}
        roughness={0.37}
        metalness={0.02}
        clearcoat={0.32}
        clearcoatRoughness={0.4}
        emissive={selected ? "#744317" : "#000000"}
        emissiveIntensity={selected ? 0.45 : 0}
      />
    </mesh>
  );
}

function AnatomicalLabel({
  visible,
  position,
  children,
}: {
  visible: boolean;
  position: [number, number, number];
  children: string;
}) {
  if (!visible) return null;
  return (
    <Html position={position} center distanceFactor={7} occlude>
      <span className="heart-label static">{children}</span>
    </Html>
  );
}

function ConductionSystem({ labels }: { labels: boolean }) {
  const pulseRefs = useRef<Array<THREE.Mesh | null>>([]);
  const paths = useMemo(
    () =>
      [
        [[-0.42, 0.65, 0.62], [-0.16, 0.5, 0.62], [0.02, 0.28, 0.62]],
        [[0.02, 0.28, 0.62], [0.02, -0.02, 0.62], [-0.32, -0.44, 0.61], [-0.42, -1.02, 0.55]],
        [[0.02, 0.28, 0.62], [0.07, -0.06, 0.62], [0.38, -0.45, 0.6], [0.48, -1.02, 0.55]],
        [[-0.28, -0.4, 0.62], [-0.58, -0.8, 0.52]],
        [[0.34, -0.4, 0.61], [0.66, -0.79, 0.5]],
      ].map((points) => new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)))),
    [],
  );
  const renderedPaths = [
    [[-0.42, 0.65, 0.62], [-0.16, 0.5, 0.62], [0.02, 0.28, 0.62]],
    [[0.02, 0.28, 0.62], [0.02, -0.02, 0.62], [-0.32, -0.44, 0.61], [-0.42, -1.02, 0.55]],
    [[0.02, 0.28, 0.62], [0.07, -0.06, 0.62], [0.38, -0.45, 0.6], [0.48, -1.02, 0.55]],
    [[-0.28, -0.4, 0.62], [-0.58, -0.8, 0.52]],
    [[0.34, -0.4, 0.61], [0.66, -0.79, 0.5]],
  ] as [number, number, number][][];

  useFrame(({ clock }) => {
    const time = clock.elapsedTime * 0.23;
    pulseRefs.current.forEach((pulse, index) => {
      if (!pulse) return;
      const progress = (time + index * 0.21) % 1;
      pulse.position.copy(paths[index].getPointAt(progress));
    });
  });

  return (
    <group>
      {renderedPaths.map((points, index) => (
        <Vessel
          key={`path-${index}`}
          points={points}
          color={index === 0 ? "#70d9dc" : "#bea1ff"}
          name="myocardium"
          onSelect={() => undefined}
          radius={index === 0 ? 0.025 : 0.018}
        />
      ))}
      <mesh position={[-0.42, 0.65, 0.63]}>
        <sphereGeometry args={[0.075, 20, 20]} />
        <meshBasicMaterial color="#ffe69a" />
      </mesh>
      <mesh position={[0.02, 0.28, 0.63]}>
        <sphereGeometry args={[0.065, 20, 20]} />
        <meshBasicMaterial color="#ffca86" />
      </mesh>
      {paths.map((_, index) => (
        <mesh key={`pulse-${index}`} ref={(node) => { pulseRefs.current[index] = node; }}>
          <sphereGeometry args={[0.04, 16, 16]} />
          <meshBasicMaterial color={index === 0 ? "#fff0a8" : "#c7b1ff"} />
        </mesh>
      ))}
      <AnatomicalLabel visible={labels} position={[-0.62, 0.78, 0.62]}>SA node</AnatomicalLabel>
      <AnatomicalLabel visible={labels} position={[0.22, 0.22, 0.65]}>AV node</AnatomicalLabel>
      <AnatomicalLabel visible={labels} position={[-0.13, -0.04, 0.65]}>His bundle</AnatomicalLabel>
      <AnatomicalLabel visible={labels} position={[0.58, -0.72, 0.58]}>Purkinje fibers</AnatomicalLabel>
    </group>
  );
}

function HeartModel({
  selected,
  onSelect,
  labels,
  chambers,
  vessels,
  conduction,
  event,
}: {
  selected: Structure;
  onSelect: (name: Structure) => void;
  labels: boolean;
  chambers: boolean;
  vessels: boolean;
  conduction: boolean;
  event: number | null;
}) {
  const bodyGeometry = useMemo(createMyocardiumGeometry, []);
  const atriumGeometry = useMemo(() => createChamberGeometry("atrium"), []);
  const ventricleGeometry = useMemo(() => createChamberGeometry("ventricle"), []);
  const modelRef = useRef<THREE.Group>(null);
  const previousEvent = useRef(event);
  const pulseStartedAt = useRef(-1);
  useFrame(({ clock }) => {
    if (previousEvent.current !== event) {
      previousEvent.current = event;
      pulseStartedAt.current = clock.elapsedTime;
    }
    if (!modelRef.current || pulseStartedAt.current < 0) return;
    const elapsed = clock.elapsedTime - pulseStartedAt.current;
    const pulse = elapsed < 0.45 ? Math.sin((elapsed / 0.45) * Math.PI) * 0.025 : 0;
    modelRef.current.scale.setScalar(1 + pulse);
  });

  const chamber = (
    name: Structure,
    position: [number, number, number],
    scale: [number, number, number],
    color: string,
  ) => (
    <mesh
      key={name}
      geometry={name.includes("atrium") ? atriumGeometry : ventricleGeometry}
      position={position}
      scale={scale}
      visible={chambers}
      castShadow
      receiveShadow
      onClick={(event) => {
        event.stopPropagation();
        onSelect(name);
      }}
    >
      <meshPhysicalMaterial
        color={selected === name ? "#d98380" : color}
        roughness={0.47}
        metalness={0}
        clearcoat={0.22}
        clearcoatRoughness={0.52}
        emissive={selected === name ? "#3d1017" : "#000000"}
        emissiveIntensity={selected === name ? 0.5 : 0}
      />
    </mesh>
  );

  return (
    <group ref={modelRef}>
      <mesh
        geometry={bodyGeometry}
        position={[0, 0, -0.16]}
        visible={chambers}
        castShadow
        receiveShadow
        onClick={(event) => {
          event.stopPropagation();
          onSelect("myocardium");
        }}
      >
        <meshPhysicalMaterial
          color={selected === "myocardium" ? "#bc736e" : "#713b3d"}
          roughness={0.55}
          metalness={0}
          clearcoat={0.18}
          clearcoatRoughness={0.58}
        />
      </mesh>

      {chamber("right-atrium", [-0.38, 0.54, 0.24], [0.39, 0.45, 0.31], "#89504f")}
      {chamber("left-atrium", [0.39, 0.57, 0.2], [0.39, 0.42, 0.3], "#a75e58")}
      {chamber("right-ventricle", [-0.37, -0.34, 0.25], [0.47, 0.79, 0.34], "#844545")}
      {chamber("left-ventricle", [0.31, -0.34, 0.28], [0.48, 0.87, 0.38], "#9b514b")}

      <group visible={vessels}>
        <Vessel
          name="aorta" selected={selected === "aorta"} onSelect={onSelect} color="#a8493e" radius={0.13}
          points={[[0.2, 0.5, 0.03], [0.12, 0.91, 0.02], [0.14, 1.31, 0.01], [0.42, 1.53, 0], [0.77, 1.47, -0.01], [0.93, 1.18, -0.03], [0.89, 0.77, -0.04]]}
        />
        <Vessel
          name="aorta" onSelect={onSelect} color="#a8493e" radius={0.052}
          points={[[0.28, 1.38, 0], [0.3, 1.7, -0.01], [0.28, 1.82, -0.03]]}
        />
        <Vessel
          name="aorta" onSelect={onSelect} color="#a8493e" radius={0.048}
          points={[[0.48, 1.49, 0], [0.5, 1.75, -0.02], [0.53, 1.88, -0.02]]}
        />
        <Vessel
          name="aorta" onSelect={onSelect} color="#a8493e" radius={0.045}
          points={[[0.68, 1.44, -0.01], [0.72, 1.67, -0.03], [0.77, 1.77, -0.03]]}
        />
        <Vessel
          name="vena-cava" selected={selected === "vena-cava"} onSelect={onSelect} color="#526f96" radius={0.11}
          points={[[-0.48, 1.66, -0.05], [-0.47, 1.24, -0.04], [-0.42, 0.91, -0.01], [-0.38, 0.67, 0.02]]}
        />
        <Vessel
          name="vena-cava" onSelect={onSelect} color="#526f96" radius={0.1}
          points={[[0.02, -1.67, -0.08], [-0.11, -1.27, -0.06], [-0.34, -0.92, -0.02], [-0.39, -0.7, 0.01]]}
        />
        <Vessel
          name="pulmonary-trunk" selected={selected === "pulmonary-trunk"} onSelect={onSelect} color="#657fa6" radius={0.105}
          points={[[-0.15, -0.02, 0.04], [-0.35, 0.37, 0.02], [-0.48, 0.78, 0], [-0.77, 0.97, -0.03], [-1.01, 0.89, -0.06]]}
        />
        <Vessel
          name="pulmonary-trunk" onSelect={onSelect} color="#657fa6" radius={0.075}
          points={[[-0.48, 0.78, 0], [-0.29, 1.02, -0.04], [0.02, 1.1, -0.08], [0.37, 0.98, -0.08]]}
        />
        <Vessel
          name="pulmonary-veins" selected={selected === "pulmonary-veins"} onSelect={onSelect} color="#a65b58" radius={0.055}
          points={[[0.62, 0.45, -0.22], [0.9, 0.42, -0.34], [1.13, 0.42, -0.35]]}
        />
        <Vessel
          name="pulmonary-veins" onSelect={onSelect} color="#a65b58" radius={0.05}
          points={[[0.62, 0.65, -0.2], [0.91, 0.75, -0.34], [1.12, 0.78, -0.35]]}
        />
        <Vessel
          name="pulmonary-veins" onSelect={onSelect} color="#a65b58" radius={0.05}
          points={[[0.12, 0.45, -0.22], [-0.13, 0.4, -0.34], [-0.34, 0.4, -0.35]]}
        />
        <Vessel
          name="pulmonary-veins" onSelect={onSelect} color="#a65b58" radius={0.05}
          points={[[0.13, 0.68, -0.2], [-0.13, 0.78, -0.34], [-0.34, 0.8, -0.35]]}
        />

        <Vessel
          name="coronary-arteries" selected={selected === "coronary-arteries"} onSelect={onSelect} color="#c66b56" radius={0.035}
          points={[[0.14, 0.35, 0.58], [0.02, 0.2, 0.62], [0.04, -0.2, 0.63], [0.18, -0.69, 0.57], [0.31, -1.12, 0.45]]}
        />
        <Vessel
          name="coronary-arteries" onSelect={onSelect} color="#c66b56" radius={0.029}
          points={[[0.04, -0.2, 0.63], [0.36, -0.32, 0.62], [0.6, -0.55, 0.53], [0.65, -0.85, 0.46]]}
        />
        <Vessel
          name="coronary-arteries" onSelect={onSelect} color="#c66b56" radius={0.024}
          points={[[0.28, -0.34, 0.61], [0.48, -0.05, 0.58], [0.57, 0.18, 0.49]]}
        />
        <Vessel
          name="coronary-arteries" onSelect={onSelect} color="#c66b56" radius={0.026}
          points={[[0.03, 0.2, 0.62], [-0.27, 0.16, 0.59], [-0.56, -0.01, 0.5], [-0.68, -0.3, 0.43]]}
        />
        <Vessel
          name="coronary-veins" selected={selected === "coronary-veins"} onSelect={onSelect} color="#536d8f" radius={0.025}
          points={[[0.34, -0.95, 0.49], [0.25, -0.56, 0.58], [0.18, -0.12, 0.62], [0.02, 0.27, 0.59], [-0.25, 0.42, 0.51]]}
        />
        <Vessel
          name="coronary-veins" onSelect={onSelect} color="#536d8f" radius={0.045}
          points={[[0.28, 0.19, -0.34], [0.04, 0.32, -0.38], [-0.28, 0.35, -0.32], [-0.48, 0.29, -0.22]]}
        />
      </group>

      <AnatomicalLabel visible={labels} position={[-0.65, 0.58, 0.64]}>Right atrium</AnatomicalLabel>
      <AnatomicalLabel visible={labels} position={[0.63, 0.58, 0.61]}>Left atrium</AnatomicalLabel>
      <AnatomicalLabel visible={labels} position={[-0.71, -0.45, 0.58]}>Right ventricle</AnatomicalLabel>
      <AnatomicalLabel visible={labels} position={[0.63, -0.55, 0.64]}>Left ventricle</AnatomicalLabel>
      <AnatomicalLabel visible={labels} position={[0.88, 1.5, 0.01]}>Aorta</AnatomicalLabel>
      <AnatomicalLabel visible={labels} position={[-0.83, 1.05, 0.01]}>Pulmonary trunk</AnatomicalLabel>
      {conduction && <ConductionSystem labels={labels} />}
    </group>
  );
}

function CameraTransition({
  view,
  requestId,
  controls,
}: {
  view: ViewPreset;
  requestId: number;
  controls: React.RefObject<ComponentRef<typeof OrbitControls> | null>;
}) {
  const goal = useMemo(() => new THREE.Vector3(...cameraViews[view]), [view]);
  const target = useMemo(() => new THREE.Vector3(0, 0.05, 0), []);
  const settled = useRef(false);
  useEffect(() => {
    settled.current = false;
  }, [goal, requestId]);
  useFrame(() => {
    const controller = controls.current;
    if (!controller || settled.current) return;
    controller.object.position.lerp(goal, 0.075);
    controller.target.lerp(target, 0.075);
    if (controller.object.position.distanceToSquared(goal) < 0.0004 && controller.target.distanceToSquared(target) < 0.0004) {
      controller.object.position.copy(goal);
      controller.target.copy(target);
      settled.current = true;
    }
    controller.update();
  });
  return null;
}

function WaveformPanel({
  waveform,
  selectedEvent,
  onSelectEvent,
}: {
  waveform: Waveform;
  selectedEvent: number | null;
  onSelectEvent: (sampleIndex: number) => void;
}) {
  const { times, values, peaks, sampleRate } = waveform;
  const duration = times[times.length - 1] ?? 0;
  const finiteValues = values.filter(Number.isFinite);
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const span = max - min || 1;
  const path = useMemo(() => {
    if (!times.length || !values.length) return "";
    const step = Math.max(1, Math.ceil(values.length / 900));
    const points: string[] = [];
    for (let i = 0; i < values.length; i += step) {
      if (!Number.isFinite(values[i])) continue;
      const x = (times[i] / (duration || 1)) * 900;
      const y = 8 + ((max - values[i]) / span) * 114;
      points.push(`${points.length ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return points.join(" ");
  }, [duration, max, span, times, values]);
  const eventTime = selectedEvent === null ? null : selectedEvent / sampleRate;
  const cursorX = eventTime === null ? null : (eventTime / (duration || 1)) * 900;
  const displayedPeaks = peaks.filter((peak) => peak / sampleRate <= duration);
  const selectedPeak = selectedEvent === null ? "" : String(selectedEvent);

  if (!times.length || !values.length || !peaks.length) {
    return (
      <div className="heart-waveform-empty">
        <span>No completed analysis is loaded.</span>
        <small>Run an analysis to synchronize detected events with this educational model.</small>
      </div>
    );
  }

  return (
    <div className="heart-waveform">
      <div className="heart-waveform-heading">
        <div>
          <b>{waveform.unit === "z-score" ? "Extracted fetal candidate" : "Processed ECG"}</b>
          <small>Measured trace · {waveform.unit} · {duration.toFixed(2)} s</small>
        </div>
        <label>
          Select detected beat
          <select
            aria-label="Select detected ECG beat"
            value={selectedPeak}
            onChange={(event) => onSelectEvent(Number(event.target.value))}
          >
            <option value="">No beat selected</option>
            {displayedPeaks.map((peak, index) => (
              <option key={`${peak}-${index}`} value={peak}>
                Beat {index + 1} · {(peak / sampleRate).toFixed(3)} s
              </option>
            ))}
          </select>
        </label>
      </div>
      <svg className="heart-ecg-svg" viewBox="0 0 900 142" role="img" aria-label="Processed ECG waveform and detected beat markers">
        <path d="M0 65 H900 M0 105 H900" className="heart-ecg-grid" />
        <path d={path} className="heart-ecg-line" />
        {displayedPeaks.map((peak) => {
          const x = (peak / sampleRate / (duration || 1)) * 900;
          const index = Math.min(values.length - 1, Math.max(0, Math.round((peak / sampleRate / (duration || 1)) * (values.length - 1))));
          const y = 8 + ((max - values[index]) / span) * 114;
          return (
            <circle
              key={peak}
              cx={x}
              cy={y}
              r={selectedEvent === peak ? 5 : 3.2}
              className={selectedEvent === peak ? "heart-ecg-beat selected" : "heart-ecg-beat"}
              role="button"
              tabIndex={0}
              aria-label={`Select detected beat at ${(peak / sampleRate).toFixed(3)} seconds`}
              onClick={() => onSelectEvent(peak)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectEvent(peak);
              }}
            />
          );
        })}
        {cursorX !== null && <line x1={cursorX} x2={cursorX} y1="0" y2="130" className="heart-ecg-cursor" />}
      </svg>
      <div className="heart-waveform-footer">
        <span>0 s</span>
        <span>{eventTime === null ? "Choose a detected beat to move the ECG cursor" : `Selected measured event · ${eventTime.toFixed(3)} s`}</span>
        <span>{duration.toFixed(2)} s</span>
      </div>
    </div>
  );
}

export function HeartScene({
  event,
  waveform,
  onEventSelect,
}: {
  event: number | null;
  waveform?: Waveform | null;
  onEventSelect?: (sampleIndex: number) => void;
}) {
  const [selected, setSelected] = useState<Structure>("left-ventricle");
  const [conduction, setConduction] = useState(false);
  const [labels, setLabels] = useState(true);
  const [chambers, setChambers] = useState(true);
  const [vessels, setVessels] = useState(true);
  const [view, setView] = useState<ViewPreset>("Anterior");
  const [viewRequestId, setViewRequestId] = useState(0);
  const [playing, setPlaying] = useState(false);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);

  useEffect(() => {
    if (!playing || !waveform?.peaks.length || !onEventSelect) return;
    const interval = window.setInterval(() => {
      const current = waveform.peaks.indexOf(event ?? -1);
      const next = waveform.peaks[(current + 1) % waveform.peaks.length];
      onEventSelect(next);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [event, onEventSelect, playing, waveform?.peaks]);

  const resetCamera = () => {
    setView("Anterior");
    setViewRequestId((current) => current + 1);
    controls.current?.reset();
  };

  return (
    <section className="heart-panel panel">
      <div className="panel-heading">
        <div><p className="eyebrow">EDUCATIONAL ANATOMY</p><h2>Interactive adult heart</h2></div>
        <button className="small-button" onClick={resetCamera}><RotateCcw size={14} /> Reset camera</button>
      </div>
      <p className="model-disclaimer">
        Procedural educational illustration; not a licensed anatomical atlas, clinical model, or patient-specific reconstruction.
        ECG events control the timeline cursor only and do not map internal electrical propagation.
      </p>
      <div className="heart-viewbar" aria-label="Camera views">
        <span>CAMERA VIEW</span>
        {(Object.keys(cameraViews) as ViewPreset[]).map((preset) => (
          <button key={preset} className={view === preset ? "active" : ""} onClick={() => { setView(preset); setViewRequestId((current) => current + 1); }}>{preset}</button>
        ))}
      </div>
      <div className="heart-canvas">
        <Canvas
          camera={{ position: cameraViews.Anterior, fov: 36 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          shadows
        >
          <color attach="background" args={["#091521"]} />
          <ambientLight intensity={0.9} />
          <hemisphereLight args={["#d7e8f4", "#281f24", 1.2]} />
          <directionalLight position={[3.5, 4.5, 5]} intensity={2.25} castShadow shadow-mapSize={[1024, 1024]} />
          <directionalLight position={[-4, 1, -3]} intensity={1.05} color="#8da8c8" />
          <pointLight position={[1, -2, 4]} color="#dc9680" intensity={0.55} />
          <HeartModel
            selected={selected}
            onSelect={setSelected}
            labels={labels}
            chambers={chambers}
            vessels={vessels}
            conduction={conduction}
            event={event}
          />
          <OrbitControls
            ref={controls}
            makeDefault
            enablePan
            enableZoom
            minDistance={3.5}
            maxDistance={8}
            enableDamping
            dampingFactor={0.08}
          />
          <CameraTransition view={view} requestId={viewRequestId} controls={controls} />
        </Canvas>
      </div>

      <div className="heart-controls">
        <label className="toggle"><input type="checkbox" checked={labels} onChange={(event) => setLabels(event.target.checked)} /> Labels</label>
        <label className="toggle"><input type="checkbox" checked={chambers} onChange={(event) => setChambers(event.target.checked)} /> Chambers</label>
        <label className="toggle"><input type="checkbox" checked={vessels} onChange={(event) => setVessels(event.target.checked)} /> Vessels</label>
        <label className="toggle"><input type="checkbox" checked={conduction} onChange={(event) => setConduction(event.target.checked)} /> Conduction overlay</label>
        <div className="structure-tags">
          {selectableStructures.map((name) => (
            <button
              key={name}
              className={selected === name ? "tag active" : "tag"}
              onClick={() => setSelected(name)}
            >
              {structureInfo[name].label}
            </button>
          ))}
        </div>
      </div>
      <div className="structure-description">
        <b>{structureInfo[selected].label}</b>
        <span>{structureInfo[selected].function}</span>
      </div>
      {conduction && <p className="conduction-note">Educational conduction overlay: SA node → AV node → His bundle → bundle branches and Purkinje network. This pathway is illustrative, not inferred from the uploaded ECG.</p>}

      <div className="heart-timeline-heading">
        <div><p className="eyebrow">ECG SYNCHRONIZATION</p><h3>Recorded waveform and detected events</h3></div>
        <button
          className="small-button"
          onClick={() => setPlaying((value) => !value)}
          disabled={!waveform?.peaks.length || !onEventSelect}
          aria-label={playing ? "Pause educational ECG playback" : "Play educational ECG playback"}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? "Pause playback" : "Play detected beats"}
        </button>
      </div>
      <p className="model-disclaimer">Playback steps through actual detected beat timestamps at one event per second; the pace is illustrative, not the recording's real-time speed.</p>
      {waveform && onEventSelect
        ? <WaveformPanel waveform={waveform} selectedEvent={event} onSelectEvent={onEventSelect} />
        : <div className="heart-waveform-empty"><span>ECG timeline unavailable.</span><small>Upload and analyze a recording to link detected events to this view.</small></div>}
    </section>
  );
}
