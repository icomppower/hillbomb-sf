import { defineConfig } from 'vite';

export default defineConfig( {
	// relative asset paths: the build runs from any sub-path (GitHub Pages serves it under /tidewater/)
	base: '/hillbomb-sf/', // GitHub Pages serves it under /hillbomb-sf/
	build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
	server: { port: 5190, strictPort: true, host: '127.0.0.1' },
} );
