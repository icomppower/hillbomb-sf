// Gate runner (SPEC §12): `node gates/gN.mjs` runs the checks and exits 0 only if none fail; `--negative` runs
// every negative fixture, each of which must make at least one check fail, prints `NEGATIVE caught/total` and
// exits non-zero (verify.sh requires both). Child processes (one App per process) report through stdout lines.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const NEG = process.argv.includes( '--negative' );
export const arg = ( k, d = null ) => { const a = process.argv.find( ( x ) => x.startsWith( `--${ k }=` ) ); return a ? a.slice( k.length + 3 ) : d; };

export async function gate( id, { checks, negatives = [], pass } ) {

	if ( ! NEG ) {

		const fail = [];
		for ( const c of checks ) fail.push( ...( await c() ) );
		if ( fail.length ) { console.log( `${ id } FAIL\n- ` + fail.join( '\n- ' ) ); process.exit( 1 ); }
		console.log( `${ id } PASS — ${ pass }` );
		process.exit( 0 );

	}

	let caught = 0;
	for ( const n of negatives ) {

		// a negative that throws did not run: that is a miss, never a catch. With `expect`, only a failure from the
		// check the fixture targets counts.
		let fail, hit = null;
		try { fail = await n.run(); } catch ( e ) { console.log( `MISSED — ${ n.name }: the fixture threw (${ e.message.slice( 0, 160 ) })` ); continue; }
		hit = fail.find( ( f ) => ! n.expect || n.expect.test( f ) );
		if ( hit ) caught ++;
		console.log( `${ hit ? 'caught' : 'MISSED' } — ${ n.name }${ hit ? ': ' + hit.slice( 0, 200 ) : fail.length ? ' (failed, but not on ' + n.expect + '): ' + fail[ 0 ].slice( 0, 160 ) : '' }` );

	}

	console.log( `NEGATIVE ${ caught }/${ negatives.length }` );
	process.exit( 1 );

}

// run this gate file again as a child with extra args; returns the JSON after `${ tag } ` on stdout
export function child( metaUrl, args, tag = 'RESULT', timeout = 900000 ) {

	const r = spawnSync( process.execPath, [ fileURLToPath( metaUrl ), ...args ], { encoding: 'utf8', maxBuffer: 1 << 27, timeout } );
	const out = r.stdout || '';
	for ( const l of out.split( '\n' ) ) if ( l.startsWith( 'log: ' ) ) console.log( l.slice( 5 ) );
	const line = out.split( '\n' ).find( ( l ) => l.startsWith( tag + ' ' ) );
	if ( ! line ) return { error: `child crashed (exit ${ r.status }${ r.signal ? ' ' + r.signal : '' }): ${ ( r.stderr || '' ).trim().split( '\n' ).slice( - 4 ).join( ' | ' ).slice( 0, 400 ) }` };
	return JSON.parse( line.slice( tag.length + 1 ) );

}
