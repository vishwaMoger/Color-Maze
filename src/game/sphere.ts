// Real 3D balls: a per-pixel ray-traced sphere drawn by a filter on a plain
// quad. The surface pattern is a function of the point on the sphere, so it
// turns with the ball as it rolls (no flat images), and every skin gets the
// same studio lighting: soft key light, glossy highlight, reflected
// softbox, a fresnel rim and a warm bounce from the board below.
import type { Filter } from 'pixi.js';
import { make } from './shaders.ts';

/** Surface patterns, see the fragment shader below. */
export const SPHERE_MODE = {
  star: 0,
  pearl: 1,
  earth: 2,
  softball: 3,
  volley: 4,
  basket: 5,
  soccer: 6,
  moon: 7,
  eight: 8,
  swirl: 9,
  metal: 10,
  gem: 11,
  toy: 12,
} as const;
export type SphereMode = keyof typeof SPHERE_MODE;

const SPHERE_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform mat3 uRot;
uniform float uMode;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;

uniform float uAA;

const float PHI = 1.618034;
// Face centres of a truncated icosahedron: 12 pentagons (icosahedron
// vertices), then 20 hexagons (dodecahedron vertices). Built in code
// because WebGL1 has no constant arrays.
vec3 cyc(vec3 v, float k) { return k < 0.5 ? v : (k < 1.5 ? v.zxy : v.yzx); }
vec3 faceDir(float i) {
  if (i < 12.0) {
    float k = floor(i / 4.0);
    float m = i - k * 4.0;
    return normalize(cyc(vec3(0.0, mod(m, 2.0) < 0.5 ? 1.0 : -1.0, m < 1.5 ? PHI : -PHI), k));
  }
  if (i < 20.0) {
    float m = i - 12.0;
    return normalize(vec3(mod(m, 2.0) < 0.5 ? 1.0 : -1.0, mod(floor(m / 2.0), 2.0) < 0.5 ? 1.0 : -1.0, m < 3.5 ? 1.0 : -1.0));
  }
  float j = i - 20.0;
  float k = floor(j / 4.0);
  float m = j - k * 4.0;
  return normalize(cyc(vec3(0.0, mod(m, 2.0) < 0.5 ? PHI : -PHI, m < 1.5 ? 0.618034 : -0.618034), k));
}

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
vec3 hash33(vec3 p) {
  return vec3(hash3(p), hash3(p + 19.19), hash3(p + 47.47));
}
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise3(p); p *= 2.03; a *= 0.5; }
  return s;
}
/** Distance to the nearest random feature point: craters, pebbles. */
float cells(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float md = 9.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 r = g + hash33(i + g) - f;
        md = min(md, dot(r, r));
      }
  return sqrt(md);
}
/** Anti-aliased step: 1 inside (v < edge), about a pixel soft. */
float aaLess(float v, float edge) {
  float w = uAA;
  return 1.0 - smoothstep(edge - w, edge + w, v);
}

void main(void) {
  vec2 q = vTextureCoord / (uOutputFrame.zw * uInputSize.zw);
  vec2 p = q * 2.0 - 1.0;
  float d = length(p);
  float alpha = 1.0 - smoothstep(1.0 - uAA * 1.5, 1.0, d);
  if (alpha <= 0.0) { finalColor = vec4(0.0); return; }
  vec3 n = vec3(p.x, -p.y, sqrt(max(0.0, 1.0 - d * d)));
  vec3 o = uRot * n;
  int mode = int(uMode + 0.5);
  if (mode == 12) {
    // Toy ball, as in the original: brightest just above the middle,
    // warm yellow toward the sides, deepening to orange at the bottom.
    float t = clamp(length((p - vec2(0.0, -0.25)) * vec2(0.85, 1.0)) / 1.25, 0.0, 1.0);
    vec3 toy = mix(uC1, uC2, smoothstep(0.0, 0.55, t));
    toy = mix(toy, uC3, smoothstep(0.35, 1.0, t) * smoothstep(-0.3, 0.9, p.y));
    finalColor = vec4(toy * alpha, alpha);
    return;
  }

  vec3 alb = uC2;
  float gloss = 1.0;
  float shine = 90.0;
  float metal = 0.0;
  vec3 ln = n;

  if (mode == 0) {
    // Toy ball: a bold white star on each side and a ring round the middle.
    vec2 t = o.z > 0.0 ? o.xy : vec2(-o.x, o.y);
    float r = length(t);
    float ang = atan(t.y, t.x) - 1.5708;
    // Five-pointed star: radius swings between inner and outer points.
    float seg = 6.2831 / 5.0;
    float a5 = abs(mod(ang, seg) - seg * 0.5) / (seg * 0.5);
    float star = mix(0.2, 0.5, a5 * a5);
    float s = abs(o.z) > 0.3 ? aaLess(r, star) : 0.0;
    float band = aaLess(abs(o.z), 0.06) * (1.0 - aaLess(abs(o.z), 0.03));
    alb = mix(uC2, uC1, max(s, band));
    alb = mix(alb, uC3, (1.0 - max(s, band)) * smoothstep(0.2, 1.0, -o.y) * 0.25);
  } else if (mode == 1) {
    // Pearl: soft nacre with thin-film colour shifting toward the rim.
    float film = 1.0 - n.z;
    vec3 irid = 0.5 + 0.5 * cos(6.2831 * (film * 1.4 + vec3(0.0, 0.33, 0.67)) + fbm3(o * 3.0) * 2.0);
    alb = mix(uC2, irid, 0.08 + film * 0.22);
    alb *= 0.94 + 0.08 * fbm3(o * 9.0);
    shine = 60.0;
  } else if (mode == 2) {
    // Earth: oceans, continents, ice caps and drifting clouds.
    float h = fbm3(o * 2.1 + vec3(3.1, 1.7, 0.4));
    float land = smoothstep(0.515, 0.535, h);
    vec3 ocean = mix(vec3(0.03, 0.2, 0.6), vec3(0.1, 0.55, 0.9), smoothstep(0.35, 0.52, h));
    float dry = fbm3(o * 4.3 + 11.0);
    vec3 ground = mix(vec3(0.16, 0.62, 0.22), vec3(0.72, 0.6, 0.3), smoothstep(0.45, 0.7, dry));
    alb = mix(ocean, ground, land);
    alb = mix(alb, vec3(0.97), smoothstep(0.82, 0.88, abs(o.y)));
    float cloud = smoothstep(0.56, 0.7, fbm3(o * 3.3 + vec3(7.0, 2.0, 5.0)));
    alb = mix(alb, vec3(1.0), cloud * 0.85);
    gloss = mix(0.9, 0.25, max(land, cloud));
  } else if (mode == 3) {
    // Softball: fuzzy felt with a curved white seam and red stitches.
    float lat = asin(clamp(o.y, -1.0, 1.0));
    float lon = atan(o.z, o.x);
    float seam = lat - 0.62 * cos(2.0 * lon);
    float sd = abs(seam);
    alb = uC2 * (0.9 + 0.16 * noise3(o * 60.0));
    alb = mix(alb, uC1, aaLess(sd, 0.06));
    float stitch = abs(fract(lon * 7.0 + (seam > 0.0 ? 0.25 : -0.25) * sign(seam)) - 0.5);
    float st = aaLess(sd, 0.15) * (1.0 - aaLess(sd, 0.07)) * aaLess(stitch, 0.16);
    alb = mix(alb, uC3, st);
    gloss = 0.3;
    shine = 30.0;
  } else if (mode == 4) {
    // Volleyball: three interlocking strips on each cube face.
    vec3 a = abs(o);
    float m = max(a.x, max(a.y, a.z));
    float u;
    vec3 face;
    if (m == a.x) { u = o.y / a.x; face = uC1; }
    else if (m == a.y) { u = o.z / a.y; face = uC3; }
    else { u = o.x / a.z; face = uC1; }
    float s = (u + 1.0) * 1.5;
    float strip = floor(clamp(s, 0.0, 2.999));
    alb = strip == 1.0 ? face : uC2;
    float line = min(abs(fract(s) - 0.0), abs(fract(s) - 1.0));
    float second = a.x + a.y + a.z - m - min(a.x, min(a.y, a.z));
    float seam = max(aaLess(line, 0.05) * step(0.2, s) * step(s, 2.8), aaLess(m - second, 0.025));
    alb = mix(alb, alb * 0.55, seam);
    gloss = 0.55;
    shine = 50.0;
  } else if (mode == 5) {
    // Basketball: pebbled orange leather with black seams.
    float peb = cells(o * 34.0);
    alb = uC2 * (0.82 + 0.25 * smoothstep(0.1, 0.6, peb));
    float s1 = abs(o.x);
    float s2 = abs(o.y);
    float s3 = abs(abs(o.z) - 0.6 - 0.3 * o.x * o.x);
    float seam = max(max(aaLess(s1, 0.025), aaLess(s2, 0.025)), aaLess(s3, 0.025));
    alb = mix(alb, uC3, seam);
    gloss = 0.4;
    shine = 40.0;
  } else if (mode == 6) {
    // Soccer ball: black pentagons, white hexagons, pressed seams.
    float b1 = -2.0;
    float b2 = -2.0;
    float pent = 0.0;
    for (int i = 0; i < 32; i++) {
      float fi = float(i);
      float s = dot(o, faceDir(fi)) + (fi < 11.5 ? -0.022 : 0.0);
      if (s > b1) { b2 = b1; b1 = s; pent = fi < 11.5 ? 1.0 : 0.0; }
      else if (s > b2) b2 = s;
    }
    alb = pent > 0.5 ? uC3 : uC2;
    float seam = aaLess(b1 - b2, 0.018);
    alb = mix(alb, vec3(0.25), seam * 0.7);
    shine = 70.0;
  } else if (mode == 7) {
    // Moon: dusty grey with dark maria and rimmed craters.
    float maria = smoothstep(0.48, 0.62, fbm3(o * 1.8 + 4.0));
    alb = mix(uC1, uC3, maria * 0.6) * (0.9 + 0.15 * fbm3(o * 12.0));
    float c1 = cells(o * 3.2);
    float c2 = cells(o * 7.5 + 3.0);
    alb *= 1.0 - 0.22 * (1.0 - smoothstep(0.18, 0.32, c1)) + 0.12 * smoothstep(0.3, 0.36, c1) * (1.0 - smoothstep(0.36, 0.44, c1));
    alb *= 1.0 - 0.15 * (1.0 - smoothstep(0.12, 0.24, c2));
    gloss = 0.15;
    shine = 20.0;
  } else if (mode == 8) {
    // 8-ball: black lacquer, white disc, black 8 drawn as two rings.
    float disc = aaLess(1.0 - o.z, 0.075);
    vec2 t = o.xy;
    float r1 = abs(length(t - vec2(0.0, 0.085)) - 0.06);
    float r2 = abs(length(t - vec2(0.0, -0.075)) - 0.072);
    float eight = max(aaLess(r1, 0.022), aaLess(r2, 0.024)) * step(0.0, o.z);
    alb = mix(uC2, uC1, disc);
    alb = mix(alb, uC2, eight * disc);
    shine = 140.0;
  } else if (mode == 9) {
    // Peppermint swirl.
    float a = atan(o.z, o.x);
    float w = sin(a * 5.0 + o.y * 5.0);
    alb = mix(uC1, uC2, smoothstep(-uAA * 4.0 - 0.04, uAA * 4.0 + 0.04, w));
    shine = 110.0;
  } else if (mode == 10) {
    // Polished metal with an engraved ring.
    metal = 1.0;
    float ring = aaLess(abs(abs(o.z) - 0.5), 0.02);
    alb = mix(uC2, uC3, ring * 0.8);
    shine = 160.0;
  } else {
    // Cut gem: flat facets that each catch the light differently.
    float b1 = -2.0;
    vec3 f = vec3(0.0, 0.0, 1.0);
    for (int i = 0; i < 32; i++) {
      vec3 fd = faceDir(float(i));
      float s = dot(o, fd);
      if (s > b1) { b1 = s; f = fd; }
    }
    ln = normalize(mix(n, f * uRot, 0.85));
    alb = mix(uC3, uC2, 0.5 + 0.5 * hash3(f * 7.0));
    shine = 200.0;
  }

  vec3 L = normalize(vec3(-0.5, 0.62, 0.72));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float ndl = dot(ln, L);
  float wrapd = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
  float spec = pow(max(dot(ln, H), 0.0), shine);
  float sheen = pow(max(dot(ln, H), 0.0), 10.0);
  float fres = pow(1.0 - max(n.z, 0.0), 2.6);
  // Studio environment seen in the reflection: bright sky, a softbox to the
  // upper left and the lavender board below.
  vec3 R = reflect(-V, ln);
  vec3 env = mix(vec3(0.42, 0.36, 0.62), vec3(1.0, 0.98, 1.0), smoothstep(-0.35, 0.75, R.y));
  float box = smoothstep(0.9, 0.97, dot(R, normalize(vec3(-0.55, 0.7, 0.45))));
  env += box * 1.4;

  vec3 col;
  if (metal > 0.5) {
    col = alb * (0.25 + 0.95 * env) + alb * spec * 2.0 + vec3(1.0) * box * 0.35;
    col += alb * 0.25 * wrapd;
  } else {
    col = alb * (0.22 + 0.9 * wrapd);
    // Warm bounce light from the board under the ball.
    col += alb * vec3(0.16, 0.12, 0.2) * max(-n.y, 0.0);
    col = mix(col, env, fres * 0.32 * gloss);
    col += vec3(1.0) * (spec * 1.05 + sheen * 0.08 + box * 0.55) * gloss;
  }
  // Contact occlusion at the bottom and a soft terminator for depth.
  col *= 1.0 - 0.28 * smoothstep(0.35, 1.0, -n.y) * (1.0 - n.z);
  col *= 0.86 + 0.14 * smoothstep(0.0, 0.45, n.z);
  finalColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}`;

export type SphereFilter = Filter & {
  uniforms: { uRot: Float32Array; uMode: number; uC1: Float32Array; uC2: Float32Array; uC3: Float32Array; uAA: number };
};

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return new Float32Array([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]);
};

export function sphereFilter(mode: SphereMode, colors: [string, string, string]): SphereFilter {
  return make('sphere3d', SPHERE_FRAG, {
    uRot: { value: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), type: 'mat3x3<f32>' },
    uMode: { value: SPHERE_MODE[mode], type: 'f32' },
    uC1: { value: rgb(colors[0]), type: 'vec3<f32>' },
    uC2: { value: rgb(colors[1]), type: 'vec3<f32>' },
    uC3: { value: rgb(colors[2]), type: 'vec3<f32>' },
    // Edge softness in sphere units: about one screen pixel over the radius.
    uAA: { value: 0.02, type: 'f32' },
  });
}

/**
 * The ball's orientation as a rotation matrix (column-major, object to
 * world). The shader needs world to object, which is the transpose.
 */
export class Orientation {
  /** Row-major 3x3, object to world. */
  private m = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  /** Rotate by `angle` (radians) about the unit axis (x, y, z), in world space. */
  rotate(x: number, y: number, z: number, angle: number) {
    if (!angle) return;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    const r = [
      t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c,
    ];
    const m = this.m;
    const out = new Array<number>(9);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) out[i * 3 + j] = r[i * 3] * m[j] + r[i * 3 + 1] * m[3 + j] + r[i * 3 + 2] * m[6 + j];
    // Re-orthonormalise now and then so rounding never skews the ball.
    const a = [out[0], out[3], out[6]];
    const la = Math.hypot(a[0], a[1], a[2]);
    a[0] /= la; a[1] /= la; a[2] /= la;
    let b = [out[1], out[4], out[7]];
    const dab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    b = [b[0] - a[0] * dab, b[1] - a[1] * dab, b[2] - a[2] * dab];
    const lb = Math.hypot(b[0], b[1], b[2]);
    b[0] /= lb; b[1] /= lb; b[2] /= lb;
    const cc = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    this.m = [a[0], b[0], cc[0], a[1], b[1], cc[1], a[2], b[2], cc[2]];
  }

  /**
   * Write world-to-object into a column-major mat3: the transpose of the
   * row-major object-to-world matrix has the same memory layout.
   */
  write(target: Float32Array) {
    // M^T(i, j) = m[j*3+i], and column-major storage puts (i, j) at j*3+i.
    for (let i = 0; i < 9; i++) target[i] = this.m[i];
  }
}
