import React, { useMemo, useState, useEffect } from 'react'
import { Runner } from '../../hooks/useRunners'

interface TimePressureIndicatorProps {
  selectedSymbol: string | null
  runners: Runner[]
  signalExpirationMinutes?: number // Default 20 minutes
}

interface TimePressureState {
  minutesRemaining: number
  percentRemaining: number
  status: 'fresh' | 'aging' | 'stale' | 'expired'
  statusText: string
}

function calculateTimePressure(
  runner: Runner | undefined,
  expirationMinutes: number
): TimePressureState {
  // Use the runner's first_gap_date as the signal start time
  // For intraday, we'll calculate from market open (9:30 AM ET)
  const now = new Date()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()

  // Calculate minutes since market open (9:30 AM)
  const marketOpenMinutes = 9 * 60 + 30
  const currentMinutes = currentHour * 60 + currentMinute
  const minutesSinceOpen = currentMinutes - marketOpenMinutes

  // For multi-day runners, the signal is based on the original gap
  // But for intraday purposes, we consider how fresh the current day's action is
  // Use gap_age_days to determine if this is a fresh day 1 or continuation

  let signalAge: number

  if (runner) {
    // If it's day 1 (gap_age_days === 0), signal started at open
    // If it's day 2+, signal is based on current session activity
    if (runner.gap_age_days === 0) {
      // Fresh gap - timer starts from market open
      signalAge = Math.max(0, minutesSinceOpen)
    } else {
      // Multi-day runner - use a sliding window approach
      // The "signal" refreshes each day at open
      signalAge = Math.max(0, minutesSinceOpen)
    }
  } else {
    // No runner data - assume started at open
    signalAge = Math.max(0, minutesSinceOpen)
  }

  const minutesRemaining = Math.max(0, expirationMinutes - signalAge)
  const percentRemaining = Math.max(0, Math.min(100, (minutesRemaining / expirationMinutes) * 100))

  let status: TimePressureState['status']
  let statusText: string

  if (percentRemaining > 66) {
    status = 'fresh'
    statusText = 'Fresh Signal'
  } else if (percentRemaining > 33) {
    status = 'aging'
    statusText = 'Signal Aging'
  } else if (percentRemaining > 0) {
    status = 'stale'
    statusText = 'Signal Stale'
  } else {
    status = 'expired'
    statusText = 'Signal Expired'
  }

  return {
    minutesRemaining: Math.round(minutesRemaining),
    percentRemaining,
    status,
    statusText
  }
}

function formatTime(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }
  return `${minutes}m`
}

function getStatusColor(status: TimePressureState['status']): string {
  switch (status) {
    case 'fresh': return '#00C853'
    case 'aging': return '#FFD600'
    case 'stale': return '#FF9800'
    case 'expired': return '#FF1744'
  }
}

export function TimePressureIndicator({
  selectedSymbol,
  runners,
  signalExpirationMinutes = 30
}: TimePressureIndicatorProps) {
  const [currentTime, setCurrentTime] = useState(new Date())

  // Update every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  const runner = useMemo(() => {
    if (!selectedSymbol) return undefined
    return runners.find(r => r.symbol === selectedSymbol)
  }, [selectedSymbol, runners])

  const timePressure = useMemo(() => {
    return calculateTimePressure(runner, signalExpirationMinutes)
  }, [runner, signalExpirationMinutes, currentTime])

  if (!selectedSymbol) {
    return (
      <div className="time-pressure-indicator">
        <div className="time-pressure-header">
          <span className="time-pressure-icon">⏱</span>
          <span className="time-pressure-label" title="Countdown showing how long since the setup was detected. Fresh setups (<10min) are best; aging setups lose edge. Helps avoid chasing moves that have already played out.">Entry Window</span>
        </div>
        <div className="time-pressure-empty">Select a symbol</div>
      </div>
    )
  }

  const color = getStatusColor(timePressure.status)

  return (
    <div className="time-pressure-indicator">
      <div className="time-pressure-header">
        <span className="time-pressure-icon">⏱</span>
        <span className="time-pressure-label" title="Countdown showing how long since the setup was detected. Fresh setups (<10min) are best; aging setups lose edge. Helps avoid chasing moves that have already played out.">Entry Window</span>
        <span
          className={`time-pressure-status status-${timePressure.status}`}
          style={{ color }}
        >
          {timePressure.statusText}
        </span>
      </div>

      <div className="time-pressure-bar">
        <div className="time-bar-track">
          <div
            className="time-bar-fill"
            style={{
              width: `${timePressure.percentRemaining}%`,
              backgroundColor: color
            }}
          />
        </div>
        <span className="time-remaining" style={{ color }}>
          {timePressure.minutesRemaining > 0
            ? formatTime(timePressure.minutesRemaining)
            : 'Expired'
          }
        </span>
      </div>

      {runner && (
        <div className="time-pressure-details">
          <span className="detail-item">
            Day {runner.gap_age_days + 1} Runner
          </span>
          {runner.gap_age_days === 0 && (
            <span className="detail-item fresh-gap">Fresh Gap</span>
          )}
        </div>
      )}
    </div>
  )
}
