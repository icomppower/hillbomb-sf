// HUD and menus (SPEC §9): speed, position, run timer, boost, section card on entry, split delta vs best at each
// checkpoint, trick name on landing, crash counter, a route strip with rider dots; title, pause, settings and
// results screens. Plain DOM over the canvas. The HUD is written from the frame loop (never cached text).
const CSS = `
.hb-root{position:fixed;inset:0;pointer-events:none;font-family:Inter,system-ui,sans-serif;color:#f4f1ea;z-index:20;
  -webkit-user-select:none;user-select:none;--acc:#ff7a1a;--glass:rgba(10,12,16,.58);--line:rgba(255,255,255,.12)}
.hb-root *{box-sizing:border-box}
.hb-glass{background:var(--glass);border:1px solid var(--line);border-radius:10px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.hb-hud{position:absolute;inset:0;opacity:0;transition:opacity .4s}
.hb-root.is-racing .hb-hud{opacity:1}
.hb-tl{position:absolute;left:max(16px,env(safe-area-inset-left));top:max(14px,env(safe-area-inset-top));display:flex;gap:10px;align-items:stretch}
.hb-pos{padding:6px 12px;display:flex;align-items:baseline;gap:2px;font-weight:800}
.hb-pos b{font-size:34px;line-height:1;letter-spacing:-.02em}.hb-pos sup{font-size:14px;margin-left:1px}.hb-pos span{font-size:14px;opacity:.6;margin-left:4px}
.hb-time{padding:6px 12px;font:600 22px/1.1 'JetBrains Mono',ui-monospace,monospace;display:flex;flex-direction:column;justify-content:center}
.hb-time small{font:500 11px Inter,sans-serif;opacity:.65;letter-spacing:.06em;text-transform:uppercase}
.hb-tr{position:absolute;right:max(16px,env(safe-area-inset-right));top:max(14px,env(safe-area-inset-top));padding:8px 14px;text-align:right;min-width:128px}
.hb-speed{font:800 38px/1 Inter,sans-serif;letter-spacing:-.02em}.hb-speed small{font-size:13px;font-weight:600;opacity:.65;margin-left:3px}
.hb-boost{margin-top:6px;height:7px;border-radius:4px;background:rgba(255,255,255,.14);overflow:hidden}
.hb-boost i{display:block;height:100%;width:50%;background:linear-gradient(90deg,#ffb35c,var(--acc));border-radius:4px}
.hb-root.is-boosting .hb-boost i{background:linear-gradient(90deg,#fff1c2,#ffb35c)}
.hb-meta{margin-top:5px;font-size:11px;opacity:.7;letter-spacing:.04em;text-transform:uppercase}
.hb-center{position:absolute;left:0;right:0;top:22%;display:flex;flex-direction:column;align-items:center;gap:8px}
.hb-count{font:900 110px/1 Inter,sans-serif;color:#fff;text-shadow:0 6px 30px rgba(0,0,0,.45);opacity:0;transform:scale(.8);transition:opacity .15s,transform .25s}
.hb-count.is-on{opacity:1;transform:scale(1)}
.hb-card{padding:8px 18px;font-weight:700;font-size:18px;letter-spacing:.02em;opacity:0;transform:translateY(-6px);transition:opacity .35s,transform .35s}
.hb-card.is-on{opacity:1;transform:none}.hb-card small{display:block;font-size:10px;font-weight:600;opacity:.6;letter-spacing:.14em;text-transform:uppercase}
.hb-toast{padding:6px 14px;font-weight:800;font-size:22px;opacity:0;transition:opacity .25s,transform .25s;transform:scale(.9);text-shadow:0 2px 10px rgba(0,0,0,.5)}
.hb-toast.is-on{opacity:1;transform:none}.hb-toast.is-good{color:#8cff9a}.hb-toast.is-bad{color:#ff8a7a}.hb-toast.is-trick{color:#ffd166}
.hb-strip{position:absolute;left:max(16px,env(safe-area-inset-left));right:max(16px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));height:34px;padding:0 10px}
.hb-strip canvas{width:100%;height:100%;display:block}
.hb-root.has-touch .hb-strip{bottom:auto;top:calc(max(14px,env(safe-area-inset-top)) + 90px);height:26px}
.hb-screen{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:auto;background:radial-gradient(ellipse at 50% 60%,rgba(0,0,0,.15),rgba(0,0,0,.6))}
.hb-screen.is-on{display:flex}
.hb-panel{width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:22px 22px 18px}
.hb-kicker{font-size:11px;letter-spacing:.2em;text-transform:uppercase;opacity:.7;margin:0}
.hb-title{font:900 clamp(40px,11vw,68px)/.95 Inter,sans-serif;letter-spacing:-.03em;margin:6px 0 4px}
.hb-title em{font-style:normal;color:var(--acc)}
.hb-sub{margin:0 0 14px;opacity:.85;font-size:14px;line-height:1.45}
.hb-riders{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0}
.hb-rider{padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid var(--line);font-size:12px;line-height:1.35}
.hb-rider b{display:flex;align-items:center;gap:6px;font-size:13px}.hb-rider i{width:10px;height:10px;border-radius:50%;display:inline-block}
.hb-keys{font-size:12px;opacity:.8;line-height:1.7;margin:10px 0 14px}.hb-keys kbd{font:600 11px 'JetBrains Mono',monospace;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,.12);border:1px solid var(--line)}
.hb-btns{display:flex;gap:8px;flex-wrap:wrap}
.hb-btn{pointer-events:auto;cursor:pointer;border:0;border-radius:8px;padding:12px 18px;font:700 15px Inter,sans-serif;background:rgba(255,255,255,.1);color:#fff;min-height:44px}
.hb-btn.is-primary{background:var(--acc);color:#1a0d02}.hb-btn:hover{filter:brightness(1.1)}
.hb-best{font:500 12px 'JetBrains Mono',monospace;opacity:.7;margin-top:10px}
.hb-results table{width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:14px}
.hb-results td{padding:6px 4px;border-bottom:1px solid var(--line)}.hb-results td:last-child{text-align:right;font-family:'JetBrains Mono',monospace}
.hb-results tr.is-you td{color:var(--acc);font-weight:700}
.hb-stat{display:flex;justify-content:space-between;font-size:14px;padding:3px 0}.hb-stat span:last-child{font-family:'JetBrains Mono',monospace}
.hb-set{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px;gap:10px}
.hb-set button{min-width:92px}
.hb-touch{position:absolute;left:0;right:0;bottom:0;height:190px;pointer-events:none;display:none}
.hb-root.has-touch .hb-touch{display:block}
.hb-steer{position:absolute;left:max(14px,env(safe-area-inset-left));bottom:max(18px,env(safe-area-inset-bottom));width:150px;height:84px;border-radius:42px;background:rgba(10,12,16,.4);border:1px solid var(--line);pointer-events:auto;touch-action:none}
.hb-steer-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;background:rgba(255,255,255,.22);transition:transform .05s}
.hb-pads{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(3,62px);gap:6px}
.hb-tb{pointer-events:auto;touch-action:none;height:52px;border-radius:12px;border:1px solid var(--line);background:rgba(10,12,16,.45);color:#fff;font:800 11px Inter,sans-serif;letter-spacing:.04em}
.hb-tb.is-down{background:rgba(255,122,26,.7)}.hb-tb-big{height:60px;background:rgba(255,122,26,.35)}
.hb-root:not(.is-racing) .hb-touch{display:none}
@media (max-width:520px){.hb-pos b{font-size:26px}.hb-time{font-size:17px}.hb-speed{font-size:28px}.hb-tr{min-width:96px;padding:6px 10px}.hb-count{font-size:80px}.hb-card{font-size:15px}.hb-toast{font-size:18px}}
`;

const ord = ( n ) => [ 'th', 'st', 'nd', 'rd' ][ n > 3 ? 0 : n ] || 'th';
export const fmt = ( t ) => {

	if ( t === null || t === undefined || ! Number.isFinite( t ) ) return '--:--.--';
	const m = Math.floor( t / 60 ), s = t - m * 60;
	return `${ m }:${ s < 10 ? '0' : '' }${ s.toFixed( 2 ) }`;

};

const hex = ( c ) => '#' + c.toString( 16 ).padStart( 6, '0' );

export class Hud {

	constructor( { riders, route } ) {

		const style = document.createElement( 'style' );
		style.textContent = CSS;
		document.head.appendChild( style );
		this.route = route;
		this.riders = riders;
		const root = this.root = document.createElement( 'div' );
		root.className = 'hb-root';
		root.innerHTML = `
			<div class="hb-hud">
				<div class="hb-tl"><div class="hb-pos hb-glass"><b>1</b><sup>st</sup><span>/4</span></div>
					<div class="hb-time hb-glass"><small>Time</small><span class="hb-t">0:00.00</span></div></div>
				<div class="hb-tr hb-glass"><div class="hb-speed"><span class="hb-kmh">0</span><small>km/h</small></div>
					<div class="hb-boost"><i></i></div><div class="hb-meta"><span class="hb-crashes">0 crashes</span> · <span class="hb-wet">dry</span></div></div>
				<div class="hb-center"><div class="hb-count"></div><div class="hb-card hb-glass"></div><div class="hb-toast"></div><div class="hb-toast hb-toast2"></div></div>
				<div class="hb-strip hb-glass"><canvas></canvas></div>
			</div>
			<div class="hb-screen hb-title-screen"><div class="hb-panel hb-glass"></div></div>
			<div class="hb-screen hb-pause"><div class="hb-panel hb-glass"></div></div>
			<div class="hb-screen hb-settings"><div class="hb-panel hb-glass"></div></div>
			<div class="hb-screen hb-results"><div class="hb-panel hb-glass"></div></div>`;
		document.body.appendChild( root );
		const q = ( s ) => root.querySelector( s );
		this.el = {
			pos: q( '.hb-pos b' ), sup: q( '.hb-pos sup' ), time: q( '.hb-t' ), kmh: q( '.hb-kmh' ), boost: q( '.hb-boost i' ),
			crashes: q( '.hb-crashes' ), wet: q( '.hb-wet' ), count: q( '.hb-count' ), card: q( '.hb-card' ), toast: q( '.hb-toast' ),
			toast2: q( '.hb-toast2' ), strip: q( '.hb-strip canvas' ), title: q( '.hb-title-screen' ), pause: q( '.hb-pause' ),
			settings: q( '.hb-settings' ), results: q( '.hb-results' ),
		};
		this._timers = {};
		this.values = {}; // what the HUD last showed (tests read it)

	}

	setRacing( on ) { this.root.classList.toggle( 'is-racing', on ); }
	setTouch( on ) { this.root.classList.toggle( 'has-touch', on ); }

	_flash( el, key, html, cls = '', ms = 1600 ) {

		el.innerHTML = html;
		el.className = el.className.replace( / is-(on|good|bad|trick)/g, '' ) + ' is-on' + ( cls ? ' ' + cls : '' );
		clearTimeout( this._timers[ key ] );
		this._timers[ key ] = setTimeout( () => el.classList.remove( 'is-on' ), ms );

	}

	countdown( n ) { this._flash( this.el.count, 'count', n === 0 ? 'GO' : String( n ), '', 700 ); }
	section( name, k ) { this._flash( this.el.card, 'card', `<small>Section ${ k + 1 } / ${ this.route.sections.length }</small>${ name }`, '', 2600 ); }
	trick( text ) { this._flash( this.el.toast, 'toast', text, 'is-trick', 1500 ); }
	split( delta, name ) {

		if ( delta === null ) return this._flash( this.el.toast2, 'toast2', `${ name }`, '', 1600 );
		const good = delta <= 0;
		this._flash( this.el.toast2, 'toast2', `${ name } &nbsp; ${ good ? '−' : '+' }${ Math.abs( delta ).toFixed( 2 ) }`, good ? 'is-good' : 'is-bad', 2000 );

	}

	message( text, cls = '' ) { this._flash( this.el.toast, 'toast', text, cls, 1400 ); }

	// every frame
	update( race, player ) {

		const b = player.bike, E = this.el, v = this.values;
		const kmh = Math.round( b.speed * 3.6 );
		if ( v.kmh !== kmh ) E.kmh.textContent = v.kmh = kmh;
		const t = fmt( player.finishTime ?? race.t );
		if ( v.time !== t ) E.time.textContent = v.time = t;
		if ( v.pos !== player.position ) { E.pos.textContent = v.pos = player.position; E.sup.textContent = ord( player.position ); }
		const boost = Math.round( b.boost );
		if ( v.boost !== boost ) { E.boost.style.width = boost + '%'; v.boost = boost; }
		this.root.classList.toggle( 'is-boosting', !! b.boosting );
		const cr = `${ b.crashes } crash${ b.crashes === 1 ? '' : 'es' }`;
		if ( v.crashes !== cr ) E.crashes.textContent = v.crashes = cr;
		const w = race.weather.wet < 0.05 ? 'dry' : race.weather.wet < 0.6 ? 'fog rolling in' : 'wet';
		if ( v.wet !== w ) E.wet.textContent = v.wet = w;
		this._strip( race );

	}

	_strip( race ) {

		const c = this.el.strip, dpr = Math.min( 2, window.devicePixelRatio || 1 );
		const W = c.clientWidth * dpr, H = c.clientHeight * dpr;
		if ( ! W || ! H ) return;
		if ( c.width !== W || c.height !== H ) { c.width = W; c.height = H; }
		const g = c.getContext( '2d' ), L = this.route.length, pad = 8 * dpr, x = ( s ) => pad + ( W - 2 * pad ) * s / L;
		g.clearRect( 0, 0, W, H );
		// the drop profile, faint, then the line and section ticks
		const top = this.route.height( 0 ), bottom = this.route.height( L );
		g.beginPath();
		for ( let s = 0; s <= L; s += 8 ) g.lineTo( x( s ), H * 0.2 + ( H * 0.6 ) * ( top - this.route.height( s ) ) / ( top - bottom ) );
		g.strokeStyle = 'rgba(255,255,255,0.18)';
		g.lineWidth = 1.5 * dpr;
		g.stroke();
		g.fillStyle = 'rgba(255,255,255,0.35)';
		for ( const sec of this.route.sections ) g.fillRect( x( sec.s0 ) - dpr * 0.5, H * 0.15, dpr, H * 0.7 );
		for ( const r of [ ...race.riders ].reverse() ) {

			g.beginPath();
			g.arc( x( r.bike.s ), H / 2, ( r.index === 0 ? 5 : 3.8 ) * dpr, 0, Math.PI * 2 );
			g.fillStyle = r.index === 0 ? '#ff7a1a' : hex( r.kit.body );
			g.fill();
			if ( r.index === 0 ) { g.lineWidth = 1.5 * dpr; g.strokeStyle = '#fff'; g.stroke(); }

		}

	}

	// ---- screens
	_screen( el, html ) {

		// menus need the cursor: never leave the pointer locked behind a screen
		if ( el && document.pointerLockElement ) document.exitPointerLock?.();

		for ( const s of [ this.el.title, this.el.pause, this.el.settings, this.el.results ] ) s.classList.toggle( 'is-on', s === el && !! html );
		if ( ! el ) return null;
		if ( html ) el.firstElementChild.innerHTML = html;
		return el.firstElementChild;

	}

	hideScreens() { this._screen( null, null ); }

	showTitle( { best, touch }, onStart ) {

		const R = this.route;
		const riders = this.riders.map( ( r ) => `<div class="hb-rider"><b><i style="background:${ hex( r.kit.body ) }"></i>${ r.name }</b>${ r.blurb }</div>` ).join( '' );
		const keys = touch ? 'Left thumb steers · PEDAL · BRAKE · HOP · BOOST · Q/E flips in the air'
			: `<kbd>W</kbd> pedal · <kbd>A</kbd><kbd>D</kbd> line · <kbd>S</kbd> brake (slide) · <kbd>Space</kbd> hop · <kbd>Shift</kbd> boost · <kbd>Q</kbd>/<kbd>E</kbd> flips · <kbd>R</kbd> restart · <kbd>P</kbd> pause · <kbd>V</kbd> fog · <kbd>T</kbd> time · <kbd>M</kbd> mute · <kbd>H</kbd> settings`;
		const p = this._screen( this.el.title, `
			<p class="hb-kicker">San Francisco · built from real data</p>
			<h1 class="hb-title">HILL<em>BOMB</em> SF</h1>
			<p class="hb-sub">Coit Tower to the Ferry Building: down the Filbert Steps, across Montgomery and Sansome, flat out along the Embarcadero.
			${ ( R.length / 1000 ).toFixed( 2 ) } km, ${ Math.round( R.index.drop ) } m of drop, three rivals, and the fog rolls in off the bay.</p>
			<div class="hb-riders">${ riders }</div>
			<div class="hb-keys">${ keys }</div>
			<div class="hb-btns"><button class="hb-btn is-primary" data-a="start">Drop in</button></div>
			<div class="hb-best">${ best ? 'Best ' + fmt( best ) : 'No best time yet' }</div>` );
		p.querySelector( '[data-a=start]' ).addEventListener( 'click', onStart );

	}

	showPause( h ) {

		const p = this._screen( this.el.pause, `<p class="hb-kicker">Paused</p><h2 class="hb-title" style="font-size:44px">HILL<em>BOMB</em></h2>
			<div class="hb-btns"><button class="hb-btn is-primary" data-a="resume">Resume</button><button class="hb-btn" data-a="restart">Restart (R)</button>
			<button class="hb-btn" data-a="settings">Settings (H)</button></div>` );
		for ( const b of p.querySelectorAll( '[data-a]' ) ) b.addEventListener( 'click', () => h[ b.dataset.a ]() );

	}

	showSettings( s, h ) {

		const row = ( label, key, value ) => `<div class="hb-set"><span>${ label }</span><button class="hb-btn" data-a="${ key }">${ value }</button></div>`;
		const p = this._screen( this.el.settings, `<p class="hb-kicker">Settings</p>
			${ row( 'Sound (M)', 'mute', s.muted ? 'Off' : 'On' ) }
			${ row( 'Marine layer (V)', 'fog', s.fog ? 'Fog' : 'Clear' ) }
			${ row( 'Time of day (T)', 'time', s.time ) }
			${ row( 'Autopilot', 'autopilot', s.autopilot ? 'On' : 'Off' ) }
			${ row( 'Quality', 'tier', s.tier ) }
			<div class="hb-btns" style="margin-top:14px"><button class="hb-btn is-primary" data-a="close">Done</button></div>` );
		for ( const b of p.querySelectorAll( '[data-a]' ) ) b.addEventListener( 'click', () => h[ b.dataset.a ]() );

	}

	showResults( r, h ) {

		const rows = r.order.map( ( o ) => `<tr class="${ o.you ? 'is-you' : '' }"><td>${ o.position }${ ord( o.position ) }</td><td>${ o.name }</td><td>${ o.crashes ? o.crashes + '×💥' : '' }</td><td>${ fmt( o.time ) }</td></tr>` ).join( '' );
		const p = this._screen( this.el.results, `<p class="hb-kicker">Ferry Building · finish</p>
			<h2 class="hb-title" style="font-size:48px">${ r.position }${ ord( r.position ) } <em>place</em></h2>
			<div class="hb-stat"><span>Time</span><span>${ fmt( r.time ) }</span></div>
			<div class="hb-stat"><span>Style score</span><span>${ r.score }</span></div>
			<div class="hb-stat"><span>Best time</span><span>${ fmt( r.best ) }${ r.newBest ? ' · new best' : '' }</span></div>
			<table>${ rows }</table>
			<div class="hb-btns"><button class="hb-btn is-primary" data-a="restart">Race again (R)</button></div>` );
		for ( const b of p.querySelectorAll( '[data-a]' ) ) b.addEventListener( 'click', () => h[ b.dataset.a ]() );

	}

}

// the headless harness (gates) has no document.head: the same interface, drawing nothing
export class NullHud {

	constructor() { this.values = {}; this.root = null; }
	setRacing() {}
	setTouch() {}
	countdown() {}
	section() {}
	trick( t ) { this.values.trick = t; }
	split( d, n ) { this.values.split = [ d, n ]; }
	message( t ) { this.values.message = t; }
	update( race, player ) { this.values.kmh = Math.round( player.bike.speed * 3.6 ); this.values.pos = player.position; }
	hideScreens() {}
	showTitle() {}
	showPause() {}
	showSettings() {}
	showResults() {}

}
