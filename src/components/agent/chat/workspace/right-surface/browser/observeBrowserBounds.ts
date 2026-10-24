/** ResizeObserver misses position changes caused by an ancestor's transition. */
export function observeBrowserBounds(
  element: HTMLElement,
  onChange: () => void,
): () => void {
  let disposed = false;
  let frame: number | null = null;
  const moving = () => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (
        node
          .getAnimations?.()
          .some(
            (animation) =>
              "transitionProperty" in animation &&
              (animation.playState === "running" || animation.pending),
          )
      )
        return true;
    }
    return false;
  };
  const tick = () => {
    frame = null;
    update();
  };
  const update = () => {
    if (disposed) return;
    onChange();
    if (frame === null && moving()) frame = requestAnimationFrame(tick);
  };
  const transition = (event: Event) => {
    if (event.target instanceof Element && event.target.contains(element))
      update();
  };
  const document = element.ownerDocument;
  const window = document.defaultView;
  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  observer?.observe(element);
  window?.addEventListener("resize", update);
  const events = ["transitionrun", "transitionend", "transitioncancel"];
  events.forEach((event) => document.addEventListener(event, transition, true));
  update();
  return () => {
    disposed = true;
    observer?.disconnect();
    window?.removeEventListener("resize", update);
    events.forEach((event) =>
      document.removeEventListener(event, transition, true),
    );
    if (frame !== null) cancelAnimationFrame(frame);
  };
}
