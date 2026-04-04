"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ListenTrack } from "@/lib/api";

/* ── YouTube IFrame API global types ─────────────────────── */

declare global {
  interface Window {
    YT: {
      Player: new (
        el: string | HTMLElement,
        opts: {
          height?: string | number;
          width?: string | number;
          videoId?: string;
          playerVars?: Record<string, number | string>;
          events?: Record<string, (e: YTEvent) => void>;
        },
      ) => YTPlayer;
      PlayerState: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

interface YTEvent {
  data: number;
  target: YTPlayer;
}

interface YTPlayer {
  loadVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

/* ── Repeat mode ─────────────────────────────────────────── */

type RepeatMode = "off" | "all" | "one";

/* ── Session persistence (survives full page reloads) ───── */

const SESSION_KEY = "player-session";

interface PersistedPlayerState {
  queue: ListenTrack[];
  currentIndex: number;
  playing: boolean;
  progress: number;
  shuffle: boolean;
  repeat: RepeatMode;
  visible: boolean;
  minimized: boolean;
}

function loadSession(): PersistedPlayerState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(state: PersistedPlayerState) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {}
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}

/* ── Context value ───────────────────────────────────────── */

interface PlayerState {
  queue: ListenTrack[];
  currentIndex: number;
  playing: boolean;
  progress: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  visible: boolean;
  minimized: boolean;
}

interface PlayerActions {
  play: (track: ListenTrack, queue?: ListenTrack[]) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleMinimize: () => void;
  close: () => void;
}

type PlayerContextValue = PlayerState & PlayerActions;

const noop = () => {};

const defaultState: PlayerContextValue = {
  queue: [],
  currentIndex: -1,
  playing: false,
  progress: 0,
  duration: 0,
  shuffle: false,
  repeat: "off",
  visible: false,
  minimized: false,
  play: noop,
  pause: noop,
  resume: noop,
  next: noop,
  prev: noop,
  seek: noop,
  toggleShuffle: noop,
  cycleRepeat: noop,
  toggleMinimize: noop,
  close: noop,
};

export const PlayerContext = createContext<PlayerContextValue>(defaultState);

export function usePlayer() {
  return useContext(PlayerContext);
}

/* ── Provider ────────────────────────────────────────────── */

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<ListenTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const playerRef = useRef<YTPlayer | null>(null);
  const ytReadyRef = useRef(false);
  const pendingVideoRef = useRef<string | null>(null);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track whether pause was user-initiated vs YouTube-initiated (ads, throttling, etc.)
  const userRequestedPauseRef = useRef(false);
  const resumeAttemptRef = useRef(0);

  // On restore, seek to saved position once playback starts
  const seekOnPlayRef = useRef<number | null>(null);

  // Video ID to load when user taps play after a session restore
  const pendingResumeRef = useRef<string | null>(null);

  // Refs that track latest state for use in callbacks
  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat);
  const playingRef = useRef(playing);
  const progressRef = useRef(progress);
  const visibleRef = useRef(visible);
  const minimizedRef = useRef(minimized);
  queueRef.current = queue;
  currentIndexRef.current = currentIndex;
  shuffleRef.current = shuffle;
  repeatRef.current = repeat;
  playingRef.current = playing;
  progressRef.current = progress;
  visibleRef.current = visible;
  minimizedRef.current = minimized;

  /* ── Load YouTube IFrame API ───────────────────────────── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.YT && window.YT.Player) {
      ytReadyRef.current = true;
      return;
    }
    // Avoid duplicate script tags
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) return;

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      ytReadyRef.current = true;
      // If a video was requested before API was ready, load it now
      if (pendingVideoRef.current) {
        createPlayerAndLoad(pendingVideoRef.current);
        pendingVideoRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Restore session after full page reload ─────────────── */

  useEffect(() => {
    const saved = loadSession();
    if (!saved || !saved.visible || saved.queue.length === 0) return;

    setQueue(saved.queue);
    setCurrentIndex(saved.currentIndex);
    setShuffle(saved.shuffle);
    setRepeat(saved.repeat);
    setVisible(true);
    setMinimized(saved.minimized);
    setProgress(saved.progress);

    // Don't auto-play — browsers block autoplay without a user gesture.
    // Show paused MiniPlayer; user taps play to resume (handled in resume()).
    if (saved.playing) {
      const track = saved.queue[saved.currentIndex];
      if (track) {
        seekOnPlayRef.current = saved.progress > 0 ? saved.progress : null;
        pendingResumeRef.current = track.video_id;
      }
    }
  }, []);

  /* ── Persist session on meaningful state changes ────────── */

  useEffect(() => {
    if (!visible) return;
    saveSession({
      queue,
      currentIndex,
      playing,
      progress: progressRef.current,
      shuffle,
      repeat,
      visible,
      minimized,
    });
  }, [queue, currentIndex, playing, shuffle, repeat, visible, minimized]);

  useEffect(() => {
    const handler = () => {
      if (!visibleRef.current || !queueRef.current.length) return;
      saveSession({
        queue: queueRef.current,
        currentIndex: currentIndexRef.current,
        playing: playingRef.current,
        progress: progressRef.current,
        shuffle: shuffleRef.current,
        repeat: repeatRef.current,
        visible: visibleRef.current,
        minimized: minimizedRef.current,
      });
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  /* ── Progress polling ──────────────────────────────────── */

  useEffect(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
    if (playing && playerRef.current) {
      progressInterval.current = setInterval(() => {
        if (playerRef.current) {
          try {
            setProgress(playerRef.current.getCurrentTime());
            setDuration(playerRef.current.getDuration());
          } catch {
            // player may not be ready
          }
        }
      }, 500);
    }
    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
    };
  }, [playing]);

  /* ── Create / reuse YT player ──────────────────────────── */

  const onStateChange = useCallback((event: YTEvent) => {
    const state = event.data;
    if (state === window.YT.PlayerState.PLAYING) {
      setPlaying(true);
      setDuration(event.target.getDuration());
      resumeAttemptRef.current = 0;
      // After restoring a session, seek to the saved position
      if (seekOnPlayRef.current !== null) {
        event.target.seekTo(seekOnPlayRef.current, true);
        seekOnPlayRef.current = null;
      }
    } else if (state === window.YT.PlayerState.PAUSED) {
      if (userRequestedPauseRef.current) {
        // User explicitly paused — accept it
        setPlaying(false);
      } else if (resumeAttemptRef.current < 2) {
        // YouTube paused unexpectedly (e.g. navigation, throttling) — try to resume
        resumeAttemptRef.current += 1;
        setTimeout(() => {
          try {
            playerRef.current?.playVideo();
          } catch {
            setPlaying(false);
          }
        }, 300);
      } else {
        // Exhausted retries — accept the pause
        setPlaying(false);
        resumeAttemptRef.current = 0;
      }
    } else if (state === window.YT.PlayerState.ENDED) {
      handleTrackEnd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createPlayerAndLoad = useCallback(
    (videoId: string) => {
      // Ensure container exists
      let container = document.getElementById("yt-player-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "yt-player-container";
        container.style.position = "fixed";
        container.style.top = "-9999px";
        container.style.left = "-9999px";
        container.style.width = "1px";
        container.style.height = "1px";
        container.style.overflow = "hidden";
        document.body.appendChild(container);
      }

      if (playerRef.current) {
        // Reuse existing player
        playerRef.current.loadVideoById(videoId);
        return;
      }

      // Create a fresh div for the player (YT replaces it with an iframe)
      let playerEl = document.getElementById("yt-player-el");
      if (playerEl) playerEl.remove();
      playerEl = document.createElement("div");
      playerEl.id = "yt-player-el";
      container.appendChild(playerEl);

      playerRef.current = new window.YT.Player("yt-player-el", {
        height: "1",
        width: "1",
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
        },
        events: {
          onStateChange,
        },
      });
    },
    [onStateChange],
  );

  /* ── Auto-advance on track end ─────────────────────────── */

  const handleTrackEnd = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    const rep = repeatRef.current;
    const shuf = shuffleRef.current;

    if (rep === "one") {
      // Replay same track
      playerRef.current?.seekTo(0, true);
      playerRef.current?.playVideo();
      return;
    }

    if (shuf) {
      if (q.length <= 1) return;
      let next: number;
      do {
        next = Math.floor(Math.random() * q.length);
      } while (next === idx);
      setCurrentIndex(next);
      loadTrackAtIndex(next, q);
      return;
    }

    const nextIdx = idx + 1;
    if (nextIdx < q.length) {
      setCurrentIndex(nextIdx);
      loadTrackAtIndex(nextIdx, q);
    } else if (rep === "all" && q.length > 0) {
      setCurrentIndex(0);
      loadTrackAtIndex(0, q);
    } else {
      userRequestedPauseRef.current = true; // queue exhausted — don't auto-resume
      setPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTrackAtIndex = useCallback(
    (idx: number, q: ListenTrack[]) => {
      const track = q[idx];
      if (!track) return;
      setProgress(0);
      setDuration(0);
      if (playerRef.current) {
        playerRef.current.loadVideoById(track.video_id);
      } else if (ytReadyRef.current) {
        createPlayerAndLoad(track.video_id);
      } else {
        pendingVideoRef.current = track.video_id;
      }
    },
    [createPlayerAndLoad],
  );

  /* ── Actions ───────────────────────────────────────────── */

  const play = useCallback(
    (track: ListenTrack, newQueue?: ListenTrack[]) => {
      userRequestedPauseRef.current = false;
      resumeAttemptRef.current = 0;
      const q = newQueue ?? [track];
      const idx = q.findIndex(
        (t) => t.video_id === track.video_id && t.played_at === track.played_at,
      );
      const finalIdx = idx >= 0 ? idx : 0;

      setQueue(q);
      setCurrentIndex(finalIdx);
      setVisible(true);
      setMinimized(false);
      setProgress(0);
      setDuration(0);

      if (ytReadyRef.current) {
        createPlayerAndLoad(track.video_id);
      } else {
        pendingVideoRef.current = track.video_id;
      }
    },
    [createPlayerAndLoad],
  );

  const pause = useCallback(() => {
    userRequestedPauseRef.current = true;
    playerRef.current?.pauseVideo();
    setPlaying(false);
  }, []);

  const resume = useCallback(() => {
    userRequestedPauseRef.current = false;
    resumeAttemptRef.current = 0;

    // After a session restore, the YT player doesn't exist yet.
    // The user's tap is the gesture that allows autoplay.
    if (!playerRef.current && pendingResumeRef.current) {
      const videoId = pendingResumeRef.current;
      pendingResumeRef.current = null;
      if (ytReadyRef.current) {
        createPlayerAndLoad(videoId);
      } else {
        pendingVideoRef.current = videoId;
      }
      setPlaying(true);
      return;
    }

    playerRef.current?.playVideo();
    setPlaying(true);
  }, [createPlayerAndLoad]);

  const next = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    const shuf = shuffleRef.current;
    const rep = repeatRef.current;

    if (q.length === 0) return;
    userRequestedPauseRef.current = false;
    resumeAttemptRef.current = 0;

    if (shuf) {
      if (q.length <= 1) return;
      let n: number;
      do {
        n = Math.floor(Math.random() * q.length);
      } while (n === idx);
      setCurrentIndex(n);
      loadTrackAtIndex(n, q);
      return;
    }

    let nextIdx = idx + 1;
    if (nextIdx >= q.length) {
      if (rep === "off") return;
      nextIdx = 0;
    }
    setCurrentIndex(nextIdx);
    loadTrackAtIndex(nextIdx, q);
  }, [loadTrackAtIndex]);

  const prev = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;

    if (q.length === 0) return;
    userRequestedPauseRef.current = false;
    resumeAttemptRef.current = 0;

    // If more than 3s in, restart current track
    if (playerRef.current) {
      try {
        if (playerRef.current.getCurrentTime() > 3) {
          playerRef.current.seekTo(0, true);
          setProgress(0);
          return;
        }
      } catch {
        // ignore
      }
    }

    let prevIdx = idx - 1;
    if (prevIdx < 0) prevIdx = q.length - 1;
    setCurrentIndex(prevIdx);
    loadTrackAtIndex(prevIdx, q);
  }, [loadTrackAtIndex]);

  const seek = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
    setProgress(seconds);
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => !s);
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => {
      if (r === "off") return "all";
      if (r === "all") return "one";
      return "off";
    });
  }, []);

  const toggleMinimize = useCallback(() => {
    setMinimized((m) => !m);
  }, []);

  const close = useCallback(() => {
    userRequestedPauseRef.current = true;
    playerRef.current?.stopVideo();
    setPlaying(false);
    setVisible(false);
    setProgress(0);
    setDuration(0);
    clearSession();
  }, []);

  /* ── Context value ─────────────────────────────────────── */

  const currentTrack =
    currentIndex >= 0 && currentIndex < queue.length
      ? queue[currentIndex]
      : null;

  const value: PlayerContextValue = {
    queue,
    currentIndex,
    playing,
    progress,
    duration,
    shuffle,
    repeat,
    visible: visible && currentTrack !== null,
    minimized,
    play,
    pause,
    resume,
    next,
    prev,
    seek,
    toggleShuffle,
    cycleRepeat,
    toggleMinimize,
    close,
  };

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}
