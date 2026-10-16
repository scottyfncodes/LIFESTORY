// Keeps a recording playing from the right place when its storage link expires.
//
// On Blob storage the audio route redirects to a read-only link that is valid
// for a few minutes. Browsers keep using that redirected link for later Range
// requests, so after a long pause the next fetch (a resume that needs more
// data, or a seek) is refused. Recreating the element would start again at
// 0:00, so instead this keeps the same element, asks the route for a fresh
// link and puts the listener back where they were.

/** The parts of HTMLMediaElement this needs; a fake can stand in for tests. */
export interface MediaLike extends EventTarget {
  src: string;
  preload: string;
  currentTime: number;
  readonly paused: boolean;
  readonly error: { code: number } | null;
  play(): Promise<void>;
}

export type PlaybackRecovery = {
  /** Start again after giving up, from the current position. */
  retry(): void;
  detach(): void;
};

const MEDIA_ERR_ABORTED = 1;

export function attachPlaybackRecovery(
  media: MediaLike,
  options: {
    url: string;
    /** How long the server's playback link lasts, or null if it doesn't expire. */
    linkTtlSeconds: number | null;
    /** Consecutive failed reloads before giving up. */
    maxAttempts?: number;
    onGiveUp?: () => void;
    now?: () => number;
  },
): PlaybackRecovery {
  const { url, linkTtlSeconds, maxAttempts = 3, onGiveUp, now = Date.now } = options;
  // Refresh a little early so a link never runs out mid-request.
  const staleAfterMs = linkTtlSeconds ? (linkTtlSeconds - Math.min(30, linkTtlSeconds / 5)) * 1000 : null;
  let generation = 0;
  let linkAt: number | null = null;
  let restore: { time: number; play: boolean } | null = null;
  let failures = 0;

  const stale = () => staleAfterMs !== null && linkAt !== null && now() - linkAt >= staleAfterMs;

  function reload(time: number, play: boolean) {
    generation += 1;
    linkAt = null;
    restore = { time: Number.isFinite(time) ? time : 0, play };
    // The listener has already started this recording, so load straight
    // away rather than waiting for another press (preload="none").
    media.preload = "auto";
    // Setting src restarts loading on the same element. That cancels a play
    // that was pending, so ask again now, while the listener's tap still counts.
    media.src = `${url}?r=${generation}`;
    if (play) media.play().catch(() => {});
  }

  const onLoadedMetadata = () => {
    // The link was issued for the request that just answered.
    linkAt = now();
    if (!restore) return;
    const { time, play } = restore;
    restore = null;
    if (time > 0) media.currentTime = time;
    // If the browser still wants a fresh tap (autoplay rules), the position is kept.
    if (play && media.paused) media.play().catch(() => {});
  };
  const onPlay = () => {
    if (!restore && stale()) reload(media.currentTime, true);
  };
  const onSeeking = () => {
    // currentTime is already the seek target here.
    if (!restore && stale()) reload(media.currentTime, !media.paused);
  };
  const onPlaying = () => {
    failures = 0;
  };
  const onError = () => {
    if (media.error?.code === MEDIA_ERR_ABORTED) return;
    if (failures >= maxAttempts) {
      onGiveUp?.();
      return;
    }
    failures += 1;
    // A failure while restoring keeps the position being restored.
    reload(restore?.time ?? media.currentTime, restore?.play ?? !media.paused);
  };

  media.addEventListener("loadedmetadata", onLoadedMetadata);
  media.addEventListener("play", onPlay);
  media.addEventListener("seeking", onSeeking);
  media.addEventListener("playing", onPlaying);
  media.addEventListener("error", onError);
  media.src = url;

  return {
    retry() {
      failures = 0;
      reload(restore?.time ?? media.currentTime, false);
    },
    detach() {
      media.removeEventListener("loadedmetadata", onLoadedMetadata);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("seeking", onSeeking);
      media.removeEventListener("playing", onPlaying);
      media.removeEventListener("error", onError);
    },
  };
}
