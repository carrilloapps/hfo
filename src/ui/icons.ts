import figures from 'figures';

/**
 * Icon set sourced exclusively from the `figures` package (cross-OS, with
 * automatic ASCII fallback on legacy Windows consoles that lack Unicode
 * support). Components MUST use entries from this module rather than inlining
 * raw Unicode glyphs or emojis — it guarantees the UI renders identically on
 * every terminal and font.
 */
export const icon = {
  // Status marks
  tick: figures.tick,                   // '✔'
  cross: figures.cross,                 // '✖'
  warning: figures.warning,             // '⚠'
  info: figures.info,                   // 'ℹ'
  question: figures.questionMarkPrefix,

  // Pointers / arrows
  pointer: figures.pointer,             // '❯'
  pointerSmall: figures.pointerSmall,   // '›'
  arrowUp: figures.arrowUp,
  arrowDown: figures.arrowDown,
  arrowLeft: figures.arrowLeft,
  arrowRight: figures.arrowRight,
  play: figures.play,

  // Bullets
  bullet: figures.bullet,
  dot: figures.dot,
  ellipsis: figures.ellipsis,

  // Circles (status indicators)
  circle: figures.circle,
  circleFilled: figures.circleFilled,
  circleDotted: figures.circleDotted,
  circleDouble: figures.circleDouble,
  circleHalf: figures.circleCircle,

  // Squares
  square: figures.squareSmall,
  squareFilled: figures.squareSmallFilled,

  // Decorative
  star: figures.star,
  heart: figures.heart,
  line: figures.line,
  lineVertical: '|',

  // Checkboxes
  checkOn: figures.checkboxOn,          // '☒'
  checkOff: figures.checkboxOff,        // '☐'

  // Semantic aliases
  nav: figures.pointer,
  ok: figures.tick,
  bad: figures.cross,
  pending: figures.ellipsis,
  on: figures.circleFilled,
  off: figures.circle,
  partial: figures.circleCircle,
} as const;

export type IconKey = keyof typeof icon;
