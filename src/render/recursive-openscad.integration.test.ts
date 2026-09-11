import { createOpenSCAD } from 'openscad-wasm-prebuilt'
import { describe, expect, it } from 'vitest'

async function runOpenSCAD(source: string, mode: 'stl' | 'value') {
  const stdout: string[] = []
  const stderr: string[] = []
  const openscad = await createOpenSCAD({ print: (text) => stdout.push(text), printErr: (text) => stderr.push(text) })
  const instance = openscad.getInstance()
  instance.FS.writeFile('/recursive.scad', source)
  const output = mode === 'stl' ? '/recursive.stl' : '/recursive.csg'
  const args = mode === 'stl'
    ? ['/recursive.scad', '--backend=Manifold', '--export-format=binstl', '-o', output]
    : ['/recursive.scad', '-o', output]
  instance.callMain(args)
  return { stdout, stderr, bytes: (instance.FS.readFile(output) as Uint8Array).slice() }
}

describe('recursive Functions through the real bundled OpenSCAD-WASM', () => {
  it('evaluates factorial(5) to 120 and renders nonempty Geometry from it', async () => {
    const result = await runOpenSCAD(`
function factorial(n) = (n <= 1) ? 1 : n * factorial(n - 1);
echo("__SCADLET_VALUE__:", factorial(5));
cube(factorial(5));
`, 'stl')
    expect([...result.stdout, ...result.stderr].join('\n')).toContain('__SCADLET_VALUE__:", 120')
    // A binary STL consists of an 80-byte header, a triangle count, and at
    // least one 50-byte triangle record. This proves the recursive value was
    // accepted by the real geometry path, not just echoed.
    expect(result.bytes.byteLength).toBeGreaterThan(84)
  }, 20_000)

  it('evaluates mutually recursive is_even / is_odd values through the headless echo path', async () => {
    const result = await runOpenSCAD(`
function is_even(n) = (n == 0) ? true : is_odd(n - 1);
function is_odd(n) = (n == 0) ? false : is_even(n - 1);
echo("__SCADLET_VALUE__:", is_even(6), is_odd(5));
`, 'value')
    expect([...result.stdout, ...result.stderr].join('\n')).toContain('__SCADLET_VALUE__:", true, true')
    expect(result.bytes.byteLength).toBeGreaterThan(0)
  }, 20_000)

  it('keeps an acyclic Function render working', async () => {
    const result = await runOpenSCAD(`
function double_size(x) = x * 2;
cube(double_size(5));
`, 'stl')
    expect(result.bytes.byteLength).toBeGreaterThan(84)
    expect(result.stderr.join('\n')).not.toContain('ERROR:')
  }, 20_000)
})

describe('recursive Modules through the real bundled OpenSCAD-WASM', () => {
  it('renders a terminating directly recursive Module', async () => {
    const result = await runOpenSCAD(`
module stack(n = 1) {
  if (n <= 1) {
    cube(5);
  } else {
    union() {
      cube(5);
      translate([0, 0, 5]) stack(n - 1);
    }
  }
}
stack(4);
`, 'stl')
    expect(result.bytes.byteLength).toBeGreaterThan(84)
    expect(result.stderr.join('\n')).not.toContain('ERROR:')
  }, 20_000)

  it('renders mutually recursive Modules when the first declaration calls the later one', async () => {
    const result = await runOpenSCAD(`
module pong(n = 0) {
  if (n <= 0) sphere(3);
  else translate([0, 0, 6]) ping(n - 1);
}
module ping(n = 0) {
  if (n <= 0) cube(4);
  else translate([6, 0, 0]) pong(n - 1);
}
ping(4);
`, 'stl')
    expect(result.bytes.byteLength).toBeGreaterThan(84)
    expect(result.stderr.join('\n')).not.toContain('ERROR:')
  }, 20_000)
})
