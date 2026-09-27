// SFO Approach's raw data: the engine's fetchSources() downloads SOURCES (pipelines/data/sources.mjs) into data/raw/
// and writes MANIFEST.sha256 + sources.json. Cached files are never re-downloaded unless --force.
//   node pipelines/data/fetch.mjs [--force]
import { fetchSources } from 'harbor-engine/tools/data/fetch.mjs';
import { readTiff, writeTiff } from 'harbor-engine/tools/geo/tiff.mjs';
import { isMain } from 'harbor-engine/tools/lib/title.mjs';
import { SOURCES, configureSources } from './sources.mjs';

configureSources({ readTiff, writeTiff });
export { SOURCES };
if (isMain(import.meta.url)) await fetchSources(SOURCES, { userAgent: 'sfo-approach-data-fetch/1.0' });
