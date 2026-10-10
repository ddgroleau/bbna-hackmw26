import { useEffect, useState } from 'react';
import type { Posture } from './api';

export type Tone = 'ok' | 'warn' | 'info' | 'danger';

export const POSTURES: Record<Posture, { label: string; tone: Tone }> = {
    normal: { label: 'Normal operations', tone: 'ok' },
    delay: { label: 'Delayed start', tone: 'warn' },
    early_dismissal: { label: 'Early dismissal', tone: 'warn' },
    telework: { label: 'Remote learning', tone: 'info' },
    closure: { label: 'Closure', tone: 'danger' },
};

export const POSTURE_ORDER = Object.keys(POSTURES) as Posture[];

export function useNow(intervalMs = 1000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

export function formatTime(value: string | number, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(value));
}

export function formatDateTime(value: string | number, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone,
    }).format(new Date(value));
}

export function formatCountdown(ms: number): string {
    const totalMinutes = Math.floor(ms / 60_000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    const seconds = Math.floor((ms % 60_000) / 1000);
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatCount(value: number): string {
    return value.toLocaleString('en-US');
}

export function formatTemp(value: number | null): string {
    if (value === null) return '—';
    return `${value < 0 ? '−' : ''}${Math.abs(value)}°F`;
}
