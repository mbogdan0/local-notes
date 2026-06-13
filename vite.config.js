import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the whole app into a single self-contained dist/index.html
// with all of our CSS and JS inlined.
export default defineConfig({
  plugins: [viteSingleFile()],
});
