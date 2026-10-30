"use client";

import { useState, useEffect } from "react";
import WeatherIcon from "./WeatherIcon";

/**
 * NavWeather — compact weather widget for the navigation bar.
 * Fetches real-time weather from the remote API based on location.
 *
 * @param {{ location: string }} props — the user's base site (location)
 */
export default function NavWeather({ location }) {
  const [weather, setWeather] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!location) {
      setWeather(null);
      return;
    }

    const fetchWeather = async () => {
      try {
        setError(false);
        const response = await fetch(
          `/api/weather?city=${encodeURIComponent(location)}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch weather");
        }
        const data = await response.json();
        
        // Map API response (WMO weather code or description) to local WeatherIcon states
        const code = data?.current?.weather_code;
        const desc = data?.current?.weather_description || "";
        const temp = Math.round(data?.current?.temperature ?? 0);

        let state = "Sunny"; // default fallback

        if (code !== undefined) {
          if (code === 0) {
            state = "Sunny";
          } else if (code === 1 || code === 2) {
            state = "Partly Cloudy";
          } else if (code === 3) {
            state = "Cloudy";
          } else if (code === 45 || code === 48) {
            state = "Fog";
          } else if (code >= 51 && code <= 55) {
            state = "Showers";
          } else if (code >= 61 && code <= 65) {
            state = "Raining";
          } else if (code >= 71 && code <= 77) {
            state = "Snow";
          } else if (code >= 80 && code <= 82) {
            state = "Showers";
          } else if (code >= 95 && code <= 99) {
            state = "Stormy";
          } else {
            // Fallback matching by description string
            const d = desc.toLowerCase();
            if (d.includes("clear") || d.includes("sunny")) state = "Sunny";
            else if (d.includes("partly")) state = "Partly Cloudy";
            else if (d.includes("cloud") || d.includes("overcast")) state = "Cloudy";
            else if (d.includes("rain") || d.includes("drizzle")) state = "Raining";
            else if (d.includes("shower")) state = "Showers";
            else if (d.includes("snow") || d.includes("ice")) state = "Snow";
            else if (d.includes("storm") || d.includes("thunder")) state = "Stormy";
            else if (d.includes("fog") || d.includes("mist")) state = "Fog";
            else if (d.includes("haze") || d.includes("hazy")) state = "Hazy";
            else if (d.includes("wind")) state = "Windy";
          }
        }

        setWeather({ state, temp });
      } catch (err) {
        setError(true);
      }
    };

    fetchWeather();
  }, [location]);

  if (!location) return null;

  if (error) {
    return (
      <div className="flex items-center flex-shrink-0 select-none">
        <span className="text-white/60 text-[13px] font-light tracking-wide whitespace-nowrap">
          Weather unavailable
        </span>
      </div>
    );
  }

  if (!weather) return null;

  return (
    <div className="flex items-center gap-2 flex-shrink-0 select-none">
      {/* Weather condition icon */}
      <WeatherIcon state={weather.state} size={22} />

      {/* Temperature */}
      <span className="text-white text-[15px] font-light tracking-wide whitespace-nowrap">
        {weather.temp}°C
      </span>
    </div>
  );
}
