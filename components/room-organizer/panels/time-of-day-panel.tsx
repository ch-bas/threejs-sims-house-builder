'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRoomEditor } from '../contexts';
import { TIME_PRESETS, type TimePresetKey } from '../three/lighting';
import type { Weather } from '../lib/types';

const PRESETS: ReadonlyArray<{ key: TimePresetKey; label: string; icon: string }> = [
  { key: 'dawn', label: 'Dawn', icon: '🌅' },
  { key: 'noon', label: 'Noon', icon: '☀️' },
  { key: 'dusk', label: 'Dusk', icon: '🌇' },
  { key: 'midnight', label: 'Night', icon: '🌙' },
];

/** Weather over the lot (#189); view-only, like the hour. */
const WEATHERS: ReadonlyArray<{ key: Weather; label: string; icon: string }> = [
  { key: 'clear', label: 'Clear', icon: '🌤️' },
  { key: 'rain', label: 'Rain', icon: '🌧️' },
  { key: 'snow', label: 'Snow', icon: '❄️' },
];

export function TimeOfDayPanel(): JSX.Element {
  const { view, setView, autoCycleLighting, setAutoCycleLighting } = useRoomEditor();
  const timeOfDay = view.timeOfDay;
  const disabled = view.view2D;

  const hours = Math.floor(timeOfDay);
  const minutes = Math.floor((timeOfDay - hours) * 60);
  const clockLabel = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>🕒 Time of Day</span>
          <span className="text-xs font-mono text-muted-foreground">{clockLabel}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          type="range"
          min={0}
          max={24}
          step={0.25}
          value={timeOfDay}
          onChange={(event) => setView((v) => ({ ...v, timeOfDay: parseFloat(event.target.value) }))}
          disabled={disabled}
          className="w-full"
          aria-label="Time of day"
        />
        <div className="grid grid-cols-4 gap-1">
          {PRESETS.map((preset) => (
            <Button
              key={preset.key}
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setView((v) => ({ ...v, timeOfDay: TIME_PRESETS[preset.key] }))}
              className="text-[10px] h-8 px-1 flex flex-col"
            >
              <span>{preset.icon}</span>
              <span>{preset.label}</span>
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant={autoCycleLighting ? 'default' : 'outline'}
          onClick={() => setAutoCycleLighting((cur) => !cur)}
          disabled={disabled}
          className="w-full text-xs"
        >
          {autoCycleLighting ? '⏸ Stop time' : '▶ Speed up time'}
        </Button>
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Weather">
          {WEATHERS.map((option) => {
            const active = view.weather === option.key;
            return (
              <Button
                key={option.key}
                size="sm"
                variant={active ? 'default' : 'outline'}
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => setView((v) => ({ ...v, weather: option.key }))}
                className="text-[10px] h-8 px-1 flex flex-col"
              >
                <span>{option.icon}</span>
                <span>{option.label}</span>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
