// G1 Clean title: build passes, dependency audit clean, ocean + sky render in headless Dawn (the engine's
// generic checks, harbor-engine/gates/lib/clean.mjs). --negative: each mutation must trip its check.
import { runCleanGate } from 'harbor-engine/gates/lib/clean.mjs';

runCleanGate( { label: 'G1' } );
