// Main-page scroll position (the waterfall is an internal scroll container, so window
// scroll never fires). The top bar drives its immersive switch from it: transparent at
// the top, frosted glass once scrolled. x / y = main-axis offset in h / v scroll mode.
export const scroll = $state({ x: 0, y: 0 });
