export type Point = { x: number; y: number };

export type Stroke = {
  id: string;
  points: Point[];
  color: string;
  size: number;
  opacity: number;
  tx: number;
  ty: number;
  scale: number;
  rotation: number;
};

let strokeIdCounter = 0;

export function createStroke(color: string, size: number, opacity: number): Stroke {
  return {
    id: `stroke-${++strokeIdCounter}-${Date.now()}`,
    points: [],
    color,
    size,
    opacity,
    tx: 0,
    ty: 0,
    scale: 1,
    rotation: 0,
  };
}

export function addPointToStroke(stroke: Stroke, point: Point): Stroke {
  return { ...stroke, points: [...stroke.points, point] };
}

export function renderStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);

  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    renderStroke(ctx, stroke, width, height);
  }
}

export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
  highlight = false
) {
  if (stroke.points.length < 2) return;

  const cx = getStrokeCentroid(stroke, width, height);

  ctx.save();
  ctx.translate(cx.x, cx.y);
  ctx.rotate(stroke.rotation);
  ctx.scale(stroke.scale, stroke.scale);
  ctx.translate(-cx.x + stroke.tx * width, -cx.y + stroke.ty * height);

  ctx.globalAlpha = stroke.opacity;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (highlight) {
    ctx.shadowBlur = 20;
    ctx.shadowColor = stroke.color;
    ctx.lineWidth = stroke.size * 1.5;
  } else {
    ctx.shadowBlur = 8;
    ctx.shadowColor = stroke.color;
  }

  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);

  for (let i = 1; i < stroke.points.length - 1; i++) {
    const xc = ((stroke.points[i].x + stroke.points[i + 1].x) / 2) * width;
    const yc = ((stroke.points[i].y + stroke.points[i + 1].y) / 2) * height;
    ctx.quadraticCurveTo(
      stroke.points[i].x * width,
      stroke.points[i].y * height,
      xc,
      yc
    );
  }

  const last = stroke.points[stroke.points.length - 1];
  ctx.lineTo(last.x * width, last.y * height);
  ctx.stroke();
  ctx.restore();
}

export function getStrokeCentroid(
  stroke: Stroke,
  width: number,
  height: number
): Point {
  if (stroke.points.length === 0) return { x: 0, y: 0 };
  const sumX = stroke.points.reduce((s, p) => s + p.x * width, 0);
  const sumY = stroke.points.reduce((s, p) => s + p.y * height, 0);
  return {
    x: sumX / stroke.points.length,
    y: sumY / stroke.points.length,
  };
}

export function getNearestStroke(
  strokes: Stroke[],
  px: number,
  py: number,
  width: number,
  height: number
): Stroke | null {
  let nearest: Stroke | null = null;
  let minDist = Infinity;

  for (const stroke of strokes) {
    const centroid = getStrokeCentroid(stroke, width, height);
    const realX = centroid.x + stroke.tx * width;
    const realY = centroid.y + stroke.ty * height;
    const dist = Math.sqrt((realX - px * width) ** 2 + (realY - py * height) ** 2);
    if (dist < minDist) {
      minDist = dist;
      nearest = stroke;
    }
  }

  return nearest;
}

export function eraseStrokes(
  strokes: Stroke[],
  px: number,
  py: number,
  radius: number,
  width: number,
  height: number
): Stroke[] {
  return strokes.filter((stroke) => {
    const centroid = getStrokeCentroid(stroke, width, height);
    const realX = centroid.x + stroke.tx * width;
    const realY = centroid.y + stroke.ty * height;
    const dist = Math.sqrt((realX - px * width) ** 2 + (realY - py * height) ** 2);
    return dist > radius;
  });
}

export const NEON_COLORS = [
  "#b16cea", // violet
  "#818cf8", // indigo
  "#4aaeff", // blue
  "#6ef7a7", // green
  "#ffce45", // yellow
  "#ff8a56", // orange
  "#ff5e69", // red
];
