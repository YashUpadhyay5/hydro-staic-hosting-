// Which work an employee can log depends on where they work. The region comes from the work place already
// set on the employee for holidays (Employee.location, plus the state of the holiday calendar it points to).
//   LIST: pick one item; an item with minutes fixes the planned time, without minutes the employee chooses it.
//   FREE: type the work and choose the time (HP, and anyone whose work place matches no region).
const HolidayCalendar = require('../../../../shared/models/HolidayCalendar');

const REGIONS = {
  HP: {
    label: 'Himachal Pradesh',
    pattern: /\b(himachal( pradesh)?|hp)\b/,
    mode: 'FREE',
    items: []
  },
  AP: {
    label: 'Andhra Pradesh',
    pattern: /\b(andhra( pradesh)?|ap)\b/,
    mode: 'LIST',
    items: [
      { key: 'new_installation_t0_t1', title: 'New installation (T0, T1)', minutes: 60 },
      { key: 'new_installation_t2', title: 'New installation (T2)', minutes: 60 },
      { key: 'service_t0_t1', title: 'Service work (T0, T1)', minutes: 30 },   // 20-30 min: rings at the 30
      { key: 'service_t2', title: 'Service work (T2)', minutes: 60 }
    ]
  },
  UP_PUNJAB: {
    label: 'UP / Punjab',
    pattern: /\b(uttar pradesh|up|punjab|pb)\b/,
    mode: 'LIST',
    items: [
      { key: 'backwash', title: 'Backwash', minutes: 60 },
      { key: 'leakage', title: 'Leakage', minutes: null },
      { key: 'paint_works', title: 'Paint works', minutes: null },
      { key: 'welding_work', title: 'Welding work', minutes: null },
      { key: 'assembly_work', title: 'Assembly work', minutes: null },
      { key: 'material_purchase', title: 'Material purchase', minutes: null },
      { key: 'iot_work', title: 'IoT work', minutes: null },
      { key: 'repair_chamber_platform', title: 'Repair of chamber and platform', minutes: null },
      { key: 'sample_collect', title: 'Sample collect', minutes: null },
      { key: 'excavation_work', title: 'Excavation work', minutes: null }
    ]
  },
  OTHER: { label: 'Other', pattern: null, mode: 'FREE', items: [] }
};
const MATCH_ORDER = ['HP', 'AP', 'UP_PUNJAB'];

const words = (v) => String(v || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

// 'HP' | 'AP' | 'UP_PUNJAB' | 'OTHER' from the employee's work place and the state of its holiday calendar
async function regionFor(employee) {
  const place = String(employee.location || employee.holidayDetails || '').trim();
  if (!place) return { region: 'OTHER', matchedOn: null };

  const parts = [place];
  try {
    const wanted = place.toLowerCase();
    const calendar = (await HolidayCalendar.findAll()).find((c) =>
      (c.location && c.location.toLowerCase() === wanted) || (c.name && c.name.toLowerCase().includes(wanted)));
    if (calendar) parts.push(calendar.state, calendar.location);
  } catch (error) {
    console.warn('[WorkLists] Holiday calendar lookup failed:', error.message);
  }
  const haystack = words(parts.filter(Boolean).join(' '));
  const region = MATCH_ORDER.find((key) => REGIONS[key].pattern.test(haystack)) || 'OTHER';
  return { region, matchedOn: place };
}

// What the phone shows: { region, label, mode, items: [{ key, title, minutes }], workPlace }
async function workListFor(employee) {
  const { region, matchedOn } = await regionFor(employee);
  const def = REGIONS[region];
  return {
    region,
    label: def.label,
    mode: def.mode,
    workPlace: matchedOn,
    items: def.items.map((i) => ({ ...i }))
  };
}

module.exports = { REGIONS, regionFor, workListFor };
