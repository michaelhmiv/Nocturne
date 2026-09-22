export type InteriorRoom = {
  roomKey: string;
  label: string;
};

export type InteriorGraph = {
  sourceKey: string;
  rooms: InteriorRoom[];
  edges: Array<[string, string]>;
};

export function interiorForSource(sourceKey: string): InteriorGraph {
  const front = `${sourceKey}#front`;
  const counter = `${sourceKey}#counter`;
  const street = `${sourceKey}#street_door`;
  return {
    sourceKey,
    rooms: [
      { roomKey: street, label: "street door" },
      { roomKey: front, label: "front" },
      { roomKey: counter, label: "counter" },
    ],
    edges: [
      [street, front],
      [front, counter],
    ],
  };
}

export function canTraverse(graph: InteriorGraph, from: string, to: string) {
  return graph.edges.some(
    ([left, right]) => (left === from && right === to) || (left === to && right === from),
  );
}
