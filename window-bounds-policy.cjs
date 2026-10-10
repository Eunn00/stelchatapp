const DEFAULT_MIN_WIDTH = 360;
const DEFAULT_MIN_HEIGHT = 520;
const MIN_VISIBLE_PIXELS = 80;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizedWindowBounds(value, workAreas, {
  minWidth = DEFAULT_MIN_WIDTH,
  minHeight = DEFAULT_MIN_HEIGHT,
  minVisiblePixels = MIN_VISIBLE_PIXELS,
} = {}) {
  if (!value || typeof value !== 'object'
      || !finiteNumber(value.x) || !finiteNumber(value.y)
      || !finiteNumber(value.width) || !finiteNumber(value.height)) return {};

  const displays = (workAreas || []).filter((area) => area
    && finiteNumber(area.x) && finiteNumber(area.y)
    && finiteNumber(area.width) && finiteNumber(area.height)
    && area.width > 0 && area.height > 0);
  if (!displays.length) return {};

  const maximumWidth = Math.max(...displays.map((area) => area.width));
  const maximumHeight = Math.max(...displays.map((area) => area.height));
  const bounds = {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.min(maximumWidth, Math.max(minWidth, Math.round(value.width))),
    height: Math.min(maximumHeight, Math.max(minHeight, Math.round(value.height))),
  };

  const visibleDisplays = displays.map((area) => {
    const horizontal = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width)
      - Math.max(bounds.x, area.x));
    const vertical = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height)
      - Math.max(bounds.y, area.y));
    return { area, horizontal, vertical, visibleArea: horizontal * vertical };
  }).filter(({ horizontal, vertical }) => (
    horizontal >= Math.min(minVisiblePixels, bounds.width)
      && vertical >= Math.min(minVisiblePixels, bounds.height)
  )).sort((left, right) => right.visibleArea - left.visibleArea);
  if (!visibleDisplays.length) return {};

  const area = visibleDisplays[0].area;
  bounds.width = Math.min(bounds.width, area.width);
  bounds.height = Math.min(bounds.height, area.height);
  bounds.x = Math.min(
    area.x + area.width - Math.min(minVisiblePixels, bounds.width),
    Math.max(area.x - bounds.width + Math.min(minVisiblePixels, bounds.width), bounds.x),
  );
  // Keep the draggable title bar on-screen even if a saved monitor used a negative Y offset.
  bounds.y = Math.min(
    area.y + area.height - Math.min(32, bounds.height),
    Math.max(area.y, bounds.y),
  );
  return bounds;
}

module.exports = { normalizedWindowBounds };
