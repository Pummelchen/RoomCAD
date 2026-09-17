// Where the sun is, for a given hour and day of the year.
//
// Part of walk3d.js, split under roomcad/web/walk3d/.


export function dayOfYear(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  return Math.floor((date - start) / 86400000);
}


/// Sun altitude + azimuth (radians) for Singapore at a given UTC Date.
export function sunAltitudeAzimuth(date) {
  const N = dayOfYear(date);
  const declDeg = -23.44 * Math.cos((2 * Math.PI / 365) * (N + 10));
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const solarTime = utcHours + SG_LON / 15;
  const hourAngleDeg = (solarTime - 12) * 15;
  const lat = SG_LAT * Math.PI / 180;
  const dec = declDeg * Math.PI / 180;
  const h = hourAngleDeg * Math.PI / 180;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAz = (Math.sin(dec) - Math.sin(lat) * Math.sin(altitude)) / (Math.cos(lat) * Math.cos(altitude));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (h > 0) azimuth = 2 * Math.PI - azimuth; // afternoon → west
  return { altitude, azimuth };
}


/// Solar position for a Singapore clock hour (24 h, fractional allowed).
export function sunForHour(hour) {
  const utc = hour - SG_UTC_OFFSET;
  const date = new Date();
  const wrapped = ((utc % 24) + 24) % 24;
  date.setUTCDate(date.getUTCDate() + Math.floor(utc / 24));
  // Rounded to the minute, not floored into it. An hour built from minutes is
  // not exact in floating point — 22.95 hours is 1376.9999 minutes — so
  // flooring dropped every other minute back onto the one before it, and the
  // sun moved in irregular two-minute steps instead of smoothly.
  const totalMinutes = Math.round(wrapped * 60);
  date.setUTCHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
  return sunAltitudeAzimuth(date);
}


export function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}


export function smoothstep01(edge0, edge1, v) {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
