/** Helpers for reading a Snap JSX tree in tests. */

export type El = { type: string; props: Record<string, unknown> };

/**
 * Every string anywhere in the tree (props and children).
 * @param node - The tree.
 * @param acc - Accumulator.
 * @returns All strings, depth first.
 */
export function collectText(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string') {
    acc.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, acc));
  } else if (node && typeof node === 'object') {
    Object.values((node as El).props ?? {}).forEach((value) => collectText(value, acc));
  }
  return acc;
}

/**
 * Every element in the tree, depth first, in render order.
 * @param node - The tree.
 * @param type - Keep only this component type, when given.
 * @param acc - Accumulator.
 * @returns The elements.
 */
export function collectElements(node: unknown, type?: string, acc: El[] = []): El[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, type, acc));
  } else if (node && typeof node === 'object' && typeof (node as El).type === 'string') {
    const el = node as El;
    if (!type || el.type === type) {
      acc.push(el);
    }
    Object.values(el.props ?? {}).forEach((value) => collectElements(value, type, acc));
  }
  return acc;
}

/**
 * The direct children of an element, as an array.
 * @param el - The element.
 * @returns Its children.
 */
export function childrenOf(el: unknown): unknown[] {
  const { children } = (el as El).props;
  return Array.isArray(children) ? children.flat(Infinity) : [children];
}
