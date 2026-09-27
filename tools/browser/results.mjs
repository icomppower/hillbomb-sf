// A whole race in a real browser on autopilot: the finish, the results screen (reachable, with times), the best
// time persisted in localStorage, and "Race again" starting a new race.
//   node tools/browser/results.mjs --url=http://127.0.0.1:5191/hillbomb-sf/
import { chromium } from 'playwright-core';

const arg = ( k, d ) => { const a = process.argv.find( ( x ) => x.startsWith( `--${ k }=` ) ); return a ? a.slice( k.length + 3 ) : d; };
const url = arg( 'url', 'http://127.0.0.1:5191/hillbomb-sf/' ) + '?autopilot&seed=3';
const browser = await chromium.launch( { channel: 'chrome', headless: true, args: [ '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu' ] } );
const page = await browser.newPage( { viewport: { width: 1280, height: 720 } } );
const errors = [], fail = [];
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text() ); } );
page.on( 'pageerror', ( e ) => errors.push( e.message ) );
await page.goto( url );
await page.waitForFunction( () => document.querySelector( '.hb-title-screen.is-on' ), null, { timeout: 240000 } );
await page.click( '[data-a=start]' );
await page.waitForFunction( () => document.querySelector( '.hb-results.is-on' ), null, { timeout: 300000 } );
const r = await page.evaluate( () => {

	const btn = document.querySelector( '.hb-results [data-a=restart]' ), b = btn.getBoundingClientRect();
	return { text: document.querySelector( '.hb-results .hb-panel' ).innerText.replace( /\s+/g, ' ' ).slice( 0, 400 ), best: localStorage.getItem( 'hillbomb-sf-best' ),
		hit: document.elementFromPoint( b.left + b.width / 2, b.top + b.height / 2 ) === btn, t: window.__app.game.race.player.finishTime };

} );
if ( ! r.hit ) fail.push( 'results: the Race again button is covered' );
if ( ! r.best || ! JSON.parse( r.best ).time ) fail.push( 'persist: no best time stored' );
await page.click( '.hb-results [data-a=restart]' );
await page.waitForTimeout( 1500 );
const again = await page.evaluate( () => ( { racing: !! document.querySelector( '.hb-root.is-racing' ), results: !! document.querySelector( '.hb-results.is-on' ), phase: window.__app.game.race.phase } ) );
if ( ! again.racing || again.results ) fail.push( 'restart: Race again did not start a new race' );
fail.push( ...errors.map( ( e ) => 'console: ' + e.slice( 0, 200 ) ) );
console.log( JSON.stringify( { ...r, again, fail }, null, 1 ) );
await browser.close();
process.exit( fail.length ? 1 : 0 );
