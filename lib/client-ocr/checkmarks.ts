export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function findCheckmarks(imageData: ImageData): BoundingBox[] {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);

  // 1. Green pixel thresholding
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    if (g > 150 && (g - r) > 30 && (g - b) > 30) {
      mask[i] = 1;
    }
  }

  // 2. Dilation (3 iterations, 4-connected)
  let current = mask;
  for (let iter = 0; iter < 3; iter++) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (current[idx]) {
          next[idx] = 1;
        } else {
          let hasNeighbor = false;
          if (x > 0 && current[idx - 1]) hasNeighbor = true;
          if (x < width - 1 && current[idx + 1]) hasNeighbor = true;
          if (y > 0 && current[idx - width]) hasNeighbor = true;
          if (y < height - 1 && current[idx + width]) hasNeighbor = true;
          if (hasNeighbor) next[idx] = 1;
        }
      }
    }
    current = next;
  }

  // 3. Connected-component labeling (BFS)
  const visited = new Uint8Array(width * height);
  const boxes: BoundingBox[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (current[idx] && !visited[idx]) {
        let minX = x, maxX = x, minY = y, maxY = y;
        const queue = [idx];
        visited[idx] = 1;
        let head = 0;

        while (head < queue.length) {
          const curr = queue[head++];
          const cx = curr % width;
          const cy = Math.floor(curr / width);

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          const neighbors = [curr - 1, curr + 1, curr - width, curr + width];
          for (const n of neighbors) {
            const nx = n % width;
            const ny = Math.floor(n / width);
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (Math.abs(nx - cx) + Math.abs(ny - cy) === 1) {
                if (current[n] && !visited[n]) {
                  visited[n] = 1;
                  queue.push(n);
                }
              }
            }
          }
        }

        if ((maxX - minX) >= 6 && (maxY - minY) >= 6) {
          boxes.push({ x0: minX, y0: minY, x1: maxX, y1: maxY });
        }
      }
    }
  }

  boxes.sort((a, b) => (a.y0 === b.y0 ? a.x0 - b.x0 : a.y0 - b.y0));
  return boxes;
}