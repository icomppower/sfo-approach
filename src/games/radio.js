// Radio and flight-deck subtitles for the approach, keyed to the flight's own events (public/flight/approach-28r.json)
// and to the radio-altimeter callouts read off the track. Bilingual (en / zh); the wording follows FAA phraseology
// (JO 7110.65 landing clearance: callsign, wind, runway, "cleared to land").
const T = {
  en: {
    approach: (cs) => `NorCal Approach: ${cs} heavy, nine miles from the marker, maintain one eight zero knots until five miles, cleared I-L-S runway two eight right approach.`,
    approachRb: (cs) => `${cs} heavy: one eight zero to five miles, cleared I-L-S two eight right.`,
    handoff: (cs) => `NorCal Approach: ${cs} heavy, contact San Francisco Tower, one two zero point five.`,
    handoffRb: (cs) => `${cs} heavy: tower, one two zero point five.`,
    checkin: (cs) => `${cs} heavy: San Francisco Tower, ${cs} heavy, I-L-S two eight right.`,
    land: (cs, w) => `San Francisco Tower: ${cs} heavy, wind ${w.dir} at ${w.kt}, runway two eight right, cleared to land.`,
    landRb: (cs) => `${cs} heavy: cleared to land two eight right, ${cs} heavy.`,
    gearDown: () => 'Flight deck: gear down, flaps thirty, landing checklist complete.',
    thousand: () => 'Flight deck: one thousand, stabilized.',
    fiveHundred: () => 'Flight deck: five hundred.',
    hundred: () => 'Radio altimeter: one hundred.',
    fifty: () => 'Radio altimeter: fifty… forty… thirty… twenty… ten.',
    rollout: () => 'Flight deck: speedbrakes up… reversers… eighty knots.',
    exit: (cs) => `San Francisco Tower: ${cs} heavy, turn right next taxiway, contact ground one two one point eight.`,
    exitRb: (cs) => `${cs} heavy: right at the next one, ground one two one eight, good day.`,
  },
  zh: {
    approach: (cs) => `北加州進場：${cs} 重型機，距標誌台九浬，保持一八〇節至五浬，許可 ILS 二八右跑道進場。`,
    approachRb: (cs) => `${cs} 重型機：一八〇節至五浬，許可 ILS 二八右。`,
    handoff: (cs) => `北加州進場：${cs} 重型機，聯絡舊金山塔台，一二〇點五。`,
    handoffRb: (cs) => `${cs} 重型機：塔台一二〇點五。`,
    checkin: (cs) => `${cs} 重型機：舊金山塔台，${cs} 重型機，ILS 二八右。`,
    land: (cs, w) => `舊金山塔台：${cs} 重型機，風向 ${w.dir} 度 ${w.kt} 節，二八右跑道，許可落地。`,
    landRb: (cs) => `${cs} 重型機：許可落地二八右，${cs} 重型機。`,
    gearDown: () => '駕駛艙：起落架放下，襟翼三十，落地檢查表完成。',
    thousand: () => '駕駛艙：一千呎，穩定進場。',
    fiveHundred: () => '駕駛艙：五百呎。',
    hundred: () => '無線電高度：一百。',
    fifty: () => '無線電高度：五十…四十…三十…二十…十。',
    rollout: () => '駕駛艙：減速板升起…反推…八十節。',
    exit: (cs) => `舊金山塔台：${cs} 重型機，下一滑行道右轉，聯絡地面一二一點八。`,
    exitRb: (cs) => `${cs} 重型機：下一條右轉，地面一二一八，再見。`,
  },
};

// the subtitle timeline: [ t, key, seconds shown ]
export function buildTimeline(flight) {
  const cs = flight.flight.callsign.replace(/^UAL/, 'United ').replace(/^([A-Z]{3})(\d+)$/, '$1 $2');
  const w = { dir: String(Math.round(flight.weather.wind.dir / 10) * 10).padStart(3, '0'), kt: Math.round(flight.weather.wind.kt) };
  const ev = (type) => flight.events.find((e) => e.type === type);
  const land = flight.readbacks.find((r) => /cleared to land/i.test(r[1]));
  const s = flight.samples;
  const aglAt = (k) => s[k][3] - flight.samples.at(-1)[3];
  const firstBelow = (ft) => { const m = ft * 0.3048; for (let k = 0; k < s.length; k++) if (aglAt(k) <= m && s[k][11] === 0 && k > 5) return s[k][0]; return null; };
  const out = [];
  const add = (t, key, dur = 6) => { if (t != null) out.push({ t, key, dur, text: { en: T.en[key](cs, w), zh: T.zh[key](cs, w) } }); };
  add(2, 'approach', 8); add(11, 'approachRb', 5);
  add(22, 'handoff', 5); add(28, 'handoffRb', 4);
  add(36, 'checkin', 5);
  add(land ? land[0] + 4 : 60, 'land', 7); add(land ? land[0] + 12 : 68, 'landRb', 5);
  add(Math.max(45, (firstBelow(1500) ?? 90) - 20), 'gearDown', 5);
  add(firstBelow(1000), 'thousand', 4);
  add(firstBelow(500), 'fiveHundred', 3);
  add(firstBelow(100), 'hundred', 3);
  add(firstBelow(50), 'fifty', 6);
  const td = ev('TOUCHDOWN'); add(td ? td.t + 3 : null, 'rollout', 7);
  const cr = ev('CLEAR_RUNWAY'); add(cr ? cr.t - 14 : null, 'exit', 6); add(cr ? cr.t - 7 : null, 'exitRb', 5);
  return out.sort((a, b) => a.t - b.t);
}

export const UI = {
  en: { alt: 'ALT', ias: 'IAS', vs: 'V/S', dist: 'DIST', hdg: 'HDG', ft: 'ft', kt: 'kt', fpm: 'fpm', nm: 'NM', auto: 'AUTO', paused: 'PAUSED', free: 'FREE CAMERA',
    shots: { establish: 'Over the bay', bridge: 'San Mateo Bridge', chase: 'Chase', wing: 'Starboard wing', cockpit: 'Flight deck', tower: 'Tower cab', spotter: 'Bayfront spotter', rollout: 'Rollout', free: 'Free camera' },
    help: '1–8 cameras · 0 auto · F free camera · R restart · P pause · T time of day · Z 中文 · H hide', ils: 'ILS 28R', landed: 'Landed. Restarting…' },
  zh: { alt: '高度', ias: '空速', vs: '垂直速度', dist: '距離', hdg: '航向', ft: '呎', kt: '節', fpm: '呎/分', nm: '浬', auto: '自動導演', paused: '暫停', free: '自由攝影機',
    shots: { establish: '灣上', bridge: '聖馬刁大橋', chase: '追尾', wing: '右翼', cockpit: '駕駛艙', tower: '塔台', spotter: '灣岸拍機', rollout: '落地滑行', free: '自由攝影機' },
    help: '1–8 鏡頭 · 0 自動 · F 自由攝影機 · R 重播 · P 暫停 · T 時間 · Z English · H 隱藏', ils: 'ILS 28R', landed: '已落地，重新開始…' },
};
