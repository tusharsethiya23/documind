/** onnxruntime session options shared by the embedding and reranking models. */
import { config } from '../config.js';

export function ortSessionOptions() {
  const options = {};
  if (config.ortThreads > 0) {
    options.intraOpNumThreads = config.ortThreads;
    options.interOpNumThreads = 1;
  }
  if (config.ortLowMemory) {
    // Don't keep a growing memory pool and per-shape buffer plans between calls:
    // slightly slower, much lower peak memory on small containers.
    options.enableCpuMemArena = false;
    options.enableMemPattern = false;
  }
  return options;
}
