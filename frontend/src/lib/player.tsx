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

  // Refs that track latest state for use in callbacks
  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat);
  queueRef.current = queue;
  currentIndexRef.current = currentIndex;
  shuffleRef.current = shuffle;
  repeatRef.current = repeat;

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
    } else if (state === window.YT.PlayerState.PAUSED) {
      setPlaying(false);
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
    playerRef.current?.pauseVideo();
    setPlaying(false);
  }, []);

  const resume = useCallback(() => {
    playerRef.current?.playVideo();
    setPlaying(true);
  }, []);

  const next = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    const shuf = shuffleRef.current;
    const rep = repeatRef.current;

    if (q.length === 0) return;

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
    playerRef.current?.stopVideo();
    setPlaying(false);
    setVisible(false);
    setProgress(0);
    setDuration(0);
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
