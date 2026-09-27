// A real-browser playthrough (installed Chrome, headless, Metal WebGPU): loads the game from a URL, checks the title
// screen, starts the race with a hit-tested click, rides with the keyboard (desktop) or the on-screen controls
// (phone, 390 × 844, touch), and reads the live HUD twice to prove it is written by the frame loop. Used for the
// local build and by G10 against the GitHub Pages deploy.
//   node tools/browser/check.mjs --url=http://127.0.0.1:5191/hillbomb-sf/ [--device=desktop|phone] [--shot=path.png]
import { chromium } from 'playwright-core';

const arg = ( k, d ) => { const a = process.argv.find( ( x ) => x.startsWith( `--${ k }=` ) ); return a ? a.slice( k.length + 3 ) : d; };
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

export async function playthrough( url, device = 'desktop', shot = null ) {

	const phone = device === 'phone';
	const browser = await chromium.launch( { channel: 'chrome', headless: true, args: [ '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required' ] } );
	const ctx = await browser.newContext( phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } } );
	const page = await ctx.newPage();
	const errors = [], fail = [], out = { device, url };
	page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text().slice( 0, 300 ) ); } );
	page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + e.message.slice( 0, 300 ) ) );
	const t0 = Date.now();
	try {

		const res = await page.goto( url, { waitUntil: 'domcontentloaded', timeout: 60000 } );
		out.status = res && res.status();
		await page.waitForFunction( () => ! document.getElementById( 'loader' ) && document.querySelector( '.hb-title-screen.is-on' ), null, { timeout: 240000 } );
		out.loadSeconds = ( Date.now() - t0 ) / 1000;
		// the start button must be the element under its own centre (nothing covering it)
		const start = await page.evaluate( () => {

			const b = document.querySelector( '[data-a=start]' ), r = b.getBoundingClientRect();
			const x = r.left + r.width / 2, y = r.top + r.height / 2;
			return { x, y, hit: document.elementFromPoint( x, y ) === b, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };

		} );
		if ( ! start.hit || ! start.inView ) fail.push( `title: the start button is not reachable (hit ${ start.hit }, in view ${ start.inView })` );
		if ( phone ) await page.touchscreen.tap( start.x, start.y ); else await page.mouse.click( start.x, start.y );
		await page.waitForFunction( () => document.querySelector( '.hb-root.is-racing' ), null, { timeout: 10000 } );
		const hud = () => page.evaluate( () => ( { kmh: document.querySelector( '.hb-kmh' ).textContent, time: document.querySelector( '.hb-t' ).textContent, pos: document.querySelector( '.hb-pos b' ).textContent,
			s: window.__app.game.race.player.bike.s, phase: window.__app.game.race.phase } ) );
		if ( phone ) {

			// every on-screen control inside the viewport and the element under its own centre
			const ctl = await page.evaluate( () => [ ...document.querySelectorAll( '.hb-tb, .hb-steer' ) ].map( ( el ) => {

				const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
				const top = document.elementFromPoint( x, y );
				return { k: el.dataset.k || 'steer', inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, hit: top === el || el.contains( top ), x, y };

			} ) );
			out.controls = ctl.length;
			for ( const c of ctl ) if ( ! c.inView || ! c.hit ) fail.push( `touch: control ${ c.k } ${ c.inView ? '' : 'outside the viewport' } ${ c.hit ? '' : 'covered' }`.trim() );
			// hold PEDAL with a real touch (CDP) through the countdown and 6 s of riding
			const pedal = ctl.find( ( c ) => c.k === 'pedal' );
			const cdp = await ctx.newCDPSession( page );
			await cdp.send( 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [ { x: pedal.x, y: pedal.y, id: 1 } ] } );
			await sleep( 4000 );
			out.a = await hud();
			await sleep( 5000 );
			out.b = await hud();
			await cdp.send( 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] } );

		} else {

			await page.keyboard.down( 'KeyW' );
			await sleep( 4000 );
			out.a = await hud();
			await sleep( 5000 );
			out.b = await hud();
			await page.keyboard.up( 'KeyW' );

		}

		// the HUD is live: the timer and the distance moved between two reads with no new input
		if ( out.a.time === out.b.time ) fail.push( `hud: the race timer did not move (${ out.a.time } → ${ out.b.time })` );
		if ( ! ( out.b.s > out.a.s + 5 ) ) fail.push( `ride: the player did not ride on (s ${ out.a.s.toFixed( 1 ) } → ${ out.b.s.toFixed( 1 ) })` );
		if ( ! ( Number( out.b.kmh ) > 3 ) ) fail.push( `hud: speed readout ${ out.b.kmh } km/h after pedalling` );
		out.fps = await page.evaluate( () => window.__app.fps || 0 );
		out.tier = await page.evaluate( () => window.__app.quality.name );
		if ( shot ) await page.screenshot( { path: shot } );

	} catch ( e ) {

		fail.push( `browser: ${ e.message.split( '\n' )[ 0 ].slice( 0, 240 ) }` );

	}

	for ( const e of errors.filter( ( x ) => ! /favicon|fonts\.g/.test( x ) ) ) fail.push( `console: ${ e }` );
	await browser.close();
	out.fail = fail;
	return out;

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	const r = await playthrough( arg( 'url', 'http://127.0.0.1:5191/hillbomb-sf/' ), arg( 'device', 'desktop' ), arg( 'shot', null ) );
	console.log( JSON.stringify( r, null, 1 ) );
	process.exit( r.fail.length ? 1 : 0 );

}
