import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: [
      // `rete-lit-plugin`'s published bundle imports `lit` subpaths without
      // the `.js` extension (e.g. `lit/decorators`, `lit/directives/style-map`).
      // Lit 3's package.json `exports` map only defines the `.js`-suffixed
      // forms, so these bare specifiers fail to resolve. Redirect any
      // extension-less `lit/...` subpath to its `.js` equivalent; already
      // correct imports (ending in `.js`) are left untouched.
      { find: /^lit\/(?!.*\.js$)(.+)$/, replacement: 'lit/$1.js' },
    ],
  },
})
