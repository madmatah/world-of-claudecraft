// Stable names for the post chain's materials, so the shader corpus can tell
// its programs apart. three's program `name` is `material.name`, and every
// post pass is a `ShaderMaterial` by type, so an unnamed pass material records
// as an anonymous ShaderMaterial the corpus cannot key (the game's own passes
// name theirs through the shader's `name`; the third-party ones, N8AO, the
// bloom pass and SMAA, do not). This walk visits each pass's own fields, two
// levels deep (a material, an array of materials, a full-screen quad holding
// one), and names what is still unnamed `<pass>.<field>` or `<pass>.<field>[i]`.
// Idempotent, never renames a named material, and reports the count per pass
// so a test can pin that a three or n8ao bump did not move a field.

export interface NamedPostPass {
  name: string;
  pass: object;
}

interface MaterialLike {
  isShaderMaterial?: boolean;
  name?: string;
}

const MAX_DEPTH = 2;

function isShaderMaterial(value: unknown): value is MaterialLike & { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as MaterialLike).isShaderMaterial === true &&
    typeof (value as MaterialLike).name === 'string'
  );
}

function nameOne(material: MaterialLike & { name: string }, label: string): number {
  if (material.name !== '') return 0;
  material.name = label;
  return 1;
}

function walk(value: unknown, label: string, depth: number, seen: Set<object>): number {
  if (typeof value !== 'object' || value === null) return 0;
  if (isShaderMaterial(value)) return nameOne(value, label);
  if (depth >= MAX_DEPTH || seen.has(value)) return 0;
  seen.add(value);
  let named = 0;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      named += walk(item, `${label}[${index}]`, depth + 1, seen);
    });
    return named;
  }
  for (const key of Object.keys(value)) {
    const field = (value as Record<string, unknown>)[key];
    // A quad or a pass-owned holder: only its `material` is worth a name, the
    // rest (targets, uniforms, scenes) is not a shader.
    if (typeof field === 'object' && field !== null && !Array.isArray(field)) {
      if (isShaderMaterial(field)) named += nameOne(field, `${label}.${key}`);
      else if (isShaderMaterial((field as { material?: unknown }).material)) {
        named += nameOne(
          (field as { material: MaterialLike & { name: string } }).material,
          `${label}.${key}`,
        );
      }
      continue;
    }
    named += walk(field, `${label}.${key}`, depth + 1, seen);
  }
  return named;
}

/** Name every unnamed ShaderMaterial the passes own; returns the count named
 *  per pass name (zero for a pass whose materials were all named already). */
export function namePostPassMaterials(passes: readonly NamedPostPass[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { name, pass } of passes) {
    counts[name] = walk(pass, name, 0, new Set());
  }
  return counts;
}
