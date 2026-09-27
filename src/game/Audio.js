// Game audio (SPEC §8). Filled in at step 8; until then a silent object with the same interface, so the rest of
// the game never checks for it. Headless (no AudioContext) it stays silent.
export class GameAudio {

	constructor() {

		this.muted = false;
		this.enabled = false;

	}

	resume() {}

	setMuted( m ) { this.muted = m; }

	event() {}

	update() {}

}
