import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Current tests are pure logic (src/openscad/*), no DOM needed.
    environment: 'node',
  },
})

