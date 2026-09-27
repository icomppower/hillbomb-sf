// Game audio (SPEC §8): real CC0 recordings (public/audio, credits in public/audio/CREDITS.md), mixed in Web Audio.
// The player's bike: a rolling loop per surface (tarmac / brick / wood), the freewheel when coasting, the stair
// rattle on the steps, a skid loop when sliding; wind rising with speed; the city behind, the bay's water and
// gulls on the Embarcadero. One-shots: landings, crashes, stair hits, the F-line bell over the rails and at the
// countdown, the foghorn when the marine layer arrives, the Ferry Building's bells and a crowd at the finish.
// No music (M mutes). Headless (no AudioContext) it stays silent. The mix never feeds back into the sim.
import BANK from './soundBank.js';
import { SURFACE } from '../sim/route.js';

// target loudness (LUFS) per sound at full level; gain = 10^((target − measured) / 20)
const MIX = {
	roll_tarmac: - 22, roll_brick: - 21, roll_wood: - 21, freewheel: - 27, stair_rattle: - 20, skid_loop: - 21, wind: - 20,
	city: - 30, pier_lap: - 28, gull: - 26, skid: - 18, land: - 16, stair_hit: - 20, crash: - 14, foghorn: - 20,
	fline_bell: - 18, crowd: - 20, clock_bells: - 19,
};
const LOOPS = [ 'roll_tarmac', 'roll_brick', 'roll_wood', 'freewheel', 'stair_rattle', 'skid_loop', 'wind', 'city', 'pier_lap' ];
const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';

export class GameAudio {

	constructor() {

		this.muted = false;
		this.enabled = typeof window !== 'undefined' && !! ( window.AudioContext || window.webkitAudioContext ) && !! ( typeof document !== 'undefined' && document.head );
		this.ctx = null;
		this.buffers = {};
		this.loops = {};
		this._gullT = 3;
		this._fogHorn = 0;
		this._lastRail = - 1;
		this._riserK = - 1;

	}

	// on a user gesture: create the context, start loading, start the loops once decoded
	resume() {

		if ( ! this.enabled ) return;
		if ( ! this.ctx ) {

			const AC = window.AudioContext || window.webkitAudioContext;
			this.ctx = new AC();
			this.master = this.ctx.createGain();
			this.master.gain.value = this.muted ? 0 : 0.9;
			this.master.connect( this.ctx.destination );
			this._load();

		}

		if ( this.ctx.state === 'suspended' ) this.ctx.resume();

	}

	setMuted( m ) {

		this.muted = m;
		if ( this.master ) this.master.gain.setTargetAtTime( m ? 0 : 0.9, this.ctx.currentTime, 0.05 );

	}

	async _load() {

		await Promise.all( Object.entries( BANK ).map( async ( [ name, b ] ) => {

			try {

				const r = await fetch( base + 'audio/' + b.file );
				this.buffers[ name ] = await this.ctx.decodeAudioData( await r.arrayBuffer() );

			} catch ( e ) { /* a missing sound stays silent */ }

		} ) );
		for ( const name of LOOPS ) {

			const buf = this.buffers[ name ];
			if ( ! buf ) continue;
			const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
			src.buffer = buf;
			src.loop = true;
			g.gain.value = 0;
			src.connect( g ).connect( this.master );
			src.start( 0, Math.random() * buf.duration );
			this.loops[ name ] = { src, g, k: this._k( name ) };

		}

	}

	_k( name ) { return 10 ** ( ( MIX[ name ] - ( typeof BANK[ name ].lufs === 'number' ? BANK[ name ].lufs : - 20 ) ) / 20 ); }

	_set( name, level, rate = null, tc = 0.08 ) {

		const L = this.loops[ name ];
		if ( ! L ) return;
		L.g.gain.setTargetAtTime( Math.max( 0, level ) * L.k, this.ctx.currentTime, tc );
		if ( rate !== null ) L.src.playbackRate.setTargetAtTime( rate, this.ctx.currentTime, 0.1 );

	}

	play( name, level = 1, { rate = 1, pan = 0, slice = null } = {} ) {

		if ( ! this.ctx || ! this.buffers[ name ] || this.muted ) return;
		const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
		src.buffer = this.buffers[ name ];
		src.playbackRate.value = rate;
		g.gain.value = level * this._k( name );
		let node = src.connect( g );
		if ( pan && this.ctx.createStereoPanner ) { const p = this.ctx.createStereoPanner(); p.pan.value = Math.max( - 1, Math.min( 1, pan ) ); node = node.connect( p ); }
		node.connect( this.master );
		if ( slice ) src.start( 0, slice[ 0 ], slice[ 1 ] ); else src.start();

	}

	// race events → one-shots (the player's, and rivals' nearby ones quieter)
	event( e, race ) {

		if ( ! this.ctx ) return;
		const you = e.rider === 0;
		const near = ( i ) => { const d = Math.abs( race.riders[ i ].bike.s - race.player.bike.s ); return Math.max( 0, 1 - d / 30 ); };
		switch ( e.type ) {

			case 'count': this.play( 'fline_bell', 0.7, { rate: 1.0 } ); break;
			case 'go': this.play( 'fline_bell', 1, { rate: 1.12 } ); break;
			case 'land': this.play( 'land', ( you ? 1 : 0.5 * near( e.rider ) ) * Math.min( 1, 0.35 + e.air * 0.6 ), { rate: 0.9 + Math.random() * 0.2 } ); break;
			case 'crash': this.play( 'crash', you ? 1 : 0.6 * near( e.rider ), { rate: 0.95 + Math.random() * 0.1 } ); break;
			case 'contact': if ( e.a === 0 || e.b === 0 ) this.play( 'land', 0.5, { rate: 1.3 } ); break;
			case 'fog': this.play( 'foghorn', 1 ); this._fogHorn = 25; break;
			case 'finish': if ( you ) { this.play( 'clock_bells', 1 ); this.play( 'crowd', 1 ); } break;

		}

	}

	update( dt, { race } ) {

		if ( ! this.ctx || ! Object.keys( this.loops ).length ) return;
		const b = race.player.bike, route = race.route;
		const racing = race.phase !== 'countdown' && b.crash <= 0;
		const v = racing ? b.speed : 0, ground = racing && ! b.air;
		const surf = b.surface, wood = surf === SURFACE.woodStairs || surf === SURFACE.wood, brick = surf === SURFACE.brick || surf === SURFACE.stairs || surf === SURFACE.concrete;
		const roll = ground ? Math.min( 1, v / 14 ) : 0, rate = 0.8 + Math.min( 0.6, v / 40 );
		this._set( 'roll_tarmac', ! wood && ! brick ? roll : 0, rate );
		this._set( 'roll_brick', brick ? roll * 0.9 : 0, rate );
		this._set( 'roll_wood', wood ? roll : 0, rate );
		this._set( 'freewheel', racing && ! ( race.player.input && race.player.input.pedal ) && v > 1.5 ? Math.min( 1, v / 10 ) : 0, 0.7 + Math.min( 0.8, v / 25 ) );
		this._set( 'stair_rattle', ground && b.stairs ? Math.min( 1, v / 8 ) : 0, 0.9 + Math.min( 0.4, v / 30 ) );
		this._set( 'skid_loop', ground && v > 3 ? Math.min( 1, Math.max( 0, b.slip - 0.25 ) * 1.6 ) : 0, 1, 0.04 );
		this._set( 'wind', Math.min( 1, ( v / 22 ) ** 2 ) * ( b.air ? 1.2 : 1 ), 0.9 + Math.min( 0.3, v / 60 ) );
		// the waterfront: the city behind the promenade, the water against the sea wall, gulls
		const sec = route.sectionAt( b.s ), waterfront = sec >= 6;
		this._set( 'city', waterfront ? 0.8 : 0.6, null, 0.5 );
		this._set( 'pier_lap', waterfront ? 0.9 : 0, null, 0.8 );
		this._gullT -= dt;
		if ( waterfront && this._gullT <= 0 ) {

			const g = BANK.gull.slices[ Math.floor( Math.random() * BANK.gull.slices.length ) ];
			this.play( 'gull', 0.6 + Math.random() * 0.4, { pan: Math.random() * 1.6 - 0.8, slice: g, rate: 0.9 + Math.random() * 0.2 } );
			this._gullT = 4 + Math.random() * 7;

		}

		// the F-line rails under the wheels: a clank (the bell, low and short); a stair hit on each landing between flights
		for ( const r of route.rails ) if ( Math.abs( b.s - r ) < 0.5 && this._lastRail !== r && ground ) { this._lastRail = r; this.play( 'stair_hit', 0.9, { rate: 0.7 } ); this.play( 'fline_bell', 0.35, { rate: 0.9 } ); }
		const f = route.flightAt( b.s );
		if ( f && ground ) {

			const k = Math.floor( ( b.s - f.s0 ) / f.tread );
			if ( k !== this._riserK && Math.random() < 0.35 ) this.play( 'stair_hit', 0.25 + Math.min( 0.4, v / 25 ), { rate: 0.85 + Math.random() * 0.3 } );
			this._riserK = k;

		}

		// a skid starts: the one-shot on top of the loop
		const sliding = ground && b.slip > 0.6 && v > 6;
		if ( sliding && ! this._sliding ) this.play( 'skid', 0.7 );
		this._sliding = sliding;
		// the foghorn every so often while the layer is in
		if ( race.weather.wet > 0.5 ) {

			this._fogHorn -= dt;
			if ( this._fogHorn <= 0 ) { this.play( 'foghorn', 0.55, { pan: - 0.5 } ); this._fogHorn = 22 + Math.random() * 10; }

		}

	}

}
