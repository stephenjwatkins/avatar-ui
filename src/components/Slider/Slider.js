import { h, Component } from 'preact';
import MouseMover from '../MouseMover';
import withCSS from '../withCSS';
import css from './Slider.css.js';

const Slider = ({ onChange }, { options }) => {
  const { className } = options;
  return (
    <MouseMover onChange={({ x }) => onChange(x)}>
      {({ x }) => (
        <div class={`${className}-slider`}>
          <div class={`${className}-slider-wrap`}>
            <div class={`${className}-slider-bar`}></div>
            <div
              class={`${className}-slider-handle`}
              style={{ left: `calc(${(x * 100).toFixed(2)}% - 10px)` }}
            />
          </div>
        </div>
      )}
    </MouseMover>
  );
};

export default withCSS(Slider, css);
