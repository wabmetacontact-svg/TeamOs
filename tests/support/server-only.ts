/**
 * `server-only` throws on import outside a React Server Component, which is the
 * whole point of the package — but the modules under test are server modules,
 * and Vitest is a plain Node process. Aliasing it to nothing lets the tests
 * import the real files instead of copies of them.
 */
export {};
