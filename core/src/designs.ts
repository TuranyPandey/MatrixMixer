/**
 * Ready-made pictures for the Image page: small pixel art, drawn at half size
 * here and doubled onto the matrix so every dot of the art is a 2x2 block that
 * reads from across a room.
 */
import { applyMask, blankFrame, setPixel, type Frame } from './frame';
import { SIZE } from './protocol';

const ART: ReadonlyArray<readonly [name: string, rows: readonly string[]]> = [
  [
    'Heart',
    [
      '.##...##.',
      '####.####',
      '#########',
      '#########',
      '.#######.',
      '..#####..',
      '...###...',
      '....#....',
    ],
  ],
  [
    'Smile',
    [
      '..#####..',
      '.#.....#.',
      '#.......#',
      '#.#...#.#',
      '#.......#',
      '#.#...#.#',
      '#..###..#',
      '.#.....#.',
      '..#####..',
    ],
  ],
  [
    'Star',
    [
      '....#....',
      '....#....',
      '...###...',
      '#########',
      '.#######.',
      '..#####..',
      '..#####..',
      '.###.###.',
      '.#.....#.',
    ],
  ],
  [
    'Check',
    [
      '........#',
      '.......##',
      '#.....##.',
      '##...##..',
      '.##.##...',
      '..###....',
      '...#.....',
    ],
  ],
  [
    'Cross',
    [
      '.#.....#.',
      '###...###',
      '.###.###.',
      '..#####..',
      '...###...',
      '..#####..',
      '.###.###.',
      '###...###',
      '.#.....#.',
    ],
  ],
  [
    'Bolt',
    [
      '....###',
      '...###.',
      '..###..',
      '.######',
      '...###.',
      '..###..',
      '.###...',
      '.##....',
      '.#.....',
    ],
  ],
  [
    'Moon',
    [
      '...###...',
      '.###.....',
      '.##......',
      '###......',
      '###......',
      '###......',
      '.###....#',
      '.#######.',
      '...####..',
    ],
  ],
  [
    'Coffee',
    [
      '.#.#.#...',
      '.#.#.#...',
      '.........',
      '########.',
      '######.#.',
      '######.#.',
      '########.',
      '.####....',
    ],
  ],
  [
    'Note',
    [
      '..######',
      '..######',
      '..#....#',
      '..#....#',
      '..#....#',
      '.##...##',
      '###..###',
      '###..###',
      '.#....#.',
    ],
  ],
];

function doubled(rows: readonly string[]): Frame {
  const frame = blankFrame();
  const width = Math.max(...rows.map((r) => r.length)) * 2;
  const x0 = Math.floor((SIZE - width) / 2);
  const y0 = Math.floor((SIZE - rows.length * 2) / 2);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '#') continue;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) setPixel(frame, x0 + x * 2 + dx, y0 + y * 2 + dy, 255);
    }
  });
  return applyMask(frame);
}

/** Small pictures the app itself uses, for things that have no frame of their own to show. */
export const ICONS = {
  battery: doubled(['########.', '#......##', '#.####.##', '#.####.##', '#......##', '########.']),
  bell: doubled(['....#....', '...###...', '..#####..', '..#####..', '..#####..', '.#######.', '#########', '.........', '...###...']),
  branch: doubled(['.##...##.', '.##...##.', '..#...#..', '..#..#...', '..#.#....', '..##.....', '..#......', '.##......', '.##......']),
} as const;

export const DESIGNS: ReadonlyArray<{ name: string; frame: Frame }> = ART.map(([name, rows]) => ({ name, frame: doubled(rows) }));
