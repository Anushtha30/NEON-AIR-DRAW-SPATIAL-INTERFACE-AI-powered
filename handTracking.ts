export type HandLandmark = { x: number; y: number; z: number };
export type HandResults = {
  multiHandLandmarks: HandLandmark[][];
  multiHandedness: { label: string; score: number }[];
};

export type GestureType =
  | "idle"
  | "drawing"
  | "erasing"
  | "clear"
  | "move"
  | "scale"
  | "rotate";

export type HandGesture = {
  gesture: GestureType;
  indexTip: { x: number; y: number };
  thumbTip: { x: number; y: number };
  pinchDistance: number;
  handLabel: "Left" | "Right";
};

function distance(a: HandLandmark, b: HandLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function isFingerUp(landmarks: HandLandmark[], tip: number, pip: number): boolean {
  return landmarks[tip].y < landmarks[pip].y;
}

export function detectGesture(
  landmarks: HandLandmark[],
  handLabel: "Left" | "Right"
): HandGesture {
  const indexTip = landmarks[8];
  const thumbTip = landmarks[4];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const thumbUp = isFingerUp(landmarks, 4, 3);
  const indexUp = isFingerUp(landmarks, 8, 6);
  const middleUp = isFingerUp(landmarks, 12, 10);
  const ringUp = isFingerUp(landmarks, 16, 14);
  const pinkyUp = isFingerUp(landmarks, 20, 18);

  const pinchDist = distance(thumbTip, indexTip);

  const upCount = [thumbUp, indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  let gesture: GestureType = "idle";

  if (handLabel === "Right") {
    if (!indexUp && !middleUp && !ringUp && !pinkyUp && !thumbUp) {
      gesture = "clear";
    } else if (indexUp && !middleUp && !ringUp && !pinkyUp) {
      gesture = "drawing";
    } else if (pinchDist < 0.05) {
      gesture = "erasing";
    }
  } else {
    if (upCount >= 4) {
      gesture = "rotate";
    } else if (pinchDist < 0.07 || (thumbUp && indexUp && !middleUp)) {
      gesture = "scale";
    } else if (indexUp && middleUp && !ringUp && !pinkyUp) {
      gesture = "move";
    }
  }

  return {
    gesture,
    indexTip: { x: indexTip.x, y: indexTip.y },
    thumbTip: { x: thumbTip.x, y: thumbTip.y },
    pinchDistance: pinchDist,
    handLabel,
  };
}

export function mirrorX(x: number): number {
  return 1 - x;
}
