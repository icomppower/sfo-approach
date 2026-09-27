import { defineConfig } from 'vite';
import { harborEngine } from 'harbor-engine/vite';

export default defineConfig( {
	base: './', // GitHub Pages serves the build under /sfo-approach/
	plugins: [ harborEngine() ],
	build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
} );
