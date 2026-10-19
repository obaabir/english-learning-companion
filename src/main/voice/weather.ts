import { weatherText, type WeatherReport } from '@shared/voice'

/** Current weather and today's forecast from Open-Meteo (free, no API key, no account). */
interface Place {
  name: string
  country?: string
  latitude: number
  longitude: number
}
const places = new Map<string, Place>()

const withTimeout: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })

export async function getWeather(city: string, fetchImpl: typeof fetch = withTimeout): Promise<WeatherReport> {
  try {
    return await fetchWeather(city, fetchImpl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/timeout|aborted/i.test(msg) || (err as Error)?.name === 'TimeoutError') throw new Error("The weather service didn't answer in time (slow internet). Try again in a moment.")
    if (/fetch failed|network|ENOTFOUND|ECONN|ERR_/i.test(msg)) throw new Error("Couldn't reach the weather service. Check the internet connection.")
    throw err
  }
}

async function fetchWeather(city: string, fetchImpl: typeof fetch): Promise<WeatherReport> {
  const name = city.trim()
  if (!name) throw new Error('Which city? Say for example "weather in Dhaka".')
  // A city's location is looked up once; later questions only fetch the weather.
  let place = places.get(name.toLowerCase())
  if (!place) {
    const geo = (await (await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`)).json()) as {
      results?: Place[]
    }
    place = geo.results?.[0]
    if (!place) throw new Error(`I couldn't find a place called "${name}".`)
    places.set(name.toLowerCase(), place)
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1'
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`The weather service answered ${res.status}. Try again in a moment.`)
  const w = (await res.json()) as {
    current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number }
    daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max?: (number | null)[] }
  }
  return {
    place: place.country ? `${place.name}, ${place.country}` : place.name,
    temperature: w.current.temperature_2m,
    feelsLike: w.current.apparent_temperature,
    description: weatherText(w.current.weather_code),
    high: w.daily.temperature_2m_max[0],
    low: w.daily.temperature_2m_min[0],
    rainChance: w.daily.precipitation_probability_max?.[0] ?? null,
    wind: w.current.wind_speed_10m
  }
}
