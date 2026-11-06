"use client";
import { useCallback, useEffect, useState } from "react";
export type Resource<T> = {
  data?: T;
  error?: string;
  loading: boolean;
  at?: string;
  refresh: () => void;
};
export function useResource<T>(
  path: string | null,
  tick = 0,
  interval = 15000,
): Resource<T> {
  const [state, set] = useState<{
    key: string | null;
    data?: T;
    error?: string;
    at?: string;
    loading: boolean;
  }>({ key: null, loading: true });
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    let stopped = false;
    let controller: AbortController | undefined;
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      controller = new AbortController();
      const active = controller;
      set((old) =>
        old.key === path
          ? { ...old, loading: old.data === undefined }
          : { key: path, loading: true },
      );
      try {
        const response = await fetch("/api/backend" + path, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(25000),
          ]),
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message || `Backend HTTP ${response.status}`,
          );
        if (!stopped)
          set({
            key: path,
            data: body,
            at: new Date().toISOString(),
            loading: false,
          });
      } catch (error) {
        if (!stopped && !active.signal.aborted)
          set((old) => ({
            ...old,
            key: path,
            error: error instanceof Error ? error.message : "Request failed",
            loading: false,
          }));
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), interval);
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(timer);
    };
  }, [path, tick, retry, interval]);
  return { ...(state.key === path ? state : { loading: !!path }), refresh };
}
export function useLive(query: string | null, onUpdate: () => void) {
  const [status, setStatus] = useState("connecting");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!query) {
      setStatus("waiting for source");
      return;
    }
    setStatus("connecting");
    const source = new EventSource("/api/backend/api/v1/live?" + query);
    const update = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          onUpdate();
        }, 500);
    };
    source.onopen = () => setStatus("connected");
    source.onerror = () => setStatus("reconnecting");
    source.addEventListener("snapshot", update);
    source.addEventListener("observation", update);
    return () => {
      source.close();
      clearTimeout(timer);
    };
  }, [query, onUpdate]);
  return query ? status : "waiting for source";
}
