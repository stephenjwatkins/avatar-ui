export const classnames = (...args) => (
  args.reduce((acc, curr) => (
    [].concat(acc, (
      typeof curr === 'string'
      ? [curr]
      : Object.keys(curr).filter((k) => !!curr[k])
    ))
  ), [])
  .join(' ')
);
