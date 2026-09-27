// SFO Approach: a Harbor Engine title. The engine draws the bay; this title is its map.json, its baked data in
// public/ and the "approach" game (src/games/approach.js) registered before boot.
import 'harbor-engine/src/ui/ui.css';
import './games/hud.css';
import './games/approach.js';
import map from '../map.json';
import { boot } from 'harbor-engine';

boot( { map } );
