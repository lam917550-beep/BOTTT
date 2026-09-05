import { LruCache } from "../cache/lru.js";

export async function fetchWeather(city: string, timeoutMs: number): Promise<{
  name: string;
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  cloud: number;
  vis: number;
  tz: string;
}> {
  const geoCtrl = new AbortController();
  const geoTimer = setTimeout(() => geoCtrl.abort(), timeoutMs);
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
      { signal: geoCtrl.signal },
    );
    if (!geoRes.ok) throw new Error("WEATHER_GEO");
    const geo = (await geoRes.json()) as {
      results?: { name: string; latitude: number; longitude: number; timezone?: string }[];
    };
    const place = geo.results?.[0];
    if (!place) throw new Error("WEATHER_NOT_FOUND");
    const wCtrl = new AbortController();
    const wTimer = setTimeout(() => wCtrl.abort(), timeoutMs);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,cloud_cover,visibility&timezone=auto`;
      const wRes = await fetch(url, { signal: wCtrl.signal });
      if (!wRes.ok) throw new Error("WEATHER_FETCH");
      const data = (await wRes.json()) as {
        timezone?: string;
        current?: {
          temperature_2m: number;
          apparent_temperature: number;
          relative_humidity_2m: number;
          wind_speed_10m: number;
          cloud_cover: number;
          visibility: number;
        };
      };
      const c = data.current;
      if (!c) throw new Error("WEATHER_FETCH");
      return {
        name: place.name,
        temp: c.temperature_2m,
        feels: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        wind: c.wind_speed_10m,
        cloud: c.cloud_cover,
        vis: c.visibility,
        tz: data.timezone ?? place.timezone ?? "UTC",
      };
    } finally {
      clearTimeout(wTimer);
    }
  } finally {
    clearTimeout(geoTimer);
  }
}

export const weatherCache = new LruCache<string, Awaited<ReturnType<typeof fetchWeather>>>(200, 10 * 60 * 1000);
