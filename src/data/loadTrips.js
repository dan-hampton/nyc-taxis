import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';
import { project } from '../utils/projection.js';

// Load and parse CSV of taxi trips. Returns array of cleaned trip objects.
export async function loadTrips(url = 'src/geo/subset.csv') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch CSV');
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });

  const dayStart = (date) => {
    const d = new Date(date);
    d.setHours(0,0,0,0);
    return d;
  };

  const trips = [];
  for (const row of parsed.data) {
    try {
      const pickupTS = new Date(row.tpep_pickup_datetime);
      const dropoffTS = new Date(row.tpep_dropoff_datetime);
      if (!(pickupTS instanceof Date) || isNaN(pickupTS)) continue;
      if (!(dropoffTS instanceof Date) || isNaN(dropoffTS)) continue;
      const startOfDay = dayStart(pickupTS);
      const pickupSec = (pickupTS - startOfDay) / 1000;
      const dropoffSec = (dropoffTS - startOfDay) / 1000;
      if (dropoffSec <= pickupSec) continue;
      const plon = parseFloat(row.pickup_longitude || row.Pickup_longitude || row.pickup_longitude);
      const plat = parseFloat(row.pickup_latitude || row.Pickup_latitude || row.pickup_latitude);
      const dlon = parseFloat(row.dropoff_longitude || row.Dropoff_longitude || row.dropoff_longitude);
      const dlat = parseFloat(row.dropoff_latitude || row.Dropoff_latitude || row.dropoff_latitude);
      if (!isFinite(plon) || !isFinite(plat) || !isFinite(dlon) || !isFinite(dlat)) continue;

      const startPos = { ...project(plon, plat, 220), lon: plon, lat: plat };
      const endPos = { ...project(dlon, dlat, 220), lon: dlon, lat: dlat };

      trips.push({
        // id will be assigned after sorting
        startTime: pickupSec,
        endTime: dropoffSec,
        startPos,
        endPos,
        fare: Number(row.fare_amount) || 0,
        passengers: Number(row.passenger_count) || 0,
        vendor: row.VendorID || row.vendor_id || 0,
        pickupDate: pickupTS,
        pickupTimestamp: pickupTS.getTime()
      });
    } catch (e) {
      // skip row
    }
  }
  trips.sort((a,b) => a.pickupTimestamp - b.pickupTimestamp);
  // Assign id in sort order
  trips.forEach((trip, idx) => {
    trip.id = idx + 1;
  });
  return trips;
}
