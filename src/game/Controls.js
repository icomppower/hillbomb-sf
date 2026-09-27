// Player input (SPEC §10): keyboard, gamepad and touch merged into one sim input each step.
//   Keyboard: W/↑ pedal · A/D ←/→ line · S/↓ brake · Space hop · Shift boost · Q/E front/backflip
//   Gamepad:  RT pedal · LT brake · left stick line · A hop · X boost · LB/RB front/backflip · Start pause
//   Touch:    left thumb steers (drag), right-side buttons pedal / brake / hop / boost / flips
// Menu keys (R, P/Esc, M, V, T, H) are read by the game from `hit()`.

export class Controls {

	constructor( input ) {

		this.input = input; // core/Input.js (keyboard state)
		this.touch = { steer: 0, pedal: false, brake: false, hop: false, boost: false, trick: 0 };
		this.pad = { steer: 0, pedal: false, brake: false, hop: false, boost: false, trick: 0, start: false };
		this.override = null; // capture API: a partial input that wins over the devices
		this._padPrev = {};
		this.touchUI = null;

	}

	pollGamepad() {

		const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
		const g = pads && [ ...pads ].find( ( p ) => p && p.connected );
		const P = this.pad;
		if ( ! g ) { P.steer = 0; P.pedal = P.brake = P.hop = P.boost = false; P.trick = 0; return; }
		const b = ( i ) => g.buttons[ i ] && ( g.buttons[ i ].pressed || g.buttons[ i ].value > 0.3 );
		const x = g.axes[ 0 ] || 0;
		P.steer = Math.abs( x ) > 0.12 ? x : 0;
		P.pedal = b( 7 );
		P.brake = b( 6 );
		P.hop = b( 0 );
		P.boost = b( 2 );
		P.trick = b( 4 ) ? - 1 : b( 5 ) ? 1 : 0;
		const start = b( 9 );
		P.startHit = start && ! this._padPrev.start;
		this._padPrev.start = start;

	}

	// the sim input for this step
	read() {

		const k = ( c ) => this.input.down( c );
		const T = this.touch, P = this.pad;
		let steer = ( k( 'KeyD' ) || k( 'ArrowRight' ) ? 1 : 0 ) - ( k( 'KeyA' ) || k( 'ArrowLeft' ) ? 1 : 0 );
		if ( ! steer ) steer = P.steer || T.steer;
		const inp = {
			pedal: k( 'KeyW' ) || k( 'ArrowUp' ) || P.pedal || T.pedal,
			brake: k( 'KeyS' ) || k( 'ArrowDown' ) || P.brake || T.brake,
			steer: Math.max( - 1, Math.min( 1, steer ) ),
			hop: k( 'Space' ) || P.hop || T.hop,
			boost: k( 'ShiftLeft' ) || k( 'ShiftRight' ) || P.boost || T.boost,
			trick: k( 'KeyQ' ) ? - 1 : k( 'KeyE' ) ? 1 : P.trick || T.trick,
		};
		if ( this.override ) Object.assign( inp, this.override );
		return inp;

	}

	// on-screen controls for touch devices: a steering pad under the left thumb, buttons under the right
	installTouch( root ) {

		const el = document.createElement( 'div' );
		el.className = 'hb-touch';
		el.innerHTML = `
			<div class="hb-steer" aria-label="Steer: drag left or right"><div class="hb-steer-knob"></div></div>
			<div class="hb-pads">
				<button class="hb-tb hb-tb-flip" data-k="flipF" aria-label="Frontflip">Q</button>
				<button class="hb-tb hb-tb-flip" data-k="flipB" aria-label="Backflip">E</button>
				<button class="hb-tb" data-k="boost" aria-label="Boost">BOOST</button>
				<button class="hb-tb" data-k="brake" aria-label="Brake">BRAKE</button>
				<button class="hb-tb hb-tb-big" data-k="hop" aria-label="Hop">HOP</button>
				<button class="hb-tb hb-tb-big" data-k="pedal" aria-label="Pedal">PEDAL</button>
			</div>`;
		root.appendChild( el );
		const T = this.touch;
		const pad = el.querySelector( '.hb-steer' ), knob = el.querySelector( '.hb-steer-knob' );
		let steerId = null, x0 = 0;
		pad.addEventListener( 'touchstart', ( e ) => {

			const t = e.changedTouches[ 0 ];
			steerId = t.identifier;
			x0 = pad.getBoundingClientRect().left + pad.getBoundingClientRect().width / 2;
			e.preventDefault();

		}, { passive: false } );
		const move = ( e ) => {

			for ( const t of e.changedTouches ) if ( t.identifier === steerId ) {

				const r = pad.getBoundingClientRect().width / 2;
				T.steer = Math.max( - 1, Math.min( 1, ( t.clientX - x0 ) / ( r * 0.8 ) ) );
				knob.style.transform = `translateX(${ T.steer * r * 0.6 }px)`;

			}

			e.preventDefault();

		};

		const end = ( e ) => {

			for ( const t of e.changedTouches ) if ( t.identifier === steerId ) { steerId = null; T.steer = 0; knob.style.transform = ''; }

		};

		pad.addEventListener( 'touchmove', move, { passive: false } );
		pad.addEventListener( 'touchend', end );
		pad.addEventListener( 'touchcancel', end );
		for ( const b of el.querySelectorAll( '.hb-tb' ) ) {

			const key = b.dataset.k;
			const set = ( on ) => {

				if ( key === 'flipF' ) T.trick = on ? - 1 : 0;
				else if ( key === 'flipB' ) T.trick = on ? 1 : 0;
				else T[ key ] = on;
				b.classList.toggle( 'is-down', on );

			};

			b.addEventListener( 'touchstart', ( e ) => { set( true ); e.preventDefault(); }, { passive: false } );
			b.addEventListener( 'touchend', ( e ) => { set( false ); e.preventDefault(); }, { passive: false } );
			b.addEventListener( 'touchcancel', () => set( false ) );
			// mouse too (desktop testing with ?touch)
			b.addEventListener( 'mousedown', () => set( true ) );
			b.addEventListener( 'mouseup', () => set( false ) );
			b.addEventListener( 'mouseleave', () => set( false ) );

		}

		this.touchUI = el;
		return el;

	}

}

export function wantsTouch( qs ) {

	return qs.has( 'touch' ) || ( typeof matchMedia === 'function' && matchMedia( '(pointer: coarse)' ).matches );

}
