import { h } from 'preact';
import css from './PhotoBoxProgress.css.js';
import withCSS from '../withCSS';

const PhotoBoxProgress = ({ step }, { options }) => {
  const { className } = options;
  return (
    <div class={`${className}-progress`}>
      <ul class={`${className}-progressList`}>
        {[1, 2].map((i) => {
          const classes = [`${className}-progressList-item`];
          if (i === step) {
            classes.push('is-selected');
          }
          return (<li class={classes.join(' ')}></li>);
        })}
      </ul>
    </div>
  );
};

export default withCSS(PhotoBoxProgress, css);
