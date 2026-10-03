/**
 * Append the node to <body> for its lifetime. Escapes overflow clipping and
 * transformed/filtered ancestors: a fixed child inside the blurred top bar would
 * otherwise have the bar as its containing block and be clipped by it.
 */
export function portal(node: HTMLElement): { destroy(): void } {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}
