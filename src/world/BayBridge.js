// The Bay Bridge West Span, a far backdrop landmark built at load from public/landmarks/bay-bridge.json
// (tools/landmarks/baybridge.mjs: the OSM deck line + published span lengths, tower height and clearance): the
// deck on its approach from the San Francisco shore, four towers, three anchorages and the main cables, which
// carry a faint light after dusk (the Bay Lights). One merged mesh.
import { BoxGeometry, Matrix4, Vector3, Quaternion, Color } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { FurnitureBuilder } from '../game/Furniture.js';

const lin = ( hex ) => { const c = new Color( hex ); return [ Math.pow( c.r, 2.2 ), Math.pow( c.g, 2.2 ), Math.pow( c.b, 2.2 ) ]; };
const STEEL = lin( 0x9aa1a6 ), CONCRETE = lin( 0x8c8a84 ), CABLE = lin( 0xb8bec2 );

export async function loadBayBridge( base = ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) {

	const d = await ( await fetch( base + 'landmarks/bay-bridge.json' ) ).json();
	const B = new FurnitureBuilder(), box = new BoxGeometry( 1, 1, 1 );
	const st = d.stations, first = st[ 0 ], last = st[ st.length - 1 ];
	const dir = new Vector3( last.x - first.x, 0, last.z - first.z ).normalize();
	const yaw = Math.atan2( dir.x, dir.z ), right = new Vector3( dir.z, 0, - dir.x );
	const q = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), yaw );
	const seg = ( a, b, w, h, color, opts ) => {

		// a box from a to b (world points), w wide, h thick
		const m = new Vector3().addVectors( a, b ).multiplyScalar( 0.5 ), L = a.distanceTo( b );
		const qq = new Quaternion().setFromUnitVectors( new Vector3( 0, 0, 1 ), new Vector3().subVectors( b, a ).normalize() );
		const up = new Vector3( 0, 1, 0 ).applyQuaternion( qq );
		// keep the box's width horizontal (roll it back so its local x stays level)
		const roll = Math.atan2( new Vector3( 1, 0, 0 ).applyQuaternion( qq ).y, up.y );
		qq.multiply( new Quaternion().setFromAxisAngle( new Vector3( 0, 0, 1 ), - roll ) );
		B.add( box, new Matrix4().compose( m, qq, new Vector3( w, h, L ) ), color, opts );

	};

	const P = ( s, y, off = 0 ) => new Vector3( s.x + right.x * off, y, s.z + right.z * off );
	const D = d.deckHeight;
	// the approach from the shore and the deck (a truss, drawn as a deep box)
	const sf = new Vector3( d.sfEnd[ 0 ], d.sfEnd[ 2 ] + 6, d.sfEnd[ 1 ] );
	seg( sf, P( first, D ), d.width, 7, STEEL, { rough: 0.55 } );
	seg( P( first, D ), P( last, D ), d.width, 8, STEEL, { rough: 0.55 } );
	for ( const s of st ) {

		if ( s.kind === 'anchorage' ) {

			B.add( box, new Matrix4().compose( new Vector3( s.x, ( D + 8 ) / 2 - 10, s.z ), q, new Vector3( 38, D + 28, 55 ) ), CONCRETE, { rough: 0.9 } );
			continue;

		}

		// a tower: two legs and three cross beams
		for ( const off of [ - 13, 13 ] ) seg( P( s, - 10, off ), P( s, d.towerHeight, off ), 7, 5, STEEL, { rough: 0.55 } );
		for ( const y of [ D - 6, D + 40, d.towerHeight - 6 ] ) B.add( box, new Matrix4().compose( P( s, y ), q, new Vector3( 32, 5, 5 ) ), STEEL, { rough: 0.55 } );

	}

	// main cables: tower tops to tower tops (a catenary, sag to just above the deck), and down the side spans
	const top = d.towerHeight - 2;
	const cable = ( a, b, ya, yb, sag ) => {

		for ( const off of [ - 13, 13 ] ) {

			const n = 24;
			let prev = null;
			for ( let i = 0; i <= n; i ++ ) {

				const t = i / n, x = a.x + ( b.x - a.x ) * t, z = a.z + ( b.z - a.z ) * t;
				const y = ya + ( yb - ya ) * t - sag * 4 * t * ( 1 - t );
				const p = new Vector3( x + right.x * off, y, z + right.z * off );
				if ( prev ) seg( prev, p, 1.4, 1.4, CABLE, { rough: 0.4, marker: 6 } );
				prev = p;

			}

		}

	};

	for ( let k = 0; k + 1 < st.length; k ++ ) {

		const a = st[ k ], b = st[ k + 1 ];
		const ya = a.kind === 'tower' ? top : D + 4, yb = b.kind === 'tower' ? top : D + 4;
		const mainSpan = a.kind === 'tower' && b.kind === 'tower';
		cable( a, b, ya, yb, mainSpan ? top - ( D + 5 ) : 20 );

	}

	const material = new Material( {
		name: 'bay-bridge',
		vertexColors: true,
		surface: /* wgsl */`
	s.albedo = in.color.rgb;
	s.roughness = in.color.a;
	s.metalness = 0.35;
	// the Bay Lights after dusk: the cables glow
	s.emissive = vec3f( 0.85, 0.9, 1.0 ) * 3.0 * smoothstep( 0.2, 0.8, frame.night ) * step( 5.5, in.uv.x );
`,
	} );
	const mesh = B.mesh( material, 'bay-bridge' );
	mesh.castShadow = false;
	return mesh;

}
