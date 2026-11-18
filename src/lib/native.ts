// Bridge to the native iOS parts (plugins/native-ui): the glass tab bar,
// haptics and the keyboard. Messages go out through a WebKit message
// handler; answers come back through window.__vitroNative(name, payload).

type Payload = Record<string, unknown>;
type Handler = (payload: Payload) => void;

interface NativeWindow {
  webkit?: { messageHandlers?: { vitroNative?: { postMessage(message: unknown): void } } };
  __vitroNative?: (name: string, payload: Payload) => void;
}

const w = window as unknown as NativeWindow;
const handlers = new Map<string, Set<Handler>>();
// The last bar and theme state, sent again when the native side (re)starts.
const latest = new Map<string, Payload>();

/** True inside the iOS app (the native plugin is listening). */
export function hasNative(): boolean {
  return !!w.webkit?.messageHandlers?.vitroNative;
}

export function postNative(message: Payload & { type: string }) {
  if (message.type === "bar" || message.type === "theme") latest.set(message.type, message);
  try {
    w.webkit?.messageHandlers?.vitroNative?.postMessage(message);
  } catch {
    /* the web view is going away */
  }
}

export function onNative(name: string, fn: Handler): () => void {
  let set = handlers.get(name);
  if (!set) handlers.set(name, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

w.__vitroNative = (name, payload) => {
  if (name === "ready") {
    document.documentElement.classList.add("is-native");
    for (const message of latest.values()) postNative(message as Payload & { type: string });
  }
  handlers.get(name)?.forEach((fn) => fn(payload ?? {}));
};
