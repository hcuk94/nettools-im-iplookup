import fs from 'node:fs/promises';
import path from 'node:path';
import maxmind from 'maxmind';

export async function openGeoIpReaders({ dir, cityMmdb, asnMmdb }) {
  const cityPath = path.join(dir, cityMmdb);
  const asnPath = path.join(dir, asnMmdb);

  const readers = {
    city: null,
    asn: null,
    paths: { cityPath, asnPath }
  };

  // If DBs do not exist, readers stay null; the API will omit geo fields.
  try {
    await fs.access(cityPath);
    readers.city = await maxmind.open(cityPath);
  } catch {
    // ignore
  }

  try {
    await fs.access(asnPath);
    readers.asn = await maxmind.open(asnPath);
  } catch {
    // ignore
  }

  return readers;
}

export function lookupGeo({ readers, ip }) {
  const out = {};

  if (readers?.asn) {
    const asn = readers.asn.get(ip);
    if (asn) {
      out.asn = {
        autonomous_system_number: asn.autonomous_system_number,
        autonomous_system_organization: asn.autonomous_system_organization
      };
    }
  }

  if (readers?.city) {
    const city = readers.city.get(ip);
    if (city) {
      out.city = {
        continent: city.continent?.names?.en,
        country: city.country?.names?.en,
        country_iso_code: city.country?.iso_code,
        registered_country: city.registered_country?.names?.en,
        region: city.subdivisions?.[0]?.names?.en,
        region_iso_code: city.subdivisions?.[0]?.iso_code,
        city: city.city?.names?.en,
        postal: city.postal?.code,
        location: city.location
          ? {
              latitude: city.location.latitude,
              longitude: city.location.longitude,
              time_zone: city.location.time_zone,
              accuracy_radius: city.location.accuracy_radius
            }
          : undefined
      };
    }
  }

  return out;
}
