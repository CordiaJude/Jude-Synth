// Minimal allocation-light 3D vector helpers over packed landmark arrays.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** Read landmark `i` from a packed [x,y,z,…] array. */
export function at(arr: ArrayLike<number>, i: number, out: Vec3 = vec()): Vec3 {
  out.x = arr[i * 3] ?? 0;
  out.y = arr[i * 3 + 1] ?? 0;
  out.z = arr[i * 3 + 2] ?? 0;
  return out;
}

export const sub = (a: Vec3, b: Vec3, out: Vec3 = vec()): Vec3 => {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
};

export const add = (a: Vec3, b: Vec3, out: Vec3 = vec()): Vec3 => {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
};

export const scale = (a: Vec3, s: number, out: Vec3 = vec()): Vec3 => {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
};

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3, out: Vec3 = vec()): Vec3 => {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};

export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const normalize = (a: Vec3, out: Vec3 = vec()): Vec3 => {
  const l = len(a) || 1;
  return scale(a, 1 / l, out);
};

/** Unsigned angle between two vectors, radians in [0, π]. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const d = dot(a, b) / ((len(a) || 1) * (len(b) || 1));
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => clamp(x, 0, 1);

/** Linear remap of x from [a,b] to [0,1], clamped. */
export const unlerp = (x: number, a: number, b: number): number => clamp01((x - a) / (b - a || 1e-9));
