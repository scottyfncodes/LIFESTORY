import { describe, expect, it, vi } from "vitest";
import { attachPlaybackRecovery } from "@/components/weave/playback-recovery";

/** Just enough of an <audio> element: setting src restarts loading and pauses, as browsers do. */
class FakeMedia extends EventTarget {
  srcHistory: string[] = [];
  preload = "none";
  currentTime = 0;
  paused = true;
  error: { code: number } | null = null;
  plays = 0;
  get src() {
    return this.srcHistory.at(-1) ?? "";
  }
  set src(value: string) {
    this.srcHistory.push(value);
    this.error = null;
    this.paused = true;
    this.currentTime = 0;
  }
  play() {
    this.plays += 1;
    this.paused = false;
    this.fire("play");
    return Promise.resolve();
  }
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
  /** The response for the current src arrived. */
  loaded() {
    this.fire("loadedmetadata");
  }
  fail(code = 2) {
    this.error = { code };
    this.fire("error");
  }
}

const URL = "/api/projects/p/weaves/w/recordings/r/audio";
const MINUTE = 60_000;

function setup(options: { ttl?: number | null; maxAttempts?: number } = {}) {
  let clock = 1_000_000;
  const media = new FakeMedia();
  const onGiveUp = vi.fn();
  const recovery = attachPlaybackRecovery(media, {
    url: URL,
    linkTtlSeconds: options.ttl === undefined ? 300 : options.ttl,
    maxAttempts: options.maxAttempts,
    onGiveUp,
    now: () => clock,
  });
  return {
    media,
    recovery,
    onGiveUp,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** Press play, receive the first response, listen for a while, then pause. */
function listenThenPause(media: FakeMedia, seconds: number) {
  media.play();
  media.loaded();
  media.fire("playing");
  media.currentTime = seconds;
  media.paused = true;
  media.fire("pause");
}

describe("attachPlaybackRecovery", () => {
  it("points the element at the audio route", () => {
    const { media } = setup();
    expect(media.srcHistory).toEqual([URL]);
  });

  it("resuming within the link's lifetime keeps the same link", () => {
    const { media, advance } = setup();
    listenThenPause(media, 42);
    advance(4 * MINUTE);
    media.play();
    expect(media.srcHistory).toEqual([URL]);
    expect(media.currentTime).toBe(42);
  });

  it("resuming after a pause longer than the link's lifetime fetches a fresh link and continues from the same place", () => {
    const { media, advance } = setup();
    listenThenPause(media, 42);
    advance(6 * MINUTE);
    media.play();
    // A fresh link is requested from the route, not the expired one.
    expect(media.srcHistory).toEqual([URL, `${URL}?r=1`]);
    // Changing src cancels the pending play; it is asked for again straight away.
    expect(media.preload).toBe("auto");
    expect(media.paused).toBe(false);
    media.loaded();
    expect(media.currentTime).toBe(42);
    expect(media.paused).toBe(false);
  });

  it("refreshes a little before the link runs out", () => {
    const { media, advance } = setup();
    listenThenPause(media, 10);
    advance(4 * MINUTE + 31_000);
    media.play();
    expect(media.srcHistory.at(-1)).toBe(`${URL}?r=1`);
  });

  it("seeking after a long pause fetches a fresh link, lands on the seek target and stays paused", () => {
    const { media, advance } = setup();
    listenThenPause(media, 5);
    advance(6 * MINUTE);
    media.currentTime = 1200;
    media.fire("seeking");
    expect(media.srcHistory.at(-1)).toBe(`${URL}?r=1`);
    // Loads without waiting for another press, so the seek can land.
    expect(media.preload).toBe("auto");
    expect(media.paused).toBe(true);
    media.loaded();
    expect(media.currentTime).toBe(1200);
    expect(media.paused).toBe(true);
  });

  it("the restore itself doesn't trigger another refresh", () => {
    const { media, advance } = setup();
    listenThenPause(media, 42);
    advance(6 * MINUTE);
    media.play();
    media.loaded(); // restores the position (seeking) and resumes (play)
    media.fire("seeking");
    expect(media.srcHistory).toHaveLength(2);
  });

  it("an expired link that fails mid-playback is replaced without losing the place or the playing state", () => {
    const { media } = setup();
    media.play();
    media.loaded();
    media.currentTime = 300;
    media.fail(2);
    expect(media.srcHistory.at(-1)).toBe(`${URL}?r=1`);
    media.loaded();
    expect(media.currentTime).toBe(300);
    expect(media.paused).toBe(false);
  });

  it("a failure while paused restores the place without starting playback", () => {
    const { media } = setup();
    listenThenPause(media, 75);
    const playsBefore = media.plays;
    media.fail(4);
    media.loaded();
    expect(media.currentTime).toBe(75);
    expect(media.paused).toBe(true);
    expect(media.plays).toBe(playsBefore);
  });

  it("keeps the place being restored if the fresh link fails before it loads", () => {
    const { media } = setup();
    listenThenPause(media, 90);
    media.fail(2);
    media.fail(4); // the replacement failed before metadata; currentTime now reads 0
    media.loaded();
    expect(media.currentTime).toBe(90);
  });

  it("ignores aborted loads", () => {
    const { media } = setup();
    media.play();
    media.fail(1);
    expect(media.srcHistory).toEqual([URL]);
  });

  it("gives up after repeated failures, and Retry starts again", () => {
    const { media, recovery, onGiveUp } = setup({ maxAttempts: 2 });
    media.play();
    media.fail(4);
    media.fail(4);
    expect(media.srcHistory).toHaveLength(3);
    media.fail(4);
    expect(media.srcHistory).toHaveLength(3);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    recovery.retry();
    expect(media.srcHistory).toHaveLength(4);
    media.fail(4);
    expect(media.srcHistory).toHaveLength(5);
  });

  it("successful playback resets the failure count, so long listening can refresh many times", () => {
    const { media, onGiveUp } = setup({ maxAttempts: 1 });
    media.play();
    media.loaded();
    for (let i = 0; i < 10; i += 1) {
      media.fail(2);
      media.loaded();
      media.fire("playing");
    }
    expect(onGiveUp).not.toHaveBeenCalled();
    expect(media.srcHistory).toHaveLength(11);
  });

  it("without an expiring link, only failures trigger a reload", () => {
    const { media, advance } = setup({ ttl: null });
    listenThenPause(media, 42);
    advance(60 * MINUTE);
    media.play();
    media.fire("seeking");
    expect(media.srcHistory).toEqual([URL]);
  });

  it("doesn't count time before the first response", () => {
    const { media, advance } = setup();
    // The page sat open for ten minutes before the first play: no link existed yet.
    advance(10 * MINUTE);
    media.play();
    expect(media.srcHistory).toEqual([URL]);
  });

  it("detach stops listening", () => {
    const { media, recovery, advance } = setup();
    listenThenPause(media, 42);
    recovery.detach();
    advance(6 * MINUTE);
    media.play();
    media.fail(2);
    expect(media.srcHistory).toEqual([URL]);
  });
});
