// GLSL filters that give the board, the paint and the ball their finish.
import { Filter, GlProgram, UniformGroup } from 'pixi.js';

export const FILTER_VERT = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}`;

type Uniforms = Record<string, { value: number | Float32Array; type: 'f32' | 'vec2<f32>' | 'vec3<f32>' }>;

function make<U>(name: string, fragment: string, uniforms: Uniforms, padding = 0): Filter & { uniforms: U } {
  const group = new UniformGroup(uniforms);
  const f = new Filter({
    glProgram: GlProgram.from({ vertex: FILTER_VERT, fragment, name }),
    resources: { [`${name}Uniforms`]: group },
  });
  f.padding = padding;
  // Render at the screen's pixel density: the default (1) blurs on retina.
  f.resolution = 'inherit';
  return Object.assign(f, { uniforms: group.uniforms as U });
}

// ---------------------------------------------------------------- paint
// Wet paint: a thin coat that lies flat on the floor, its edge a touch
// deeper where it pools, with a soft sheen that drifts across.
// Patterned paints (marble, slime, lava, water) are generated here in
// board space, so the pattern stays put as the paint spreads.
const PAINT_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform float uRadius;
uniform float uTime;
uniform float uMode;
uniform vec2 uBoard;
uniform float uCell;
uniform vec3 uAlt;
float a(vec2 o) { return texture(uTexture, vTextureCoord + o * uInputSize.zw).a; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) { v += amp * noise(p); p *= 2.03; amp *= 0.5; }
  return v;
}
// Distance to the nearest cell edge of a jittered grid (Voronoi F2 - F1).
float cells(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash2(i + g);
      o = 0.5 + 0.4 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  return f2 - f1;
}
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  if (c.a < 0.004) { finalColor = c; return; }
  vec3 base = c.rgb / max(c.a, 0.001);
  vec2 px = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 q = (px - uBoard) / uCell;
  if (uMode > 0.5 && uMode < 1.5) {
    // Marble: soft swirling veins.
    float v = sin((q.x * 1.3 + q.y * 0.7) * 2.2 + fbm(q * 1.4 + uTime * 0.05) * 6.0);
    base = mix(base, uAlt, smoothstep(0.2, 1.0, v) * 0.75);
    base = mix(base, vec3(1.0), smoothstep(0.85, 1.0, v) * 0.35);
  } else if (uMode > 1.5 && uMode < 2.5) {
    // Slime: bubbly cells with bright rims that slowly wobble.
    float e = cells(q * 1.6, uTime * 0.6);
    base = mix(uAlt, base, smoothstep(0.02, 0.16, e));
    base += vec3(0.08) * fbm(q * 3.0);
  } else if (uMode > 2.5 && uMode < 3.5) {
    // Lava: dark crust plates with glowing, pulsing cracks.
    float e = cells(q * 1.4, uTime * 0.25);
    float crack = 1.0 - smoothstep(0.0, 0.12, e);
    float pulse = 0.8 + 0.2 * sin(uTime * 2.0 + q.x * 2.0);
    base = mix(base * (0.75 + 0.25 * fbm(q * 2.5)), uAlt, crack * pulse);
  } else if (uMode > 3.5) {
    // Water: dancing caustic light.
    float l = caustic(q * 0.45, uTime * 0.7);
    base = mix(base, uAlt, l * 0.9);
  }
  // Thin wet coat: no raised bevel, just a slightly deeper tone where the
  // paint pools at its edge and a faint wet glint on the lit side.
  float r = uRadius;
  vec2 g = vec2(a(vec2(-r, 0.0)) - a(vec2(r, 0.0)), a(vec2(0.0, -r)) - a(vec2(0.0, r)));
  float edge = clamp(length(g) * 0.7, 0.0, 1.0);
  float lit = max(dot(normalize(g + 1e-5), normalize(vec2(-1.0, -1.0))), 0.0);
  vec3 col = base * (1.0 - 0.07 * edge);
  col += vec3(1.0) * edge * lit * lit * 0.06;
  float sheen = sin((px.x + px.y) * 0.004 - uTime * 0.6);
  col += vec3(1.0) * smoothstep(0.94, 1.0, sheen) * 0.05;
  finalColor = vec4(col * c.a, c.a);
}`;

export type PaintGloss = Filter & {
  uniforms: { uRadius: number; uTime: number; uMode: number; uBoard: Float32Array; uCell: number; uAlt: Float32Array };
};

export function paintGloss(radiusPx: number): PaintGloss {
  return make('paintGloss', PAINT_FRAG, {
    uRadius: { value: radiusPx, type: 'f32' },
    uTime: { value: 0, type: 'f32' },
    uMode: { value: 0, type: 'f32' },
    uBoard: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
    uCell: { value: 64, type: 'f32' },
    uAlt: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
  });
}

// ---------------------------------------------------------------- ball
// The ball's shine: a crisp rim light from the coverage gradient, and a
// highlight band that sweeps across in the direction of travel while it
// rolls, so it reads as a glossy sphere in motion.
const BALL_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uRadius;
uniform float uPhase;
uniform float uRoll;
uniform vec2 uDir;
float a(vec2 o) { return texture(uTexture, vTextureCoord + o * uInputSize.zw).a; }
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  if (c.a < 0.004) { finalColor = c; return; }
  float r = uRadius;
  vec2 g = vec2(a(vec2(-r, 0.0)) - a(vec2(r, 0.0)), a(vec2(0.0, -r)) - a(vec2(0.0, r)));
  float rim = clamp(length(g), 0.0, 1.0);
  // Rim: bright on the upper left, cool bounce on the lower right.
  float side = dot(normalize(g + 1e-5), normalize(vec2(-1.0, -1.0)));
  vec3 col = c.rgb;
  col += vec3(1.0) * rim * max(side, 0.0) * 0.35 * c.a;
  col += vec3(0.55, 0.65, 1.0) * rim * max(-side, 0.0) * 0.18 * c.a;
  // Rolling shine band.
  vec2 px = vTextureCoord * uInputSize.xy;
  float s = dot(px, uDir) / (uRadius * 6.0);
  float band = exp(-pow((fract(s - uPhase) - 0.5) * 7.0, 2.0));
  col += vec3(1.0) * band * uRoll * 0.32 * c.a * (1.0 - rim);
  finalColor = vec4(col, c.a);
}`;

export type BallShine = Filter & { uniforms: { uRadius: number; uPhase: number; uRoll: number; uDir: Float32Array } };

export function ballShine(radiusPx: number): BallShine {
  return make('ballShine', BALL_FRAG, {
    uRadius: { value: radiusPx, type: 'f32' },
    uPhase: { value: 0, type: 'f32' },
    uRoll: { value: 0, type: 'f32' },
    uDir: { value: new Float32Array([0, 1]), type: 'vec2<f32>' },
  });
}

// ---------------------------------------------------------------- board
// Board light: a soft pool of light that follows the ball across the floor
// and a gentle key light from the upper left, so the board feels lit
// rather than flat.
const LIGHT_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec2 uLight;
uniform float uRadius;
uniform float uStrength;
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 px = vTextureCoord * uInputSize.xy;
  float d = length(px - uLight) / uRadius;
  float pool = exp(-d * d * 1.6);
  vec3 col = c.rgb * (1.0 + pool * uStrength);
  finalColor = vec4(col, c.a);
}`;

export type BoardLight = Filter & { uniforms: { uLight: Float32Array; uRadius: number; uStrength: number } };

export function boardLight(radiusPx: number): BoardLight {
  return make('boardLight', LIGHT_FRAG, {
    uLight: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
    uRadius: { value: radiusPx, type: 'f32' },
    uStrength: { value: 0.16, type: 'f32' },
  });
}
