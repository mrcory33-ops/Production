const COLS = 180;
const SEGMENTS = 6;
const ROWS = 300;
const ITERATIONS = 50;

const segments = Array.from({ length: SEGMENTS }, (_, idx) => ({
  startCol: idx * 3,
  duration: 3
}));

const columns = Array.from({ length: COLS }, (_, idx) => idx);

const renderOld = () => {
  let checksum = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < columns.length; c += 1) {
      const hasSegmentStart = segments.some(seg => seg.startCol === c);
      if (hasSegmentStart) {
        segments.map((seg, segIndex) => {
          if (seg.startCol === c) {
            checksum += seg.duration + segIndex;
          }
          return null;
        });
      }
    }
  }
  return checksum;
};

const renderNew = () => {
  let checksum = 0;
  const segmentsByStartCol = new Map();
  segments.forEach((seg, segIndex) => {
    const list = segmentsByStartCol.get(seg.startCol);
    if (list) {
      list.push({ seg, segIndex });
    } else {
      segmentsByStartCol.set(seg.startCol, [{ seg, segIndex }]);
    }
  });

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < columns.length; c += 1) {
      const startSegments = segmentsByStartCol.get(c);
      if (startSegments) {
        startSegments.map(({ seg, segIndex }) => {
          checksum += seg.duration + segIndex;
          return null;
        });
      }
    }
  }
  return checksum;
};

const bench = (label, fn) => {
  const start = process.hrtime.bigint();
  let checksum = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    checksum += fn();
  }
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1e6;
  console.log(`${label}: ${ms.toFixed(2)}ms (checksum ${checksum})`);
  return ms;
};

bench('old-loop', renderOld);
bench('new-loop', renderNew);
