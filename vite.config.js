import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { minify } from 'html-minifier-terser';

// Runs after vite-plugin-singlefile has inlined everything, then fully
// minifies the final HTML markup (whitespace, comments, attributes). The
// inlined <script>/<style> are already minified by Vite; we minify them
// once more here to be safe.
function fullHtmlMinify() {
  return {
    name: 'full-html-minify',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.html')) {
          file.source = await minify(file.source.toString(), {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            removeAttributeQuotes: true,
            collapseBooleanAttributes: true,
            useShortDoctype: true,
            minifyCSS: true,
            minifyJS: true,
            sortAttributes: true,
            sortClassName: true,
          });
        }
      }
    },
  };
}

// Builds the whole app into a single self-contained dist/index.html
// with all of our CSS and JS inlined, then fully minifies the HTML.
export default defineConfig({
  plugins: [viteSingleFile(), fullHtmlMinify()],
});
