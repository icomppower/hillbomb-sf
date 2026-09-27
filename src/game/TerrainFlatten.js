// Flattens the bay heightfield under the course (SPEC §2: "terrain under the ribbon is flattened to the ribbon
// so no 3 m terrain triangle pokes through"). Runs once at load, before the terrain's GPU textures and CDLOD
// bounds are built. Texels whose bilinear cell can touch the ribbon sit just under it; beyond that the ground
// feathers back to the real terrain. The physics never reads the terrain: only the route.
const UNDER = 0.12; // m the ground sits below the ribbon
const FULL = 4.4; // m past the path edge still fully flattened (a 3 m texel cell's diagonal)
const FEATHER = 5; // m over which the ground blends back to the terrain

export function flattenTerrainUnderRoute( hf, route ) {

	const { res, texel, origin, heights } = hf;
	const n = res * res;
	const bestD = new Float32Array( n ).fill( Infinity );
	const target = new Float32Array( n );
	const reach = FULL + FEATHER;
	const t = {}, c = {};
	for ( let s = 0; s <= route.length; s += 0.5 ) {

		route.tangent( s, t );
		route.center( s, c );
		const hw = route.halfWidth( s ), R = hw + reach;
		const f = route.flightAt( s );
		const stairDrop = f ? f.riser / 2 : 0;
		const i0 = Math.max( 0, Math.floor( ( c.x - R - origin ) / texel ) ), i1 = Math.min( res - 1, Math.ceil( ( c.x + R - origin ) / texel ) );
		const j0 = Math.max( 0, Math.floor( ( c.z - R - origin ) / texel ) ), j1 = Math.min( res - 1, Math.ceil( ( c.z + R - origin ) / texel ) );
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

			// texel centre (HeightField samples at centres)
			const x = origin + ( i + 0.5 ) * texel, z = origin + ( j + 0.5 ) * texel;
			const dx = x - c.x, dz = z - c.z;
			const along = dx * t.x + dz * t.z;
			if ( Math.abs( along ) > 0.3 ) continue;
			const lat = dx * t.rx + dz * t.rz;
			const d = Math.abs( lat ) - hw; // metres outside the path edge (negative: under it)
			if ( d > reach ) continue;
			const k = j * res + i;
			if ( d < bestD[ k ] ) {

				bestD[ k ] = d;
				const l = Math.max( - hw, Math.min( hw, lat ) );
				target[ k ] = route.baseHeight( s, l ) - stairDrop - UNDER;

			}

		}

	}

	let changed = 0;
	for ( let k = 0; k < n; k ++ ) {

		const d = bestD[ k ];
		if ( d === Infinity ) continue;
		const w = d <= FULL ? 1 : 1 - smooth( ( d - FULL ) / FEATHER );
		heights[ k ] = heights[ k ] + ( target[ k ] - heights[ k ] ) * w;
		changed ++;

	}

	hf.buildMinMax();
	hf.flattened = changed;
	return changed;

}

const smooth = ( x ) => {

	const t = Math.max( 0, Math.min( 1, x ) );
	return t * t * ( 3 - 2 * t );

};
