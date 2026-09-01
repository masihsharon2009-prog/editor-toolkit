import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Download,
  FileVideo,
  Film,
  FolderOpen,
  Crosshair,
  Info,
  Link2,
  ListVideo,
  Minus,
  Pause,
  Play,
  Plus,
  Scissors,
  Trash2,
  Upload,
  Youtube,
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

type Source = {
  type: 'youtube' | 'local';
  url: string;
  label: string;
};

type Moment = {
  id: string;
  start: number;
  end: number;
  tags: string[];
  note: string;
  sourceLabel: string;
  createdAt: number;
};

type YouTubePlayer = {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState?: () => number;
  destroy?: () => void;
};

declare global {
  interface Window {
    YT?: { Player: new (element: string | HTMLElement, options: Record<string, unknown>) => YouTubePlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const queryClient = new QueryClient();
const STORAGE_KEY = 'clip-finder-moments-v1';

const checklist = [
  { id: 'impact', label: 'Sudden motion or impact frame', short: 'Impact frame', key: '1' },
  { id: 'closeup', label: 'Character close-up with a strong line', short: 'Strong close-up', key: '2' },
  { id: 'reaction', label: 'Reaction shot', short: 'Reaction shot', key: '3' },
  { id: 'reveal', label: 'Big reveal beat', short: 'Reveal beat', key: '4' },
];

function formatTime(seconds: number, includeHours = false) {
  if (!Number.isFinite(seconds)) return '00:00';
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (includeHours || hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function parseTime(value: string) {
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function getYouTubeId(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1).split('/')[0];
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    const match = url.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function readMoments(): Moment[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) as Moment[] : [];
  } catch {
    return [];
  }
}

function AppShell() {
  const [source, setSource] = useState<Source | null>(null);
  const [sourceTab, setSourceTab] = useState<'youtube' | 'local'>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [moments, setMoments] = useState<Moment[]>(readMoments);
  const [toast, setToast] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [localFileName, setLocalFileName] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const sortedMoments = useMemo(
    () => [...moments].sort((a, b) => b.tags.length - a.tags.length || a.start - b.start),
    [moments],
  );

  const timelineMoments = useMemo(
    () => [...moments].sort((a, b) => a.start - b.start || b.tags.length - a.tags.length),
    [moments],
  );

  const announce = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2600);
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(moments));
  }, [moments]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        setStartTime(currentTime);
        announce(`Start marked at ${formatTime(currentTime)}`);
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        setEndTime(currentTime);
        announce(`End marked at ${formatTime(currentTime)}`);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveBetweenMoments(-1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveBetweenMoments(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    if (!source || source.type !== 'youtube') return;
    let cancelled = false;
    setSourceLoading(true);
    setSourceError('');
    const loadApi = () => new Promise<void>((resolve, reject) => {
      if (window.YT) {
        resolve();
        return;
      }
      const existing = document.getElementById('youtube-iframe-api');
      if (existing) {
        const started = Date.now();
        const timer = window.setInterval(() => {
          if (window.YT) {
            window.clearInterval(timer);
            resolve();
          } else if (Date.now() - started > 8000) {
            window.clearInterval(timer);
            reject(new Error('YouTube player did not load.'));
          }
        }, 100);
        return;
      }
      const script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      window.onYouTubeIframeAPIReady = () => resolve();
      script.onerror = () => reject(new Error('YouTube player could not load.'));
      document.body.appendChild(script);
    });
    loadApi().then(() => {
      if (cancelled || !playerHostRef.current || !window.YT) return;
      playerRef.current?.destroy?.();
      playerRef.current = new window.YT.Player(playerHostRef.current, {
        videoId: getYouTubeId(source.url),
        playerVars: { modestbranding: 1, rel: 0, playsinline: 1, controls: 0 },
        events: {
          onReady: (event: { target: YouTubePlayer }) => {
            playerRef.current = event.target;
            setDuration(event.target.getDuration?.() || 0);
            setSourceLoading(false);
          },
          onStateChange: (event: { data: number }) => setIsPlaying(event.data === 1),
          onError: () => {
            setSourceLoading(false);
            setSourceError('This YouTube video could not be embedded. Check the link or try a local file.');
          },
        },
      });
    }).catch((error: Error) => {
      if (!cancelled) {
        setSourceLoading(false);
        setSourceError(error.message);
      }
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [source]);

  useEffect(() => {
    if (!source || source.type !== 'youtube') return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (player?.getCurrentTime) setCurrentTime(player.getCurrentTime());
      if (player?.getDuration && player.getDuration() > 0) setDuration(player.getDuration());
    }, 250);
    return () => window.clearInterval(timer);
  }, [source]);

  const seekTo = (time: number) => {
    const next = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, time));
    setCurrentTime(next);
    if (source?.type === 'local' && videoRef.current) videoRef.current.currentTime = next;
    if (source?.type === 'youtube') playerRef.current?.seekTo(next, true);
  };

  const seekBy = (delta: number) => seekTo(currentTime + delta);

  const moveBetweenMoments = (direction: -1 | 1) => {
    if (!timelineMoments.length) {
      announce('Log a moment before using moment navigation.');
      return;
    }

    const currentIndex = timelineMoments.findIndex(
      (moment) => currentTime >= moment.start && currentTime <= moment.end,
    );
    let nextIndex = -1;

    if (currentIndex >= 0) {
      nextIndex = currentIndex + direction;
    } else if (direction === 1) {
      nextIndex = timelineMoments.findIndex((moment) => moment.start > currentTime);
    } else {
      for (let index = timelineMoments.length - 1; index >= 0; index -= 1) {
        if (timelineMoments[index].start < currentTime) {
          nextIndex = index;
          break;
        }
      }
    }

    if (nextIndex < 0 || nextIndex >= timelineMoments.length) {
      announce(direction === 1 ? 'Already at the last logged moment.' : 'Already at the first logged moment.');
      return;
    }

    const nextMoment = timelineMoments[nextIndex];
    seekTo(nextMoment.start);
    announce(`Jumped to ${formatTime(nextMoment.start)}`);
  };

  const togglePlayback = () => {
    if (!source) {
      announce('Load a video to start reviewing.');
      return;
    }
    if (source.type === 'local' && videoRef.current) {
      if (videoRef.current.paused) {
        void videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    } else if (source.type === 'youtube') {
      if (isPlaying) playerRef.current?.pauseVideo();
      else playerRef.current?.playVideo();
    }
    setIsPlaying((playing) => !playing);
  };

  const loadYouTube = () => {
    const id = getYouTubeId(youtubeUrl.trim());
    if (!id) {
      setSourceError('Paste a full YouTube link, such as youtube.com/watch?v=...');
      return;
    }
    setSource({ type: 'youtube', url: youtubeUrl.trim(), label: `YouTube / ${id}` });
    setCurrentTime(0);
    setDuration(0);
    setStartTime(0);
    setEndTime(0);
  };

  const loadLocal = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setSourceError('That file is not a video. Choose an MP4, WebM, MOV, or another video file.');
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    setLocalFileName(file.name);
    setSource({ type: 'local', url: objectUrlRef.current, label: file.name });
    setSourceLoading(true);
    setSourceError('');
    setCurrentTime(0);
    setDuration(0);
    setStartTime(0);
    setEndTime(0);
  };

  const clearSource = () => {
    playerRef.current?.destroy?.();
    playerRef.current = null;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setSource(null);
    setLocalFileName('');
    setYoutubeUrl('');
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setSourceLoading(false);
    setSourceError('');
  };

  const markStart = () => {
    setStartTime(currentTime);
    announce(`Start marked at ${formatTime(currentTime)}`);
  };

  const markEnd = () => {
    setEndTime(currentTime);
    announce(`End marked at ${formatTime(currentTime)}`);
  };

  const logMoment = () => {
    if (!source) {
      announce('Load one video before logging a moment.');
      return;
    }
    if (endTime < startTime) {
      announce('End must be at or after Start.');
      return;
    }
    const newMoment: Moment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      start: startTime,
      end: endTime,
      tags: selectedTags,
      note: note.trim(),
      sourceLabel: source.label,
      createdAt: Date.now(),
    };
    setMoments((existing) => [...existing, newMoment]);
    setSelectedTags([]);
    setNote('');
    announce(`Moment logged · ${selectedTags.length} tag${selectedTags.length === 1 ? '' : 's'}`);
  };

  const deleteMoment = (id: string) => {
    setMoments((existing) => existing.filter((moment) => moment.id !== id));
    announce('Moment removed.');
  };

  const copyList = async () => {
    if (!sortedMoments.length) {
      announce('Log a moment before copying the list.');
      return;
    }
    const text = sortedMoments.map((moment, index) =>
      `${String(index + 1).padStart(2, '0')}  ${formatTime(moment.start)}–${formatTime(moment.end)}  ${moment.tags.map((tag) => checklist.find((item) => item.id === tag)?.short).join(', ')}${moment.note ? `  — ${moment.note}` : ''}`,
    ).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      announce('Clip list copied to clipboard.');
    } catch {
      announce('Clipboard access is unavailable in this browser.');
    }
  };

  const exportCsv = () => {
    if (!sortedMoments.length) {
      announce('Log a moment before exporting.');
      return;
    }
    const rows = [
      ['Start', 'End', 'Tags', 'Note'],
      ...sortedMoments.map((moment) => [
        formatTime(moment.start, true),
        formatTime(moment.end, true),
        moment.tags.map((tag) => checklist.find((item) => item.id === tag)?.label).join('; '),
        moment.note,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'clip-finder-moments.csv';
    anchor.click();
    URL.revokeObjectURL(url);
    announce('CSV export downloaded.');
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="clip-grain min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/80 bg-[hsl(var(--background)/.92)] backdrop-blur-md">
        <div className="mx-auto flex min-h-[72px] max-w-[1480px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background shadow-sm" data-testid="brand-mark">
              <Scissors size={19} strokeWidth={2.3} />
            </div>
            <div>
              <div className="font-serif text-[18px] font-bold tracking-[-.04em]" data-testid="text-brand">Clip Finder</div>
              <div className="font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">footage review desk</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.13em] text-muted-foreground sm:inline-flex" data-testid="status-local-storage">
              <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--chart-4))]" />
              Saved locally
            </span>
            <button type="button" onClick={() => setShowShortcuts((open) => !open)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold transition hover:bg-muted" data-testid="button-shortcuts">
              <CircleHelp size={15} />
              <span className="hidden sm:inline">Shortcuts</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:mb-8 sm:flex-row sm:items-end">
          <div className="clip-rise">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.2em] text-[hsl(var(--primary))]">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
              Session 01
            </div>
            <h1 className="font-serif text-3xl font-bold tracking-[-.055em] sm:text-4xl" data-testid="text-page-title">Find the frames worth keeping.</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Load one piece of footage, mark the beats, and leave your future self a clean edit map.</p>
          </div>
          <div className="flex items-center gap-5 border-l-2 border-[hsl(var(--accent))] pl-4 sm:mb-1" data-testid="status-session-summary">
            <div>
              <div className="font-serif text-2xl font-bold leading-none">{moments.length}</div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">logged moments</div>
            </div>
            <div>
              <div className="font-serif text-2xl font-bold leading-none">{source ? '01' : '—'}</div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">active source</div>
            </div>
          </div>
        </div>

        <section className="mb-5 rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4" aria-label="Video source">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex shrink-0 items-center gap-2 pr-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-[hsl(var(--secondary-foreground))]"><Film size={16} /></div>
              <div>
                <div className="text-xs font-bold uppercase tracking-[.08em]">Source</div>
                <div className="font-mono text-[9px] text-muted-foreground">{source ? 'one video loaded' : 'load exactly one video'}</div>
              </div>
            </div>
            {source ? (
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-[hsl(var(--chart-4)/.35)] bg-[hsl(var(--chart-4)/.08)] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  {source.type === 'youtube' ? <Youtube size={16} className="shrink-0 text-[hsl(var(--primary))]" /> : <FileVideo size={16} className="shrink-0 text-[hsl(var(--chart-4))]" />}
                  <span className="truncate text-xs font-semibold" data-testid="text-active-source">{source.label}</span>
                  <span className="hidden rounded bg-card px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground sm:inline">{source.type === 'youtube' ? 'youtube api' : 'local file'}</span>
                </div>
                <button type="button" onClick={clearSource} className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-muted-foreground transition hover:bg-card hover:text-foreground" data-testid="button-replace-source">Replace</button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                <div className="flex rounded-lg border border-border bg-muted p-1">
                  <button type="button" onClick={() => setSourceTab('youtube')} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-bold transition ${sourceTab === 'youtube' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} data-testid="button-source-youtube"><Link2 size={14} /> YouTube link</button>
                  <button type="button" onClick={() => setSourceTab('local')} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-bold transition ${sourceTab === 'local' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} data-testid="button-source-local"><FolderOpen size={14} /> Local file</button>
                </div>
                {sourceTab === 'youtube' ? (
                  <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); loadYouTube(); }}>
                    <input value={youtubeUrl} onChange={(event) => { setYoutubeUrl(event.target.value); setSourceError(''); }} placeholder="Paste a YouTube URL" className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-[hsl(var(--primary))]" aria-label="YouTube URL" data-testid="input-youtube-url" />
                    <button type="submit" className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[.98]" data-testid="button-load-youtube"><Link2 size={14} /> <span className="hidden sm:inline">Load video</span><span className="sm:hidden">Load</span></button>
                  </form>
                ) : (
                  <label className="flex min-h-10 flex-1 cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-[hsl(var(--primary)/.45)] bg-[hsl(var(--primary)/.05)] px-3 text-xs font-semibold transition hover:bg-[hsl(var(--primary)/.1)]" data-testid="label-local-upload">
                    <span className="flex items-center gap-2"><Upload size={15} className="text-[hsl(var(--primary))]" /> {localFileName || 'Choose a video file from your device'}</span>
                    <input type="file" accept="video/*" className="sr-only" onChange={(event) => loadLocal(event.target.files?.[0])} aria-label="Choose local video" data-testid="input-local-video" />
                    <span className="rounded-md bg-card px-2 py-1 font-mono text-[9px] uppercase tracking-[.1em]">Browse</span>
                  </label>
                )}
              </div>
            )}
          </div>
          {sourceError && <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert" data-testid="status-source-error"><Info size={15} className="mt-0.5 shrink-0" /> <span>{sourceError}</span></div>}
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(390px,.8fr)]">
          <div className="min-w-0 space-y-5">
            <section className="clip-rise clip-rise-delay-1 overflow-hidden rounded-2xl border border-foreground/10 bg-foreground shadow-lg" aria-label="Video player">
              <div className="relative aspect-video min-h-[240px] bg-[#252321]">
                {!source ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-background">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-background/20 bg-background/10"><ListVideo size={25} strokeWidth={1.5} /></div>
                    <div className="font-serif text-xl font-bold tracking-[-.03em]">Your edit bay is empty.</div>
                    <p className="mt-2 max-w-sm text-xs leading-5 text-background/60">Paste a YouTube link or choose a local video above. Your markers stay in this browser.</p>
                    <div className="mt-5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.15em] text-background/45"><span>Space</span><span>play / pause</span><span className="text-background/20">·</span><span>I / O</span><span>mark range</span></div>
                  </div>
                ) : source.type === 'local' ? (
                  <video ref={videoRef} src={source.url} className="absolute inset-0 h-full w-full object-contain" onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration); setSourceLoading(false); }} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onError={() => { setSourceLoading(false); setSourceError('This local video could not be decoded by your browser.'); }} controls={false} data-testid="video-local-player" />
                ) : (
                  <div ref={playerHostRef} className="absolute inset-0 h-full w-full [&>iframe]:h-full [&>iframe]:w-full" data-testid="video-youtube-player" />
                )}
                {sourceLoading && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#252321]/90 text-background" data-testid="status-player-loading"><div className="h-2 w-24 animate-pulse rounded-full bg-background/25" /><div className="h-2 w-14 animate-pulse rounded-full bg-[hsl(var(--accent)/.7)]" /><span className="text-[10px] font-semibold uppercase tracking-[.12em] text-background/55">Preparing footage</span></div>}
                {source && !sourceLoading && <div className="pointer-events-none absolute left-4 top-4 rounded bg-[#161514]/75 px-2 py-1 font-mono text-[9px] uppercase tracking-[.14em] text-background/70">{source.type === 'youtube' ? 'YT / review' : 'LOCAL / review'}</div>}
              </div>
              <div className="border-t border-background/10 bg-[#1d1c1a] px-4 pb-3 pt-2.5 sm:px-5">
                <div className="relative mb-2 h-1.5 cursor-pointer rounded-full bg-background/15" onClick={(event) => { if (!duration) return; const rect = event.currentTarget.getBoundingClientRect(); seekTo(((event.clientX - rect.left) / rect.width) * duration); }} role="slider" aria-label="Video timeline" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} tabIndex={0} data-testid="slider-video-timeline">
                  <div className="h-full rounded-full bg-[hsl(var(--primary))] transition-[width] duration-100" style={{ width: `${Math.min(100, progress)}%` }} />
                  <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#1d1c1a] bg-[hsl(var(--accent))] shadow" style={{ left: `${Math.min(100, progress)}%` }} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => seekBy(-5)} className="flex h-8 w-8 items-center justify-center rounded-md text-background/65 transition hover:bg-background/10 hover:text-background" aria-label="Back five seconds" data-testid="button-seek-back"><Minus size={15} /></button>
                    <button type="button" onClick={togglePlayback} className="flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-accent-foreground transition hover:brightness-95 active:scale-95" aria-label={isPlaying ? 'Pause video' : 'Play video'} data-testid="button-play-pause">{isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
                    <button type="button" onClick={() => seekBy(5)} className="flex h-8 w-8 items-center justify-center rounded-md text-background/65 transition hover:bg-background/10 hover:text-background" aria-label="Forward five seconds" data-testid="button-seek-forward"><Plus size={15} /></button>
                    <span className="ml-1 font-mono text-[11px] tabular-nums text-background/75" data-testid="text-current-time">{formatTime(currentTime, duration >= 3600)} <span className="text-background/30">/</span> {formatTime(duration, duration >= 3600)}</span>
                  </div>
                   <div className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-background/35 sm:flex"><span>↑↓ moments</span><span className="text-background/15">·</span><span>I / O mark</span></div>
                </div>
              </div>
            </section>

            <section className="clip-rise clip-rise-delay-2 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-label="Moment details">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.17em] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" /> Mark a moment</div>
                  <h2 className="mt-1 font-serif text-xl font-bold tracking-[-.035em]">What makes this beat useful?</h2>
                </div>
                <div className="rounded-full bg-muted px-2.5 py-1 font-mono text-[10px] font-medium text-muted-foreground" data-testid="text-selected-tag-count">{selectedTags.length}/4 selected</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {checklist.map((item) => {
                  const checked = selectedTags.includes(item.id);
                  return (
                    <button type="button" key={item.id} onClick={() => setSelectedTags((tags) => checked ? tags.filter((tag) => tag !== item.id) : [...tags, item.id])} className={`group flex min-h-[58px] items-center gap-3 rounded-xl border p-3 text-left transition ${checked ? 'border-[hsl(var(--primary)/.55)] bg-[hsl(var(--primary)/.08)]' : 'border-border bg-background hover:border-foreground/25 hover:bg-muted'}`} aria-pressed={checked} data-testid={`button-tag-${item.id}`}>
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-mono text-[10px] font-medium transition ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-muted-foreground group-hover:border-foreground/30'}`}>{checked ? <Check size={14} strokeWidth={2.7} /> : item.key}</span>
                      <span className={`text-xs font-semibold leading-4 ${checked ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="my-5 h-px bg-border" />
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <TimeField label="Start" value={formatTime(startTime, duration >= 3600)} onChange={setStartTime} testId="input-start-time" markTestId="button-mark-start" onMark={markStart} />
                <TimeField label="End" value={formatTime(endTime, duration >= 3600)} onChange={setEndTime} testId="input-end-time" markTestId="button-mark-end" onMark={markEnd} />
                <div className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground sm:mb-0.5"><span className="text-[hsl(var(--primary))]">I</span> / <span className="text-[hsl(var(--primary))]">O</span> hotkeys</div>
              </div>
              <div className="mt-3">
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground" htmlFor="clip-note">Note <span className="font-normal normal-case tracking-normal opacity-70">· optional</span></label>
                <textarea id="clip-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Why should an editor come back to this?" className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-[hsl(var(--primary))]" data-testid="input-moment-note" />
              </div>
              <button type="button" onClick={logMoment} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[.99]" data-testid="button-log-moment"><Scissors size={16} /> Log this moment</button>
            </section>
          </div>

          <aside className="clip-rise clip-rise-delay-3 min-w-0 rounded-2xl border border-border bg-card shadow-sm xl:sticky xl:top-5 xl:self-start" aria-label="Logged moments">
            <div className="border-b border-border p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.17em] text-muted-foreground"><ListVideo size={13} /> Edit map</div>
                  <h2 className="mt-1 font-serif text-xl font-bold tracking-[-.035em]" data-testid="text-moments-heading">Logged moments</h2>
                </div>
                <div className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-foreground px-2 font-mono text-xs font-medium text-background" data-testid="text-moment-count">{moments.length}</div>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={copyList} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background text-xs font-bold transition hover:bg-muted" data-testid="button-copy-list"><Clipboard size={14} /> Copy list</button>
                <button type="button" onClick={exportCsv} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background text-xs font-bold transition hover:bg-muted" data-testid="button-export-csv"><Download size={14} /> Export CSV</button>
              </div>
            </div>
            <div className="clip-scrollbar max-h-[calc(100vh-245px)] overflow-y-auto p-3 sm:p-4">
              {!sortedMoments.length ? (
                <div className="flex min-h-[310px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background px-6 text-center" data-testid="empty-moments-state">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Scissors size={20} /></div>
                  <div className="font-serif text-lg font-bold tracking-[-.03em]">No moments yet</div>
                  <p className="mt-2 max-w-[230px] text-xs leading-5 text-muted-foreground">Press play, spot something with a pulse, and tag it. Your edit map will build here.</p>
                  <div className="mt-5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground/70"><span className="rounded bg-muted px-1.5 py-1">Space</span><span>to play</span></div>
                </div>
              ) : (
                <div className="space-y-2" data-testid="list-moments">
                  {sortedMoments.map((moment, index) => (
                    <article key={moment.id} className="group rounded-xl border border-border bg-background p-3 transition hover:border-foreground/25 hover:shadow-sm" data-testid={`card-moment-${moment.id}`}>
                      <div className="flex items-start gap-2">
                        <button type="button" onClick={() => seekTo(moment.start)} className="flex shrink-0 items-center gap-2 rounded-md bg-[hsl(var(--accent)/.45)] px-2 py-1.5 font-mono text-sm font-medium tabular-nums text-foreground transition hover:bg-[hsl(var(--accent))]" aria-label={`Jump to ${formatTime(moment.start)}`} data-testid={`button-jump-moment-${moment.id}`}><Play size={11} fill="currentColor" /> {formatTime(moment.start)}</button>
                        <div className="min-w-0 flex-1 pt-1">
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="font-mono uppercase tracking-[.1em]">Beat {String(index + 1).padStart(2, '0')}</span><span>·</span><span>{formatTime(Math.max(0, moment.end - moment.start))} duration</span></div>
                        </div>
                        <button type="button" onClick={() => deleteMoment(moment.id)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-50 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100" aria-label="Delete moment" data-testid={`button-delete-moment-${moment.id}`}><Trash2 size={14} /></button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {moment.tags.length ? moment.tags.map((tag) => <span key={tag} className="rounded-md border border-border bg-card px-2 py-1 text-[10px] font-semibold" data-testid={`tag-moment-${moment.id}-${tag}`}>{checklist.find((item) => item.id === tag)?.short}</span>) : <span className="rounded-md border border-dashed border-border px-2 py-1 text-[10px] text-muted-foreground">Uncategorized beat</span>}
                      </div>
                      {moment.note && <p className="mt-2 border-l-2 border-[hsl(var(--primary)/.45)] pl-2 text-xs leading-5 text-muted-foreground" data-testid={`text-note-moment-${moment.id}`}>{moment.note}</p>}
                    </article>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-center gap-2 text-[10px] leading-4 text-muted-foreground" data-testid="text-sort-description"><ChevronDown size={13} className="text-[hsl(var(--primary))]" /> Sorted by number of checked tags, then timestamp</div>
            </div>
          </aside>
        </div>
      </main>

      {showShortcuts && <div className="fixed bottom-5 right-4 z-40 w-[min(330px,calc(100vw-32px))] rounded-xl border border-foreground/15 bg-foreground p-4 text-background shadow-xl sm:right-7" role="dialog" aria-label="Keyboard shortcuts" data-testid="dialog-shortcuts">
        <div className="mb-3 flex items-center justify-between"><div className="text-xs font-bold uppercase tracking-[.1em]">Keyboard shortcuts</div><button type="button" onClick={() => setShowShortcuts(false)} className="text-background/60 hover:text-background" aria-label="Close shortcuts" data-testid="button-close-shortcuts">×</button></div>
        <div className="space-y-2 font-mono text-[10px] text-background/70"><Shortcut keyName="Space" label="Play / pause" /><Shortcut keyName="I" label="Mark start" /><Shortcut keyName="O" label="Mark end" /><Shortcut keyName="↑  ↓" label="Move between moments" /></div>
        <div className="mt-3 border-t border-background/15 pt-3 text-[10px] leading-4 text-background/45">Shortcuts pause while your cursor is in a text field.</div>
      </div>}
      <div className={`fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-xs font-semibold text-background shadow-xl transition ${toastVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'}`} role="status" aria-live="polite" data-testid="status-toast"><Check size={15} className="text-[hsl(var(--accent))]" /> {toast}</div>
    </div>
  );
}

function TimeField({ label, value, onChange, onMark, testId, markTestId }: { label: string; value: string; onChange: (value: number) => void; onMark: () => void; testId: string; markTestId: string }) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">{label}</label>
      <div className="flex gap-2">
        <input value={draft} onFocus={() => { focusedRef.current = true; }} onChange={(event) => { setDraft(event.target.value); onChange(parseTime(event.target.value)); }} onBlur={() => { focusedRef.current = false; setDraft(formatTime(parseTime(draft))); }} className="time-input h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-sm tabular-nums outline-none transition focus:border-[hsl(var(--primary))]" aria-label={`${label} timestamp`} data-testid={testId} />
        <button type="button" onClick={onMark} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 text-[10px] font-bold uppercase tracking-[.05em] transition hover:bg-secondary" data-testid={markTestId}><Crosshair size={13} /> Mark</button>
      </div>
    </div>
  );
}

function Shortcut({ keyName, label }: { keyName: string; label: string }) {
  return <div className="flex items-center justify-between gap-4"><span>{label}</span><span className="rounded border border-background/20 bg-background/10 px-2 py-1 text-background">{keyName}</span></div>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={AppShell} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
