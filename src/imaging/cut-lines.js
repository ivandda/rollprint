/**
 * The dashed lines printed between two things that are cut apart, and along a fold. Markers, covers
 * and folded cards all share them, so a sheet of any of them is cut the same way.
 */

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

/** Dashed lines to cut or fold along, in millimetres. */
export const CUT_LINE = { width: 0.3, dash: 1.2, gap: 0.9 };

/**
 * Dashed lines to cut along, each drawn once, centred on the edge two cells share, and where a
 * label's leftover space starts. The dashes line up from one cell to the next.
 * @param {OffscreenCanvasRenderingContext2D} context
 * @param {Rect[]} cells
 * @param {Rect | undefined} area  Edges on this area's sides are the label's own and get no line.
 *   Without it, as on a round label, the outer edges get lines too.
 * @param {number} dotsPerMm
 */
export function drawCutLines(context, cells, area, dotsPerMm) {
  context.strokeStyle = "black";
  context.lineWidth = Math.max(1, CUT_LINE.width * dotsPerMm);
  context.setLineDash([CUT_LINE.dash * dotsPerMm, CUT_LINE.gap * dotsPerMm]);
  /**
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   */
  const line = (x1, y1, x2, y2) => {
    context.lineDashOffset = x1 === x2 ? y1 : x1;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  };
  /**
   * @param {number} position
   * @param {number | undefined} edge
   */
  const onLabelEdge = (position, edge) => edge !== undefined && Math.abs(position - edge) < 1;

  for (const { x, y, width, height } of cells) {
    const right = x + width;
    const bottom = y + height;
    if (!onLabelEdge(right, area && area.x + area.width)) line(right, y, right, bottom);
    if (!onLabelEdge(bottom, area && area.y + area.height)) line(x, bottom, right, bottom);
    // Left and top edges are a neighbour's right and bottom, except around a round label's square.
    const first = cells[0];
    if (!area && x === first.x) line(x, y, x, bottom);
    if (!area && y === first.y) line(x, y, right, y);
  }
  context.setLineDash([]);
}
