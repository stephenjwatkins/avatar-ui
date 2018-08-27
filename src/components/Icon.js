import { h } from 'preact';

const Icon = ({ name }) => {
  return (
    <svg>
      <use xlinkHref={`#${name}`}></use>
    </svg>
  );
};

export default Icon;
