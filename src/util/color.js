export const hexToRgb = (_hex) => {
  let hex = _hex;
  if (hex[0] !== '#') {
    hex = `#${hex}`;
  }
  if (hex.length === 4) {
    const r = parseInt(hex.slice(1, 2) + hex.slice(1, 2), 16),
          g = parseInt(hex.slice(2, 3) + hex.slice(2, 3), 16),
          b = parseInt(hex.slice(3, 4) + hex.slice(3, 4), 16);
    return { r, g, b };
  }
  if (hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16),
          g = parseInt(hex.slice(3, 5), 16),
          b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  }
  throw new Error('Bad hex provided');
};

export const rgba = ({ r, g, b }, alpha = 1) => {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const hexToRgba = (hex, alpha = 1) => {
  return rgba(hexToRgb(hex), alpha);
};
