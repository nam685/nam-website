// frontend/src/lib/audiobookPlayer.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  audiobookAudioUrl,
  fetchAudiobookManifest,
  fetchAudiobookPlaybackToken,
  type AudiobookManifest,
} from "./api";
import { store } from "./auth";
import {
  clearCurrent,
  loadCurrentSlug,
  loadPosition,
  loadSpeed,
  nextChunkId,
  savePosition,
  saveSpeed,
} from "./audiobookPlayerHelpers";

interface AudiobookState {
  slug: string | null;
  manifest: AudiobookManifest | null;
  currentChunkId: number;
  playing: boolean;
  progressInChunk: number;
  speed: number;
  visible: boolean;
  minimized: boolean;
  error: string | null;
}

interface AudiobookActions {
  loadBook: (slug: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  seekToChunk: (chunkId: number, offsetS?: number) => void;
  skipBack: (seconds?: number) => void;
  skipForward: (seconds?: number) => void;
  setSpeed: (speed: number) => void;
  toggleMinimize: () => void;
  close: () => void;
}

type AudiobookContextValue = AudiobookState & AudiobookActions;

const noop = () => {};
const noopAsync = async () => {};

const defaultValue: AudiobookContextValue = {
  slug: null,
  manifest: null,
  currentChunkId: 0,
  playing: false,
  progressInChunk: 0,
  speed: 1.4,
  visible: false,
  minimized: false,
  error: null,
  loadBook: noopAsync,
  play: noop,
  pause: noop,
  seekToChunk: noop,
  skipBack: noop,
  skipForward: noop,
  setSpeed: noop,
  toggleMinimize: noop,
  close: noop,
};

export const AudiobookContext = createContext<AudiobookContextValue>(defaultValue);

export function useAudiobookPlayer() {
  return useContext(AudiobookContext);
}

export function AudiobookPlayerProvider({ children }: { children: React.ReactNode }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [manifest, setManifest] = useState<AudiobookManifest | null>(null);
  const [currentChunkId, setCurrentChunkId] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progressInChunk, setProgressInChunk] = useState(0);
  const [speed, setSpeedState] = useState(1.4);
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackTokenRef = useRef<string | null>(null);
  const playbackTokenExpiresRef = useRef<number>(0); // epoch ms
  const lastPersistRef = useRef(0);

  /* ── audio element ───────────────────────────────────── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  /* ── token refresh ───────────────────────────────────── */

  const refreshPlaybackToken = useCallback(async (forSlug: string) => {
    const admin = store("adminToken");
    if (!admin) {
      setError("Not logged in");
      return null;
    }
    const { token, expires_at } = await fetchAudiobookPlaybackToken(forSlug, admin);
    playbackTokenRef.current = token;
    playbackTokenExpiresRef.current = new Date(expires_at).getTime();
    return token;
  }, []);

  const ensureFreshToken = useCallback(
    async (forSlug: string) => {
      const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
      if (
        playbackTokenRef.current &&
        playbackTokenExpiresRef.current > fiveMinFromNow
      ) {
        return playbackTokenRef.current;
      }
      return await refreshPlaybackToken(forSlug);
    },
    [refreshPlaybackToken],
  );

  /* ── core actions ────────────────────────────────────── */

  const loadChunkAudio = useCallback(
    async (chunkId: number, offsetS: number) => {
      if (!slug || !manifest || !audioRef.current) return;
      const token = await ensureFreshToken(slug);
      if (!token) return;
      audioRef.current.src = audiobookAudioUrl(slug, chunkId, token);
      audioRef.current.currentTime = offsetS;
    },
    [slug, manifest, ensureFreshToken],
  );

  const loadBook = useCallback(async (newSlug: string) => {
    const admin = store("adminToken");
    if (!admin) {
      setError("Not logged in");
      return;
    }
    setError(null);
    let m: AudiobookManifest | null;
    try {
      m = await fetchAudiobookManifest(newSlug, admin);
    } catch (e) {
      setError(String(e));
      return;
    }
    if (!m) {
      setError("Audiobook not generated yet");
      return;
    }
    setSlug(newSlug);
    setManifest(m);
    setVisible(true);
    setMinimized(false);
    setSpeedState(loadSpeed());

    const saved = loadPosition(newSlug);
    const startChunk = saved?.chunkId ?? 0;
    const startOffset = saved?.offsetS ?? 0;
    setCurrentChunkId(startChunk);
    setProgressInChunk(startOffset);

    await refreshPlaybackToken(newSlug);
    if (audioRef.current) {
      audioRef.current.src = audiobookAudioUrl(
        newSlug,
        startChunk,
        playbackTokenRef.current ?? "",
      );
      audioRef.current.currentTime = startOffset;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback(() => {
    if (!audioRef.current || !slug) return;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nam:pause-music"));
    }
    audioRef.current.play().then(
      () => setPlaying(true),
      (err) => setError(`Playback failed: ${err}`),
    );
  }, [slug]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const seekToChunk = useCallback(
    (chunkId: number, offsetS = 0) => {
      if (!manifest) return;
      const clamped = Math.max(0, Math.min(chunkId, manifest.chunks.length - 1));
      setCurrentChunkId(clamped);
      setProgressInChunk(offsetS);
      loadChunkAudio(clamped, offsetS).then(() => {
        if (playing) audioRef.current?.play();
      });
    },
    [manifest, loadChunkAudio, playing],
  );

  const skipBack = useCallback(
    (seconds = 15) => {
      if (!audioRef.current || !manifest) return;
      const newOffset = audioRef.current.currentTime - seconds;
      if (newOffset >= 0) {
        audioRef.current.currentTime = newOffset;
        return;
      }
      const prevId = currentChunkId - 1;
      if (prevId < 0) {
        audioRef.current.currentTime = 0;
        return;
      }
      const prevDuration = manifest.chunks[prevId].duration_s;
      const startInPrev = Math.max(0, prevDuration + newOffset);
      seekToChunk(prevId, startInPrev);
    },
    [currentChunkId, manifest, seekToChunk],
  );

  const skipForward = useCallback(
    (seconds = 30) => {
      if (!audioRef.current || !manifest) return;
      const currentDuration = manifest.chunks[currentChunkId].duration_s;
      const newOffset = audioRef.current.currentTime + seconds;
      if (newOffset < currentDuration) {
        audioRef.current.currentTime = newOffset;
        return;
      }
      const nextId = nextChunkId(manifest, currentChunkId);
      if (nextId === null) {
        audioRef.current.currentTime = currentDuration;
        return;
      }
      seekToChunk(nextId, newOffset - currentDuration);
    },
    [currentChunkId, manifest, seekToChunk],
  );

  const setSpeed = useCallback((s: number) => {
    const clamped = Math.max(0.5, Math.min(s, 3));
    setSpeedState(clamped);
    saveSpeed(clamped);
  }, []);

  const toggleMinimize = useCallback(() => setMinimized((m) => !m), []);

  const close = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    setVisible(false);
    setSlug(null);
    setManifest(null);
    clearCurrent();
  }, []);

  /* ── audio event handlers ────────────────────────────── */

  const onTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setProgressInChunk(a.currentTime);
    const now = Date.now();
    if (slug && now - lastPersistRef.current > 3000) {
      savePosition(slug, currentChunkId, a.currentTime);
      lastPersistRef.current = now;
    }
  }, [slug, currentChunkId]);

  const onEnded = useCallback(() => {
    if (!manifest) return;
    const nextId = nextChunkId(manifest, currentChunkId);
    if (nextId === null) {
      setPlaying(false);
      return;
    }
    setCurrentChunkId(nextId);
    setProgressInChunk(0);
    loadChunkAudio(nextId, 0).then(() => {
      audioRef.current?.play();
    });
  }, [manifest, currentChunkId, loadChunkAudio]);

  const onError = useCallback(() => {
    setError(`Audio chunk ${currentChunkId} failed to load`);
    setPlaying(false);
  }, [currentChunkId]);

  /* ── mutual exclusion: listen for music player ───────── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        setPlaying(false);
      }
    };
    window.addEventListener("nam:pause-audiobook", handler);
    return () => window.removeEventListener("nam:pause-audiobook", handler);
  }, []);

  /* ── restore current book on mount ───────────────────── */

  useEffect(() => {
    const cur = loadCurrentSlug();
    if (!cur) return;
    setSlug(cur.slug);
    setCurrentChunkId(cur.chunkId);
    setProgressInChunk(cur.offsetS);
    setVisible(true);
    setMinimized(true);
    loadBook(cur.slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AudiobookContextValue = {
    slug,
    manifest,
    currentChunkId,
    playing,
    progressInChunk,
    speed,
    visible,
    minimized,
    error,
    loadBook,
    play,
    pause,
    seekToChunk,
    skipBack,
    skipForward,
    setSpeed,
    toggleMinimize,
    close,
  };

  return <AudiobookContext.Provider value={value}>{children}</AudiobookContext.Provider>;
}
