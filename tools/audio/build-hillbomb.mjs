// HILLBOMB SF sounds (SPEC §8): CC0 Freesound previews (raw/, fetched by dl.mjs) → excerpts chosen from the signal
// (loops: the steadiest window; one-shots: the loudest event with its tail) → loudness-normalised → Opus/Ogg in
// out/ + bank.json (file, loop, loudness). Nothing is synthesised. Then: cp out/*.ogg ../../public/audio/ and copy
// bank.json into src/game/soundBank.js (export default).
//   node build-hillbomb.mjs
import fs from 'node:fs';
import { SR, decode, writeWav, encode, makeLoop, fade, gain, peak, momentary, events, lufsOf } from './lib.mjs';

fs.mkdirSync( 'work', { recursive: true } );
fs.mkdirSync( 'out', { recursive: true } );

// the steadiest window of `len` s (lowest spread of momentary loudness, not too quiet)
function steadiest( chans, len, { from = 0, to = Infinity } = {} ) {

	const m = momentary( chans ), win = Math.round( len * 10 ), a = Math.round( from * 10 ), b = Math.min( m.length, Math.round( to * 10 ) );
	const med = [ ...m.slice( a, b ) ].sort( ( x, y ) => x - y )[ Math.floor( ( b - a ) / 2 ) ];
	let best = a, bs = Infinity;
	for ( let k = a; k + win <= b; k ++ ) {

		const w = m.slice( k, k + win ), mean = w.reduce( ( s, v ) => s + v, 0 ) / w.length;
		const sd = Math.sqrt( w.reduce( ( s, v ) => s + ( v - mean ) ** 2, 0 ) / w.length );
		const score = sd + Math.max( 0, med - mean ) * 0.5; // steady, and not a quiet lull
		if ( score < bs ) { bs = score; best = k; }

	}

	return best / 10;

}

const slice = ( chans, t0, len ) => chans.map( ( c ) => c.slice( Math.floor( t0 * SR ), Math.floor( ( t0 + len ) * SR ) ) );
const bank = {};

// loops: `len` s + a crossfade, normalised to -23 LUFS integrated
function loop( name, raw, len, { ch = 1, from = 0, to = Infinity, kbps = 48, at = null, xf = 0.4 } = {} ) {

	const full = decode( `raw/${ raw }`, ch );
	const t0 = at ?? steadiest( full, len + xf, { from, to } );
	const seg = slice( full, t0, len + xf );
	const L = Math.floor( len * SR ), X = Math.floor( xf * SR );
	const out = makeLoop( seg, L, X );
	finish( name, out, { loop: true, ch, kbps, target: - 23, src: raw, t0 } );

}

// one-shots: the loudest event (or a given window), faded, peak -1 dBFS
function shot( name, raw, { ch = 1, at = null, len = null, maxLen = 3, kbps = 64, from = 0, to = Infinity, tail = 0.15 } = {} ) {

	const full = decode( `raw/${ raw }`, ch );
	let t0 = at, dur = len;
	if ( t0 === null ) {

		const ev = events( full[ 0 ], { from, to, maxLen, minLen: 0.05, thrDb: 10, relEnd: 36 } ).list.sort( ( a, b ) => b.pk - a.pk )[ 0 ];
		t0 = ev ? ev.t : from;
		dur = dur ?? ( ev ? ev.len + tail : maxLen );

	}

	const seg = fade( slice( full, t0, dur ), Math.floor( 0.004 * SR ), Math.floor( Math.min( 0.25, dur * 0.3 ) * SR ) );
	gain( seg, 10 ** ( - 1 / 20 ) / Math.max( 1e-6, peak( seg ) ) );
	finish( name, seg, { loop: false, ch, kbps, src: raw, t0 } );

}

function finish( name, chans, { loop, ch, kbps, target, src, t0 } ) {

	const wav = `work/${ name }.wav`;
	writeWav( wav, chans );
	if ( target !== undefined ) {

		const I = lufsOf( wav ).I;
		if ( Number.isFinite( I ) ) { gain( chans, 10 ** ( ( target - I ) / 20 ) ); if ( peak( chans ) > 0.95 ) gain( chans, 0.95 / peak( chans ) ); writeWav( wav, chans ); }

	}

	const out = `out/${ name }.ogg`;
	encode( wav, out, kbps, ch );
	const L = lufsOf( wav );
	bank[ name ] = { file: `${ name }.ogg`, loop, lufs: Math.round( L.I * 10 ) / 10, duration: Math.round( chans[ 0 ].length / SR * 100 ) / 100, source: src.replace( /\..*$/, '' ), from: Math.round( t0 * 100 ) / 100 };
	console.log( `${ name.padEnd( 14 ) } ${ loop ? 'loop' : 'shot' } ${ bank[ name ].duration.toFixed( 2 ) }s from ${ t0.toFixed( 2 ) }s of ${ src }  ${ L.I.toFixed( 1 ) } LUFS  ${ ( fs.statSync( out ).size / 1024 ).toFixed( 0 ) } KB` );

}

const raw = ( id ) => fs.readdirSync( 'raw' ).find( ( f ) => f.startsWith( id + '.' ) && ! f.endsWith( '.json' ) );

// rolling / riding loops (the tyre by surface, the freewheel, the stair rattle)
loop( 'freewheel', raw( 274481 ), 1.6, { xf: 0.2, at: 0.1 } );
loop( 'roll_tarmac', raw( 368176 ), 5 );
loop( 'roll_brick', raw( 243719 ), 5 );
loop( 'roll_wood', raw( 243762 ), 5 );
loop( 'stair_rattle', raw( 120373 ), 4, { xf: 0.25 } );
loop( 'skid_loop', raw( 185346 ), 0.8, { xf: 0.2, at: 0.1 } );
// ambience
loop( 'city', raw( 332562 ), 24, { ch: 2, kbps: 64, xf: 1.5 } );
// one-shots
shot( 'skid', raw( 185346 ), { maxLen: 1.4 } );
shot( 'land', raw( 364690 ), { maxLen: 0.8 } );
shot( 'stair_hit', raw( 154450 ), { maxLen: 0.4 } );
shot( 'crash', raw( 78483 ), { at: 0, len: 2.0 } ); // the tumble and scrape (the impact at 3.5 s is a second event)
shot( 'foghorn', raw( 140898 ), { at: 58.8, len: 5, ch: 2, kbps: 64 } ); // the clearest of the six blasts
shot( 'fline_bell', raw( 448366 ), { maxLen: 1.6, tail: 0.3 } );
shot( 'crowd', raw( 264377 ), { at: steadiest( decode( `raw/${ raw( 264377 ) }`, 2 ), 7 ), len: 7, ch: 2, kbps: 64 } );
shot( 'clock_bells', raw( 578082 ), { at: 2.3, len: 9, ch: 2, kbps: 64 } ); // the chime before the noon strikes

fs.writeFileSync( 'out/bank.json', JSON.stringify( bank, null, 1 ) + '\n' );

// credits for public/audio/CREDITS.md
const lines = [];
for ( const [ name, b ] of Object.entries( bank ) ) {

	const j = JSON.parse( fs.readFileSync( `raw/${ b.source }.json`, 'utf8' ) );
	lines.push( `| \`${ b.file }\` | [${ j.title }](${ j.url }) by ${ j.user } | ${ b.from } s, ${ b.duration } s${ b.loop ? ', looped' : '' } | ${ j.licName } |` );

}

fs.writeFileSync( 'out/credits.md', lines.join( '\n' ) + '\n' );
