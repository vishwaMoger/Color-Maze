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

type Uniforms = Record<string, { value: number | Float32Array; type: 'f32' | 'vec2<f32>' }>;

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
// Wet, glossy paint: a bevel derived from the paint's own coverage (its
// edges against bare floor rise like a thick coat), lit from the upper
// left with a tight specular and a soft sheen that drifts across.
const PAINT_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uRadius;
uniform float uTime;
float a(vec2 o) { return texture(uTexture, vTextureCoord + o * uInputSize.zw).a; }
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  if (c.a < 0.004) { finalColor = c; return; }
  float r = uRadius;
  vec2 g = vec2(a(vec2(-r, 0.0)) - a(vec2(r, 0.0)), a(vec2(0.0, -r)) - a(vec2(0.0, r)));
  g += 0.6 * vec2(a(vec2(-r * 0.5, 0.0)) - a(vec2(r * 0.5, 0.0)), a(vec2(0.0, -r * 0.5)) - a(vec2(0.0, r * 0.5)));
  vec3 n = normalize(vec3(g, 0.9));
  vec3 L = normalize(vec3(-0.55, -0.65, 0.6));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = dot(n, L);
  float spec = pow(max(dot(n, H), 0.0), 28.0);
  vec3 col = c.rgb * (0.94 + 0.14 * diff);
  col += vec3(1.0) * spec * 0.55 * c.a;
  vec2 px = vTextureCoord * uInputSize.xy;
  float sheen = sin((px.x + px.y) * 0.004 - uTime * 0.6);
  col += vec3(1.0) * smoothstep(0.93, 1.0, sheen) * 0.08 * c.a;
  finalColor = vec4(col, c.a);
}`;

export type PaintGloss = Filter & { uniforms: { uRadius: number; uTime: number } };

export function paintGloss(radiusPx: number): PaintGloss {
  return make('paintGloss', PAINT_FRAG, {
    uRadius: { value: radiusPx, type: 'f32' },
    uTime: { value: 0, type: 'f32' },
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
