import { App } from './App.js';

// Boot: the loading screen in index.html reports the App's stages; then the game takes over (src/game/).
const $ = ( s ) => document.querySelector( s );
const t0 = performance.now();
function setLoading( p, text ) {

	$( '.loader-fill' ).style.width = ( p * 100 ).toFixed( 1 ) + '%';
	$( '.loader-pct' ).textContent = Math.round( p * 100 ) + '%';
	if ( text ) $( '.loader-status' ).textContent = text;
	const s = Math.round( ( performance.now() - t0 ) / 1000 );
	$( '.loader-time' ).textContent = `${ Math.floor( s / 60 ) }:${ String( s % 60 ).padStart( 2, '0' ) }`;

}

const app = new App();
window.__app = app; // debugging / browser checks

app.init( setLoading ).then( () => {

	setLoading( 1, 'Ready' );
	const l = $( '#loader' );
	l.classList.add( 'is-done' );
	setTimeout( () => l.remove(), 700 );
	app.start();

} ).catch( ( e ) => {

	console.error( e );
	$( '.loader-status' ).textContent = 'Something went wrong: ' + e.message;
	$( '#loader' ).classList.add( 'is-error' );

} );
