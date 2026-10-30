"use client";

// Weather state → Remixicon component mapping (Fill variants)
// Source: figma_inputs/weather_widget/weather_icon_mapping.json

import {
  RiSunFill,
  RiCloudyFill,
  RiFoggyFill,
  RiMistFill,
  RiTempHotFill,
  RiWaterFlashFill,
  RiSunCloudyFill,
  RiRainyFill,
  RiShowersFill,
  RiSnowyFill,
  RiThunderstormsFill,
  RiWindyFill,
  RiQuestionFill,
} from "@remixicon/react";

/**
 * Map weather state strings to their corresponding Remixicon
 * React components (Fill variants). All icons render in pure white (#FFFFFF).
 */
const ICON_MAP = {
  Clear:           RiSunFill,
  Cloudy:          RiCloudyFill,
  Fog:             RiFoggyFill,
  Hazy:            RiMistFill,
  Hot:             RiTempHotFill,
  Humid:           RiWaterFlashFill,
  Mist:            RiFoggyFill,
  "Partly Cloudy": RiSunCloudyFill,
  Raining:         RiRainyFill,
  Showers:         RiShowersFill,
  Snow:            RiSnowyFill,
  Stormy:          RiThunderstormsFill,
  Sunny:           RiSunFill,
  Windy:           RiWindyFill,
};

/**
 * WeatherIcon — renders the appropriate Remixicon weather icon
 * for a given weather state string, with a custom tooltip showing the state.
 *
 * @param {{ state: string, size?: number, className?: string }} props
 */
export default function WeatherIcon({ state, size = 22, className = "" }) {
  const IconComponent = ICON_MAP[state] || RiQuestionFill;

  return (
    <span className="weather-icon-tooltip-wrap">
      <IconComponent
        size={size}
        color="#FFFFFF"
        className={className}
        aria-label={state}
      />
      <span className="weather-icon-tooltip">{state}</span>
    </span>
  );
}

