// G8 Budget (Mac mini M4): the scripted path — a whole seed-1 race on autopilot, all four riders, the director's
// cameras, the marine layer forced in a third of the way down — at the `low` tier, 1920×1080, in the real App on
// the M4 GPU (headless Dawn → Metal, no vsync). Checks, calibrated on first run and frozen in SPEC-THRESHOLDS.md:
// an fps floor on the 95th-percentile frame (target ≥ 40 fps), a GPU memory cap (the process's footprint
// "(graphics)" categories: Metal allocations), and no swap-outs during the run (vm_stat).
// Frame time = CPU + GPU serialised (each frame waits for the GPU), an upper bound on the pipelined cost.
// --negative: rendering at 4K must break the fps floor, a leaked GPU allocation the memory cap, and a recorded
// swap-out the swap check.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readThresholds, freeze } from './lib/thresholds.mjs';

const NEG = process.argv.includes( '--negative' );
const FPS_TARGET = 40;

function gpuMemory( pid ) {

	const r = spawnSync( 'footprint', [ '-f', 'bytes', String( pid ) ], { encoding: 'utf8' } );
	let gpu = 0, total = 0;
	for ( const line of ( r.stdout || '' ).split( '\n' ) ) {

		const m = line.match( /^\s*(\d+)\s*B?\s+(\d+)\s*B?\s+(\d+)\s*B?\s+(\d+)\s+(.+)$/ );
		// Metal (Dawn) allocations: every "(graphics)" category — mostly "Owned physical footprint (unmapped)
		// (graphics)", plus "IOAccelerator (graphics)" (D36; the first cap summed IOAccelerator|IOSurface only)
		if ( m && /\(graphics\)/i.test( m[ 5 ] ) ) gpu += Number( m[ 1 ] );
		const t = line.match( /Footprint:\s*(\d+)\s*B/ );
		if ( t ) total = Number( t[ 1 ] );

	}

	return { gpuMB: gpu / 2 ** 20, footprintMB: total / 2 ** 20 };

}

async function run( sabotage ) {

	const { bootApp } = await import( '../tools/headless/app.mjs' );
	const uhd = sabotage === 'uhd';
	const H = await bootApp( { width: uhd ? 3840 : 1920, height: uhd ? 2160 : 1080, query: '?capture=1&noAudio&tier=low&seed=1' } );
	const api = globalThis.__HILLBOMB;
	const app = H.app;
	let leak = null;
	if ( sabotage === 'leak' ) {

		// a leaked 1.5 GB of GPU buffers, written so the memory is committed
		leak = [];
		for ( let i = 0; i < 6; i ++ ) {

			const b = H.GPU.device.createBuffer( { size: 256 * 2 ** 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST } );
			H.GPU.queue.writeBuffer( b, 0, new Uint8Array( 256 * 2 ** 20 ).fill( 1 ) );
			leak.push( b );

		}

	}

	app.settings.timeOfDay = 17.45;
	api.autopilot( true );
	const dt = 1 / 60;
	for ( let i = 0; i < 60; i ++ ) { api.step( 2 ); app.frame( dt ); } // warm-up (not measured)
	await H.settle();
	const ms = [];
	let mem = { gpuMB: 0, footprintMB: 0 };
	const race = app.game.race;
	while ( ! race.player.finishTime && race.t < 200 ) {

		if ( ! race.weather.started && race.player.bike.s > race.route.length / 3 ) { api.weather( 'fog' ); race.weather.started = true; }
		api.step( 2 );
		const t0 = performance.now();
		app.frame( dt );
		await H.settle();
		ms.push( performance.now() - t0 );
		if ( ms.length % 600 === 300 ) { const m = gpuMemory( process.pid ); if ( m.gpuMB > mem.gpuMB ) mem = m; }

	}

	const s = [ ...ms ].sort( ( a, b ) => a - b ), q = ( f ) => s[ Math.min( s.length - 1, Math.floor( f * s.length ) ) ];
	return { frames: ms.length, p50: q( 0.5 ), p95: q( 0.95 ), p99: q( 0.99 ), max: s.at( - 1 ), ...mem, errors: H.errors.filter( ( e ) => ! /localstorage-file|trace-warnings/.test( e ) ).length, finish: race.player.finishTime, keep: leak ? leak.length : 0 };

}

if ( process.argv.includes( '--run' ) ) {

	const s = ( process.argv.find( ( a ) => a.startsWith( '--sabotage=' ) ) || '' ).split( '=' )[ 1 ];
	console.log( 'RUN ' + JSON.stringify( await run( s ) ) );
	process.exit( 0 );

}

const swapouts = ( text ) => Number( ( text.match( /Swapouts:\s+(\d+)/ ) || [] )[ 1 ] );
const vmstat = () => spawnSync( 'vm_stat', { encoding: 'utf8' } ).stdout;

function runChild( sabotage = '' ) {

	const before = vmstat();
	const r = spawnSync( process.execPath, [ fileURLToPath( import.meta.url ), '--run', ...( sabotage ? [ '--sabotage=' + sabotage ] : [] ) ], { encoding: 'utf8', maxBuffer: 1 << 26 } );
	const after = vmstat();
	const line = ( r.stdout || '' ).split( '\n' ).find( ( l ) => l.startsWith( 'RUN ' ) );
	if ( ! line ) throw new Error( 'run crashed: ' + ( r.stderr || '' ).slice( - 800 ) );
	return { ...JSON.parse( line.slice( 4 ) ), swapBefore: before, swapAfter: after };

}

function judge( m, T ) {

	const fail = [], fps95 = 1000 / m.p95;
	const swaps = swapouts( m.swapAfter ) - swapouts( m.swapBefore );
	console.log( `race path: ${ m.frames } frames at 1920×1080 low tier (player finish ${ m.finish && m.finish.toFixed( 1 ) } s) — p50 ${ m.p50.toFixed( 1 ) } ms, p95 ${ m.p95.toFixed( 1 ) } ms (${ fps95.toFixed( 1 ) } fps), p99 ${ m.p99.toFixed( 1 ) } ms, max ${ m.max.toFixed( 1 ) } ms; GPU memory ${ m.gpuMB.toFixed( 0 ) } MB (process footprint ${ m.footprintMB.toFixed( 0 ) } MB); swap-outs during the run ${ swaps }` );
	if ( m.errors ) fail.push( `render: ${ m.errors } console/GPU errors` );
	if ( ! ( fps95 >= T[ 'G8.fpsFloor' ] ) ) fail.push( `fps: 95th-percentile frame ${ m.p95.toFixed( 1 ) } ms = ${ fps95.toFixed( 1 ) } fps, floor ${ T[ 'G8.fpsFloor' ] } fps` );
	if ( ! ( m.gpuMB <= T[ 'G8.gpuMemoryMB' ] ) ) fail.push( `memory: GPU memory ${ m.gpuMB.toFixed( 0 ) } MB, cap ${ T[ 'G8.gpuMemoryMB' ] } MB` );
	if ( ! ( swaps === 0 ) ) fail.push( `swap: ${ swaps } swap-outs during the run` );
	return fail;

}

let T = readThresholds();
if ( ! ( 'G8.fpsFloor' in T ) || ! ( 'G8.gpuMemoryMB' in T ) ) {

	const m = runChild();
	const fps95 = 1000 / m.p95, today = new Date().toISOString().slice( 0, 10 );
	if ( fps95 < FPS_TARGET ) { console.log( `G8 FAIL — calibration run is ${ fps95.toFixed( 1 ) } fps at p95, below the ${ FPS_TARGET } fps target; not freezing` ); process.exit( 1 ); }
	freeze( 'G8.fpsFloor', Math.max( FPS_TARGET, Math.floor( 0.8 * fps95 ) ), `95th-percentile fps on the race path (gates/g8.mjs), 1920×1080, low tier, M4 (Metal); measured ${ fps95.toFixed( 1 ) } fps (p95 ${ m.p95.toFixed( 1 ) } ms, CPU+GPU serialised) on ${ today }; floor = max( ${ FPS_TARGET }, 0.8 × measured )` );
	freeze( 'G8.gpuMemoryMB', Math.ceil( 1.25 * m.gpuMB ), `GPU memory (footprint "(graphics)" categories: Metal allocations) of the App process on the path, peak; measured ${ m.gpuMB.toFixed( 0 ) } MB on ${ today }; cap = 1.25 × measured` );
	T = readThresholds();

}

if ( ! NEG ) {

	const fail = judge( runChild(), T );
	if ( fail.length ) { console.log( 'G8 FAIL\n- ' + fail.join( '\n- ' ) ); process.exit( 1 ); }
	console.log( `G8 PASS — ≥ ${ T[ 'G8.fpsFloor' ] } fps at p95, GPU memory ≤ ${ T[ 'G8.gpuMemoryMB' ] } MB, no swap on the M4 path` );
	process.exit( 0 );

}

// Negatives. The swap fixture is a recorded vm_stat pair (forcing real swap would thrash the user's machine).
const MUTATIONS = [
	[ 'rendered at 3840×2160 (4× the pixels)', 'fps:', () => judge( runChild( 'uhd' ), T ) ],
	[ 'a leaked 1.5 GB of GPU buffers', 'memory:', () => judge( runChild( 'leak' ), T ) ],
	[ 'swap-outs recorded during the run', 'swap:', () => judge( { frames: 1, p50: 1, p95: 1, p99: 1, max: 1, gpuMB: 1, footprintMB: 1, errors: 0, swapBefore: 'Swapouts: 1000.', swapAfter: 'Swapouts: 1450.' }, T ) ],
];
let missed = 0;
for ( const [ name, label, fn ] of MUTATIONS ) {

	const fail = fn().filter( ( m ) => m.startsWith( label ) );
	console.log( `${ fail.length ? 'caught  ' : 'MISSED  ' } ${ name }${ fail.length ? ' — ' + fail[ 0 ] : '' }` );
	if ( ! fail.length ) missed ++;

}

console.log( `NEGATIVE ${ MUTATIONS.length - missed }/${ MUTATIONS.length }` ); // verify.sh requires every mutation caught
process.exit( missed ? 0 : 1 );
