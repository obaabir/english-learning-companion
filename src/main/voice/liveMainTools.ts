import type { WeatherReport } from '@shared/voice'

/** Voice Mode tools that run in the main process: the time (this computer's clock) and live weather. */

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** The current time from the system clock, in the zone asked for, the configured one, or the computer's. */
export function currentTime(tzArg: string | undefined, configured: string, now = new Date()): Record<string, unknown> {
  const tz = tzArg?.trim() || configured.trim() || systemTimeZone()
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
  } catch {
    return { ok: false, error: `"${tz}" is not a time zone. Use an IANA zone such as "Asia/Dhaka" or "Europe/London", or ask the user.` }
  }
  return {
    ok: true,
    time: now.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }),
    date: now.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    timezone: tz,
    source: "this computer's clock"
  }
}

/** Live weather (Open-Meteo) for the city asked for or the saved one; asks for a city when there is none. */
export async function weatherForVoice(cityArg: string | undefined, configured: string, get: (city: string) => Promise<WeatherReport>, now = new Date()): Promise<Record<string, unknown>> {
  const city = cityArg?.trim() || configured.trim()
  if (!city) return { ok: false, needs_location: true, error: 'No city is saved. Ask the user which city they want the weather for.' }
  try {
    const w = await get(city)
    return {
      ok: true,
      source: 'Open-Meteo live weather service',
      retrieved_at: now.toISOString(),
      place: w.place,
      current_conditions: {
        temperature_c: w.temperature,
        feels_like_c: w.feelsLike,
        description: w.description,
        wind_kmh: w.wind,
        note: 'Current conditions: the latest measurement-based analysis (updated about every 15 minutes).'
      },
      today_forecast: { high_c: w.high, low_c: w.low, rain_chance_percent: w.rainChance, note: 'Forecast for the rest of today: an estimate, not a measurement.' }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
